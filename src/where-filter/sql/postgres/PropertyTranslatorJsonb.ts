
import { z } from "zod";
import type { ValueComparisonFlexi, ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "../../types.ts";
import { isArrayValueComparisonElemMatch, isArrayValueComparisonAll, isArrayValueComparisonSize, isValueComparisonEq, isValueComparisonNe, isValueComparisonIn, isValueComparisonNin, isValueComparisonNot, isValueComparisonExists, isValueComparisonType, isValueComparisonRegex, isWhereFilterDefinition } from '../../schemas.ts';
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import type { TreeNode, TreeNodeMap, ZodKind } from "../../../dot-prop-paths/zod.ts";
import isPlainObject from "../../../utils/isPlainObject.ts";
import { convertDotPropPathToPostgresJsonPath } from "./convertDotPropPathToPostgresJsonPath.ts";
import { isLogicFilter, isValueComparisonRange, isValueComparisonScalar } from "../../typeguards.ts";
import { ValueComparisonRangeOperators } from "../../consts.ts";
import { compileWhereFilterRecursive } from "../compileWhereFilter.ts";
import { isPreparedStatementArgument } from "../types.ts";
import type { IPropertyTranslator, PreparedStatementArgument, PreparedStatementArgumentOrObject, WhereClauseError } from "../types.ts";
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
        if ((this.nodeMap[dotpropPath]?.kind === 'ZodArray' || this.nodeMap[dotpropPath]?.descended_from_array)) {
            let count = 0;
            let target: TreeNode | undefined = this.nodeMap[dotpropPath];
            while (target) {
                if (target.kind === 'ZodArray') count++;
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
                if (treeNode.kind !== 'ZodArray') throw new Error("Cannot compare an array to a non-array");
                if (countArraysInPath === 1) {
                    // Just do a direct comparison
                    return this.generateComparison(dotpropPath, filter, statementArguments);
                } else {
                    // Ignore the last array in the path, as this is comparing an array against it (not its elements)
                    path.pop();

                    sa = spreadJsonbArrays(this.sqlColumnName, path);
                    if (!sa) throw new Error("Could not locate array in path: " + dotpropPath);

                    if (treeNode.kind !== 'ZodArray') throw new Error("Cannot compare an array to a non-array");
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
                if (treeNode.kind !== 'ZodArray') {
                    const remainingSegments: string[] = [];
                    for (let i = path.length - 1; i >= 0; i--) {
                        if (path[i]!.kind === 'ZodArray') break;
                        if (path[i]!.name) remainingSegments.unshift(path[i]!.name);
                    }
                    if (remainingSegments.length > 0) {
                        const jsonbPath = remainingSegments.map(s => `'${s}'`).join('->');
                        const output_column = `${sa.output_column}->${jsonbPath}`;
                        sa = { ...sa, output_column, output_identifier: `${output_column} #>> '{}'` };
                    }
                }
                const saResolved = sa;
                // $in on array: at least one element must be in the list
                if (isValueComparisonIn(filter)) {
                    if (filter.$in.length === 0) return '1 = 0';
                    const placeholders = filter.$in.map(v => this.generatePlaceholder(v, statementArguments));
                    return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} IN (${placeholders.join(', ')}))`;
                }
                // $nin on array: no element may be in the list
                if (isValueComparisonNin(filter)) {
                    if (filter.$nin.length === 0) return '1 = 1';
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
                    // For optional arrays: missing → $not matches (true)
                    if (this.nodeMap[dotpropPath]?.optional_or_nullable) {
                        return `(${jsonbPath} IS NULL OR NOT (${sizeSql}))`;
                    }
                    return `NOT (${sizeSql})`;
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
                        const subPropertyMap = new PropertyTranslatorJsonbSchema(treeNode.schema!, sa.output_column, true);
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
                            subClause = this.generateComparison(dotpropPath, elemVal, statementArguments, customId);
                        }
                    }
                } else {
                    // Compound object filter on array: all conditions must match the same element
                    if (isPlainObject(filter)) {
                        // Logic operators ($and/$or/$nor) on array values outside $elemMatch are not valid
                        if (isLogicFilter(filter as WhereFilterDefinition)) {
                            throw new Error("Logic operators ($and/$or/$nor) on array values must use $elemMatch explicitly");
                        }
                        const subPropertyMap = new PropertyTranslatorJsonbSchema(treeNode.schema!, sa.output_column, true);
                        const result = compileWhereFilterRecursive(filter as WhereFilterDefinition, statementArguments, subPropertyMap, errors, rootFilter);
                        return `EXISTS (SELECT 1 FROM ${sa.sql} WHERE ${result})`;

                    } else {
                        subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_identifier);
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
    protected generateComparison(dotpropPath: string, filter: WhereFilterDefinition<T> | ValueComparisonFlexi<string | number | boolean> | PreparedStatementArgumentOrObject[] | undefined, statementArguments: PreparedStatementArgument[], customSqlIdentifier?: string, testArrayContainsString?: boolean, errors?: WhereClauseError[], rootFilter?: WhereFilterDefinition<T>): string {

        const optionalWrapper = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) return query;
            if (this.nodeMap[dotpropPath]!.optional_or_nullable) {
                return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
            }
            return query;
        }

        /** Wrapper for optional fields where missing matches (e.g. $ne, $nin, $not). */
        const optionalWrapperNullMatches = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) return query;
            if (this.nodeMap[dotpropPath]!.optional_or_nullable) {
                return `(${sqlIdentifier} IS NULL OR ${query})`;
            }
            return query;
        }

        // $ne
        if (isValueComparisonNe(filter)) {
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
            const innerSql = this.generateComparison(dotpropPath, filter.$not as any, statementArguments, customSqlIdentifier, testArrayContainsString, errors, rootFilter);
            return optionalWrapperNullMatches(sqlIdentifier, `NOT (${innerSql})`);
        }
        // $exists
        if (isValueComparisonExists(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            if (filter.$exists) {
                return `${sqlIdentifier} IS NOT NULL`;
            } else {
                return `${sqlIdentifier} IS NULL`;
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
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);
            const placeholder = this.generatePlaceholder(filter.$regex, statementArguments);
            const op = filter.$options?.includes('i') ? '~*' : '~';
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} ${op} ${placeholder}`);
        }

        if (isValueComparisonEq(filter)) {
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
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, [firstFilterValueType === 'string' ? 'ZodString' : 'ZodNumber']);

            const operators = ValueComparisonRangeOperators
                .filter((x): x is ValueComparisonRangeOperatorsTyped => x in filter && filter[x] !== undefined && filter[x] !== null)
                .map(x => {
                    const placeholder = this.generatePlaceholder(filter[x]!, statementArguments);
                    return ValueComparisonRangeOperatorsSqlFunctions[x](sqlIdentifier, placeholder);
                });
            const result = optionalWrapper(sqlIdentifier, operators.length > 1 ? `(${operators.join(' AND ')})` : operators[0]!);
            return result;

        } else if (isValueComparisonScalar(filter)) {

            const placeholder = this.generatePlaceholder(filter, statementArguments);
            if (testArrayContainsString) {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodArray']);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} ? ${placeholder}`);
            } else {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
            }
        } else if (isPlainObject(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodObject']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
        } else if (Array.isArray(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodArray']);
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
 * const pm = new PropertyTranslatorJsonbSchema(ContactSchema, 'recordColumn');
 */
export class PropertyTranslatorJsonbSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorJsonb<T> implements IPropertyTranslator<T> {
    constructor(schema: z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?: boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
    }
}
/**
 * PropertyTranslator for Postgres JSONB that accepts a pre-built TreeNodeMap directly (when schema introspection is already done).
 */
export class PropertyTranslatorJsonb<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorJsonb<T> implements IPropertyTranslator<T> {

    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}
