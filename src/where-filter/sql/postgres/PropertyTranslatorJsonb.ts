
import { z } from "zod";
import type { ValueComparisonFlexi, ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "../../types.ts";
import { isArrayValueComparisonElemMatch, isArrayValueComparisonAll, isArrayValueComparisonSize, isValueComparisonEq, isValueComparisonNe, isValueComparisonIn, isValueComparisonNin, isValueComparisonNot, isValueComparisonExists, isValueComparisonType, isValueComparisonRegex, isWhereFilterDefinition } from '../../schemas.ts';
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import type { TreeNode, TreeNodeMap, ZodKind } from "../../../dot-prop-paths/schema-tree.ts";
import { findShapeAmbiguousPaths, findMultiScalarUnionPaths } from "../../../dot-prop-paths/shape-ambiguity.ts";
import { findNormalizingPaths } from "../../../dot-prop-paths/schema-normalization.ts";
import isPlainObject from "../../../utils/isPlainObject.ts";
import { convertDotPropPathToPostgresJsonPath } from "./convertDotPropPathToPostgresJsonPath.ts";
import { isLogicFilter, isValueComparisonRange, isValueComparisonScalar } from "../../typeguards.ts";
import { ValueComparisonRangeOperators } from "../../consts.ts";
import { compileWhereFilterRecursive } from "../compileWhereFilter.ts";
import { isPreparedStatementArgument } from "../types.ts";
import type { IPropertyTranslator, PreparedStatementArgument, PreparedStatementArgumentOrObject, SqlDialect, WhereClauseError } from "../types.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";
import { spreadJsonbArrays } from "./spreadJsonbArrays.ts";



/** Maps our $type names to Postgres jsonb_typeof() return values ('bool' → 'boolean'). */
function mapTypeToPostgres(typeName: string): string {
    if (typeName === 'bool') return 'boolean';
    return typeName;
}

/**
 * Postgres JSONB implementation of IPropertyTranslator.
 * Generates SQL fragments for a single JSONB column using TreeNodeMap for type-aware casting,
 * array spreading via jsonb_array_elements, and parameterised placeholders.
 */
class BasePropertyTranslatorJsonb<T extends Record<string, any> = Record<string, any>> implements IPropertyTranslator<T> {
    readonly dialect: SqlDialect = 'pg';
    /** Schema-level errors found at construction from a Zod schema (shape-ambiguous fields); see {@link IPropertyTranslator}. */
    schemaErrors: WhereClauseError[] = [];
    /** Dot-prop paths whose union mixes ≥2 scalar kinds — compared as raw JSON values, not a single typed cast (see {@link generateComparison}). */
    protected multiScalarPaths: Set<string> = new Set();
    protected nodeMap: TreeNodeMap;
    protected sqlColumnName: string;
    protected doNotSpreadArray: boolean;
    /** Accumulated path conversion errors, merged into caller's errors array after generateSql completes. */
    private conversionErrors: WhereClauseError[] = [];

    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        this.nodeMap = nodeMap;
        this.sqlColumnName = sqlColumnName;
        this.doNotSpreadArray = doNotSpreadArray ?? false;
    }

    /** Counts how many ZodArray nodes exist in the ancestry chain for a path. Determines whether array spreading is needed. */
    private countArraysInPath(dotpropPath: string): number {
        if ((this.nodeMap[dotpropPath]?.kind === 'array' || this.nodeMap[dotpropPath]?.descended_from_array)) {
            let count = 0;
            let target: TreeNode | undefined = this.nodeMap[dotpropPath];
            while (target) {
                if (target.kind === 'array') count++;
                target = target?.parent;
            }
            return count;
        } else {
            return 0;
        }
    }

    /** Wraps convertDotPropPathToPostgresJsonPath, using this instance's column name and nodeMap. On failure, records error and returns 'FALSE'. */
    private getSqlIdentifier(dotPropPath: string, errorIfNotAsExpected?: ZodKind[], customColumnName?: string): string {
        const result = convertDotPropPathToPostgresJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
        if (!result.success) {
            this.conversionErrors.push({ kind: 'path_conversion', error: result.error, message: result.error.message });
            return 'FALSE';
        }
        return result.expression;
    }

    /** Pushes a value into the statementArguments array and returns its `$N` placeholder. Objects/arrays are JSON.stringify'd first. */
    protected generatePlaceholder(value: PreparedStatementArgumentOrObject, statementArguments: PreparedStatementArgument[]): string {

        if (isPlainObject(value) || Array.isArray(value)) value = JSON.stringify(value);
        if (!isPreparedStatementArgument(value)) {
            throw new Error("Placeholders for SQL can only be string/number/boolean");
        }
        statementArguments.push(value);
        return `$${statementArguments.length}`;
    }

    /** Build the raw JSONB accessor (`col->'a'->'b'`) for a dot-prop path — for type-faithful value comparison of a multi-scalar union. */
    private rawJsonbAccessor(dotpropPath: string): string {
        const jsonbPath = dotpropPath.split('.').map(p => `'${p}'`).join('->');
        return `${this.sqlColumnName}->${jsonbPath}`;
    }

    /** Bind a scalar value and wrap it as JSONB of its own type, so equality stays type-faithful (JSON `true` ≠ `1` ≠ `"true"`). */
    private toJsonbParam(value: string | number | boolean, statementArguments: PreparedStatementArgument[]): string {
        const placeholder = this.generatePlaceholder(value, statementArguments);
        const cast = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'numeric' : 'text';
        return `to_jsonb(${placeholder}::${cast})`;
    }

    /**
     * Generates a SQL fragment for a single dot-prop path and its filter value.
     * Two main branches: direct comparison (no arrays), or jsonb_array_elements spreading + EXISTS wrapping (arrays).
     * Compound array filters require all conditions to match the same element (exact document match).
     */
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        // Reset conversion errors for this call
        this.conversionErrors = [];

        const result = this._generateSqlInner(dotpropPath, filter, statementArguments, errors, rootFilter);

        // Merge any accumulated conversion errors into the caller's errors array
        if (this.conversionErrors.length > 0) {
            errors.push(...this.conversionErrors);
            this.conversionErrors = [];
        }

        return result;
    }

    /** Inner implementation of generateSql, separated so conversionErrors can be collected. */
    private _generateSqlInner(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
        // TODO Probably provide a version of this for JSONB that others can reference
        const countArraysInPath = this.countArraysInPath(dotpropPath);
        if (countArraysInPath > 0) { // && !this.doNotSpreadArray

            //throw new Error("Unsupported");
            // Almost all will involve the format EXISTS(SELECT 1 FROM jsonb_array_elements [CROSS JOIN...] WHERE <<as_column> run on compileWhereFilterRecursive>)

            const path = [];
            let target: TreeNode | undefined = this.nodeMap[dotpropPath];
            while (target) {
                path.unshift(target);
                target = target?.parent;
            }
            let sa: ReturnType<typeof spreadJsonbArrays>;

            let subClause: string = '';
            const treeNode = this.nodeMap[dotpropPath];
            if (!treeNode) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if (Array.isArray(filter)) {
                if (treeNode.kind !== 'array') throw new Error("Cannot compare an array to a non-array");
                if (countArraysInPath === 1) {
                    // Just do a direct comparison
                    return this.generateComparison(dotpropPath, filter, statementArguments);
                } else {
                    // Ignore the last array in the path, as this is comparing an array against it (not its elements)
                    path.pop();

                    sa = spreadJsonbArrays(this.sqlColumnName, path);
                    if (!sa) throw new Error("Could not locate array in path: " + dotpropPath);

                    if (treeNode.kind !== 'array') throw new Error("Cannot compare an array to a non-array");
                    subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_column);
                }

            } else if (this.doNotSpreadArray && countArraysInPath === 1) {
                // With just 1 array, we don't want to do the spread. In fact we're arriving from a spread (that's what column name is). So we need the identifier on it.
                // It is probably spreading an array, and has recursed into this

                const identifier = this.getSqlIdentifier(dotpropPath, undefined, this.sqlColumnName);
                return this.generateComparison(dotpropPath, filter, statementArguments, `${identifier}`);
            } else {

                sa = spreadJsonbArrays(this.sqlColumnName, path);
                if (!sa) throw new Error("Could not locate array in path: " + dotpropPath);
                // When the path continues past the last array to a scalar/object field
                // (e.g. messages.rfc822msgid where messages is the array), extract the
                // remaining field from the spread output.
                if (treeNode.kind !== 'array') {
                    const remainingSegments: string[] = [];
                    for (let i = path.length - 1; i >= 0; i--) {
                        if (path[i]!.kind === 'array') break;
                        if (path[i]!.name) remainingSegments.unshift(path[i]!.name);
                    }
                    if (remainingSegments.length > 0) {
                        const jsonbPath = remainingSegments.map(s => `'${s}'`).join('->');
                        const output_column = `${sa.output_column}->${jsonbPath}`;
                        sa = { ...sa, output_column, output_identifier: `${output_column} #>> '{}'` };
                    }
                }
                const saResolved = sa;
                // A mixed-scalar element array compares the RAW JSONB element value (JSON 7 ≠ "7"), not the text
                // identifier — so $in/$nin/$all stay type-faithful like matchJavascriptObject. Without this the text
                // `#>> '{}'` identifier coerces a numeric filter against a string element. (F3 covered $elemMatch /
                // plain containment only.)
                const multiScalarElement = this.multiScalarPaths.has(dotpropPath);
                // $in on array: at least one element must be in the list
                if (isValueComparisonIn(filter)) {
                    if (filter.$in.length === 0) return '1 = 0';
                    if (multiScalarElement) {
                        const vals = filter.$in.map(v => this.toJsonbParam(v, statementArguments));
                        return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_column} IN (${vals.join(', ')}))`;
                    }
                    const placeholders = filter.$in.map(v => this.generatePlaceholder(v, statementArguments));
                    return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} IN (${placeholders.join(', ')}))`;
                }
                // $nin on array: no element may be in the list
                if (isValueComparisonNin(filter)) {
                    if (filter.$nin.length === 0) return '1 = 1';
                    if (multiScalarElement) {
                        const vals = filter.$nin.map(v => this.toJsonbParam(v, statementArguments));
                        return `NOT EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_column} IN (${vals.join(', ')}))`;
                    }
                    const placeholders = filter.$nin.map(v => this.generatePlaceholder(v, statementArguments));
                    return `NOT EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} IN (${placeholders.join(', ')}))`;
                }
                // $all: array must contain all specified values (scalars use =, objects use @> containment)
                if (isArrayValueComparisonAll(filter)) {
                    const conditions = filter.$all.map(v => {
                        if (isPlainObject(v)) {
                            // Object element: use @> containment on the raw JSONB element
                            const placeholder = this.generatePlaceholder(v, statementArguments);
                            return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_column} @> ${placeholder}::jsonb)`;
                        }
                        if (multiScalarElement && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
                            return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_column} = ${this.toJsonbParam(v, statementArguments)})`;
                        }
                        const placeholder = this.generatePlaceholder(v, statementArguments);
                        return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} = ${placeholder})`;
                    });
                    return conditions.join(' AND ');
                }
                // $size: array has exactly N elements
                if (isArrayValueComparisonSize(filter)) {
                    const sizeResult = convertDotPropPathToPostgresJsonPath(this.sqlColumnName, dotpropPath, this.nodeMap, undefined, true);
                    if (!sizeResult.success) {
                        this.conversionErrors.push({ kind: 'path_conversion', error: sizeResult.error, message: sizeResult.error.message });
                        return 'FALSE';
                    }
                    const jsonbPath = sizeResult.expression;
                    const placeholder = this.generatePlaceholder(filter.$size, statementArguments);
                    return `jsonb_array_length(${jsonbPath}) = ${placeholder}`;
                }
                // $not + $size on array
                if (isValueComparisonNot(filter) && isArrayValueComparisonSize(filter.$not)) {
                    const sizeResult = convertDotPropPathToPostgresJsonPath(this.sqlColumnName, dotpropPath, this.nodeMap, undefined, true);
                    if (!sizeResult.success) {
                        this.conversionErrors.push({ kind: 'path_conversion', error: sizeResult.error, message: sizeResult.error.message });
                        return 'FALSE';
                    }
                    const jsonbPath = sizeResult.expression;
                    const placeholder = this.generatePlaceholder(filter.$not.$size, statementArguments);
                    const sizeSql = `jsonb_array_length(${jsonbPath}) = ${placeholder}`;
                    return `(${jsonbPath} IS NULL OR NOT (${sizeSql}))`;
                }
                // $exists on array
                if (isValueComparisonExists(filter)) {
                    const existsResult = convertDotPropPathToPostgresJsonPath(this.sqlColumnName, dotpropPath, this.nodeMap, undefined, true);
                    if (!existsResult.success) {
                        this.conversionErrors.push({ kind: 'path_conversion', error: existsResult.error, message: existsResult.error.message });
                        return 'FALSE';
                    }
                    const jsonbPath = existsResult.expression;
                    if (filter.$exists) {
                        return `${jsonbPath} IS NOT NULL`;
                    } else {
                        return `${jsonbPath} IS NULL`;
                    }
                }
                // $type on array
                if (isValueComparisonType(filter)) {
                    const parts = dotpropPath.split('.');
                    const jsonbPath = parts.map(p => `'${p}'`).join('->');
                    const rawJsonbExpr = `${this.sqlColumnName}->${jsonbPath}`;
                    const pgType = mapTypeToPostgres(filter.$type);
                    const placeholder = this.generatePlaceholder(pgType, statementArguments);
                    return `jsonb_typeof(${rawJsonbExpr}) = ${placeholder}`;
                }

                if (isArrayValueComparisonElemMatch(filter)) {
                    const elemVal = filter.$elemMatch;
                    // Object sub-filter: recurse with sub-PropertyTranslator scoped to array element
                    if (isPlainObject(elemVal) && isWhereFilterDefinition(elemVal) && !isValueComparisonRange(elemVal) && !isValueComparisonEq(elemVal) && !isValueComparisonNe(elemVal) && !isValueComparisonIn(elemVal) && !isValueComparisonNin(elemVal) && !isValueComparisonNot(elemVal) && !isValueComparisonExists(elemVal) && !isValueComparisonType(elemVal) && !isValueComparisonRegex(elemVal) && !isArrayValueComparisonSize(elemVal)) {
                        const subPropertyMap = new PropertyTranslatorPgJsonbSchema(treeNode.schema!, sa.output_column, true);
                        const result = compileWhereFilterRecursive(elemVal, statementArguments, subPropertyMap, errors, rootFilter);
                        subClause = result;
                    } else {
                        // Scalar value comparison (includes $regex, $ne, $in, $eq, range, plain scalar, etc.)
                        const testArrayContainsString = typeof elemVal === 'string';
                        if (testArrayContainsString) {
                            return this.generateComparison(dotpropPath, elemVal, statementArguments, undefined, testArrayContainsString);
                        } else {
                            let customId = sa.output_identifier;
                            if (isValueComparisonRange(elemVal)) {
                                const firstVal = Object.values(elemVal)[0];
                                if (typeof firstVal === 'number') {
                                    customId = `(${sa.output_identifier})::numeric`;
                                }
                            } else if (typeof elemVal === 'number') {
                                customId = `(${sa.output_identifier})::numeric`;
                            }
                            // A multi-scalar element compares as a raw JSON value: pass the element's raw JSONB
                            // column so generateComparison's strict branch stays type-faithful (range/$regex still
                            // fall through to the typed customId above).
                            const rawJsonbId = this.multiScalarPaths.has(dotpropPath) ? sa.output_column : undefined;
                            subClause = this.generateComparison(dotpropPath, elemVal, statementArguments, customId, undefined, undefined, undefined, rawJsonbId);
                        }
                    }
                } else {
                    // Compound object filter on array: all conditions must match the same element
                    if (isPlainObject(filter)) {
                        // Logic operators ($and/$or/$nor) on array values outside $elemMatch are not valid
                        if (isLogicFilter(filter as WhereFilterDefinition)) {
                            throw new Error("Logic operators ($and/$or/$nor) on array values must use $elemMatch explicitly");
                        }
                        const subPropertyMap = new PropertyTranslatorPgJsonbSchema(treeNode.schema!, sa.output_column, true);
                        const result = compileWhereFilterRecursive(filter as WhereFilterDefinition, statementArguments, subPropertyMap, errors, rootFilter);
                        return `EXISTS (SELECT 1 FROM ${sa.sql} WHERE ${result})`;

                    } else {
                        const rawJsonbId = this.multiScalarPaths.has(dotpropPath) ? sa.output_column : undefined;
                        subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_identifier, undefined, undefined, undefined, rawJsonbId);
                    }
                }
            }

            const sql = `EXISTS (SELECT 1 FROM ${sa.sql} WHERE ${subClause})`;

            return sql;

        } else {
            // Do direct comparison

            return this.generateComparison(dotpropPath, filter, statementArguments, undefined, undefined, errors, rootFilter);
        }
    }

    /**
     * Emits a leaf-level SQL comparison for a single value ($eq → =, range → >/</>=/<= , scalar → =, object/array → =::jsonb, undefined → IS NULL).
     * Wraps optional/nullable paths with an IS NOT NULL guard.
     */
    protected generateComparison(dotpropPath: string, filter: WhereFilterDefinition<T> | ValueComparisonFlexi<string | number | boolean> | PreparedStatementArgumentOrObject[] | undefined, statementArguments: PreparedStatementArgument[], customSqlIdentifier?: string, testArrayContainsString?: boolean, errors?: WhereClauseError[], rootFilter?: WhereFilterDefinition<T>, customRawJsonbIdentifier?: string): string {

        /**
         * Forces leaf comparisons to a definite TRUE/FALSE so any enclosing NOT
         * (from $nor or a parent $not) doesn't propagate NULL under SQL 3VL.
         * Unconditional: PG folds `IS NOT NULL` against NOT NULL columns.
         */
        const optionalWrapper = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) return query;
            return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
        }

        /**
         * Wraps Mongo "matches missing" operators ($ne / $nin / $not) with `(IS NULL OR <q>)`.
         * Unconditional so semantics agree with matchJavascriptObject regardless of schema
         * annotation; PG folds the guard against NOT NULL columns.
         */
        const optionalWrapperNullMatches = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) return query;
            return `(${sqlIdentifier} IS NULL OR ${query})`;
        }

        // Multi-scalar union field (e.g. boolean|number|string): compare as a raw JSON value so JSON `true` ≠ `1`
        // ≠ `"true"`, matching matchJavascriptObject's strict `===`. The schema gives no single column type, so a
        // typed cast would coerce across scalar kinds and can cast-error on arbitrary strings. Applies to a
        // top-level field (raw accessor) and to an array-spread element (the caller passes the element's raw
        // JSONB column as customRawJsonbIdentifier); the string-containment shortcut (handled below) and
        // range/$regex operators fall through to the typed path.
        if (this.multiScalarPaths.has(dotpropPath) && !testArrayContainsString && (customSqlIdentifier === undefined || customRawJsonbIdentifier !== undefined)) {
            const rawId = customRawJsonbIdentifier ?? this.rawJsonbAccessor(dotpropPath);
            // A bare `{ field: null }` arrives as the JSON value `null` (not `{ $eq: null }`, which the param type
            // omits — hence the unknown widening); treat it identically — match SQL NULL (missing path) or JSON
            // null — so it never reaches the first-arm typed cast that would error on a string/number row.
            const filterValue: unknown = filter;
            if (filterValue === null) return `(${rawId} IS NULL OR ${rawId} = 'null'::jsonb)`;
            if (isValueComparisonEq(filter)) {
                if (filter.$eq === null) return `(${rawId} IS NULL OR ${rawId} = 'null'::jsonb)`;
                // Nothing equals NaN — short-circuit to a constant rather than binding NaN as jsonb. See MONGO-DIVERGENCES.md §7.
                if (typeof filter.$eq === 'number' && Number.isNaN(filter.$eq)) return '1 = 0';
                return `(${rawId} IS NOT NULL AND ${rawId} = ${this.toJsonbParam(filter.$eq, statementArguments)})`;
            }
            if (isValueComparisonNe(filter)) {
                // "ne matches missing" like matchJavascriptObject; `$ne: null` matches every value.
                if (filter.$ne === null) return '1 = 1';
                // NaN equals nothing, so $ne: NaN matches every value — short-circuit before the strict path. See MONGO-DIVERGENCES.md §7.
                if (typeof filter.$ne === 'number' && Number.isNaN(filter.$ne)) return '1 = 1';
                return `(${rawId} IS NULL OR ${rawId} != ${this.toJsonbParam(filter.$ne, statementArguments)})`;
            }
            if (isValueComparisonIn(filter)) {
                if (filter.$in.length === 0) return '1 = 0';
                const vals = filter.$in.map(v => this.toJsonbParam(v, statementArguments));
                return `(${rawId} IS NOT NULL AND ${rawId} IN (${vals.join(', ')}))`;
            }
            if (isValueComparisonNin(filter)) {
                if (filter.$nin.length === 0) return '1 = 1';
                const vals = filter.$nin.map(v => this.toJsonbParam(v, statementArguments));
                return `(${rawId} IS NULL OR ${rawId} NOT IN (${vals.join(', ')}))`;
            }
            if (isValueComparisonScalar(filter)) {
                return `(${rawId} IS NOT NULL AND ${rawId} = ${this.toJsonbParam(filter, statementArguments)})`;
            }
            // $exists / $type / $not / range / $regex on a multi-scalar field fall through to the typed handling.
        }

        // $ne
        if (isValueComparisonNe(filter)) {
            // MongoDB: NaN equals nothing, so $ne: NaN matches every value (and Mongo's "ne matches missing" rule also applies). See MONGO-DIVERGENCES.md §7.
            if (typeof filter.$ne === 'number' && Number.isNaN(filter.$ne)) {
                return '1=1';
            }
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            const placeholder = this.generatePlaceholder(filter.$ne, statementArguments);
            return optionalWrapperNullMatches(sqlIdentifier, `${sqlIdentifier} != ${placeholder}`);
        }
        // $in
        if (isValueComparisonIn(filter)) {
            if (filter.$in.length === 0) return '1 = 0';
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            const placeholders = filter.$in.map(v => this.generatePlaceholder(v, statementArguments));
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} IN (${placeholders.join(', ')})`);
        }
        // $nin
        if (isValueComparisonNin(filter)) {
            if (filter.$nin.length === 0) return '1 = 1';
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            const placeholders = filter.$nin.map(v => this.generatePlaceholder(v, statementArguments));
            return optionalWrapperNullMatches(sqlIdentifier, `${sqlIdentifier} NOT IN (${placeholders.join(', ')})`);
        }
        // $not — negate inner comparison
        if (isValueComparisonNot(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            const innerSql = this.generateComparison(dotpropPath, filter.$not as any, statementArguments, customSqlIdentifier, testArrayContainsString, errors, rootFilter, customRawJsonbIdentifier);
            // A top-level multi-scalar field has no single column type — the outer null-guard must read the raw
            // (uncast) JSONB, or a first-arm cast (e.g. ::boolean) errors on a row of another scalar kind even though
            // the inner comparison is already raw. Mirrors the bare-null fix. (A spread element guards via its
            // uncast text identifier, which does not cast-error.)
            const guardIdentifier = (this.multiScalarPaths.has(dotpropPath) && customSqlIdentifier === undefined)
                ? this.rawJsonbAccessor(dotpropPath)
                : sqlIdentifier;
            return optionalWrapperNullMatches(guardIdentifier, `NOT (${innerSql})`);
        }
        // $exists — use jsonb_typeof on the raw jsonb value (-> not ->>) so JSON null
        // (a present value) is distinguished from a missing path. `->>` text-extracts
        // and returns SQL NULL for both, conflating them.
        if (isValueComparisonExists(filter)) {
            const parts = dotpropPath.split('.');
            const jsonbPath = parts.map(p => `'${p}'`).join('->');
            const rawJsonbExpr = `${this.sqlColumnName}->${jsonbPath}`;
            if (filter.$exists) {
                return `jsonb_typeof(${rawJsonbExpr}) IS NOT NULL`;
            } else {
                return `jsonb_typeof(${rawJsonbExpr}) IS NULL`;
            }
        }
        // $type
        if (isValueComparisonType(filter)) {
            // For Postgres JSONB, use jsonb_typeof on the raw JSONB value (-> not ->>).
            // Build the -> chain manually since convertDotPropPathToPostgresJsonPath uses ->> for leaf scalars.
            const parts = dotpropPath.split('.');
            const jsonbPath = parts.map(p => `'${p}'`).join('->');
            const rawJsonbExpr = `${this.sqlColumnName}->${jsonbPath}`;
            const pgType = mapTypeToPostgres(filter.$type);
            const placeholder = this.generatePlaceholder(pgType, statementArguments);
            return `jsonb_typeof(${rawJsonbExpr}) = ${placeholder}`;
        }
        // $size (needed here for $not + $size to work via recursive generateComparison)
        if (isArrayValueComparisonSize(filter)) {
            const sizeResult = convertDotPropPathToPostgresJsonPath(this.sqlColumnName, dotpropPath, this.nodeMap, undefined, true);
            if (!sizeResult.success) {
                this.conversionErrors.push({ kind: 'path_conversion', error: sizeResult.error, message: sizeResult.error.message });
                return 'FALSE';
            }
            const jsonbPath = sizeResult.expression;
            const placeholder = this.generatePlaceholder(filter.$size, statementArguments);
            return `jsonb_array_length(${jsonbPath}) = ${placeholder}`;
        }
        // $regex
        if (isValueComparisonRegex(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['string']);
            const placeholder = this.generatePlaceholder(filter.$regex, statementArguments);
            const op = filter.$options?.includes('i') ? '~*' : '~';
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} ${op} ${placeholder}`);
        }

        if (isValueComparisonEq(filter)) {
            // MongoDB: nothing equals NaN. See MONGO-DIVERGENCES.md §7.
            if (typeof filter.$eq === 'number' && Number.isNaN(filter.$eq)) {
                return '1=0';
            }
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            if (filter.$eq === null) {
                return `${sqlIdentifier} IS NULL`;
            }
            const placeholder = this.generatePlaceholder(filter.$eq, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
        } else if (isValueComparisonRange(filter)) {

            // Range comparison can be string or filter, so we need to determinate what we're dealing with to set the SQL straight.
            // E.g. if the filter is {$gt: 'A'}, this will be 'string'. If the filter is {$gt: 1}, this will be 'number'.
            const firstFilterValueType = typeof (Object.values(filter)[0]);
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, [firstFilterValueType === 'string' ? 'string' : 'number']);

            const operators = ValueComparisonRangeOperators
                .filter((x): x is ValueComparisonRangeOperatorsTyped => x in filter && filter[x] !== undefined && filter[x] !== null)
                .map(x => {
                    const v = filter[x]!;
                    // MongoDB: every comparison with NaN returns false. See MONGO-DIVERGENCES.md §7.
                    if (typeof v === 'number' && Number.isNaN(v)) {
                        return '1=0';
                    }
                    const placeholder = this.generatePlaceholder(v, statementArguments);
                    return ValueComparisonRangeOperatorsSqlFunctions[x](sqlIdentifier, placeholder);
                });
            const result = optionalWrapper(sqlIdentifier, operators.length > 1 ? `(${operators.join(' AND ')})` : operators[0]!);
            return result;

        } else if (isValueComparisonScalar(filter)) {

            const placeholder = this.generatePlaceholder(filter, statementArguments);
            if (testArrayContainsString) {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['array']);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} ? ${placeholder}`);
            } else {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
            }
        } else if (isPlainObject(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['object']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
        } else if (Array.isArray(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['array']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
        } else if (filter === null) {
            // Explicit null filter → match SQL NULL (no optionalWrapper — IS NOT NULL guard would contradict)
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            return `${sqlIdentifier} IS NULL`;
        } else if (filter === undefined) {
            // Want it to return nothing (same as matchJavascriptObject), so treat it as a null
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} IS NULL`);
        } else {
            let filterString = 'na';
            try {
                filterString = JSON.stringify(filter);
            } finally {
                throw new Error("Unknown filter type: " + filterString);
            }

        }
    }
}



/**
 * PropertyTranslator for Postgres JSONB that derives its TreeNodeMap from a Zod schema automatically.
 *
 * @example
 * const pm = new PropertyTranslatorPgJsonbSchema(ContactSchema, 'recordColumn');
 */
export class PropertyTranslatorPgJsonbSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorJsonb<T> implements IPropertyTranslator<T> {
    constructor(schema: z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?: boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
        this.schemaErrors = [
            ...findShapeAmbiguousPaths(schema).map((a): WhereClauseError => ({
                kind: 'schema_ambiguous',
                dotprop_path: a.dotprop_path,
                message: `Field '${a.dotprop_path}' has a shape-ambiguous schema (an array coexists with a non-array variant: ${a.arm_kinds.join(' | ')}); a schema-driven SQL engine cannot represent it.`,
            })),
            ...findNormalizingPaths(schema).map((n): WhereClauseError => ({
                kind: 'schema_normalizes',
                dotprop_path: n.dotprop_path,
                message: `Field '${n.dotprop_path}' has a value-normalizing schema (${n.reason}); a schema-driven SQL engine compares the raw stored value and cannot replicate the coercion/transform.`,
            })),
        ];
        this.multiScalarPaths = new Set(findMultiScalarUnionPaths(schema).map((m) => m.dotprop_path));
    }
}
/**
 * PropertyTranslator for Postgres JSONB that accepts a pre-built TreeNodeMap directly (when schema introspection is already done).
 */
export class PropertyTranslatorPgJsonb<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorJsonb<T> implements IPropertyTranslator<T> {

    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}
