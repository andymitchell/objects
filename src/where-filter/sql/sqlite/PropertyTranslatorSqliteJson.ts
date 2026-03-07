
import { z } from "zod";
import type { ValueComparisonFlexi, ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "../../types.ts";
import { isArrayValueComparisonElemMatch, isArrayValueComparisonAll, isArrayValueComparisonSize, isValueComparisonContains, isValueComparisonNe, isValueComparisonIn, isValueComparisonNin, isValueComparisonNot, isValueComparisonExists, isValueComparisonType, isValueComparisonRegex, isWhereFilterDefinition } from '../../schemas.ts';
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import type { TreeNode, TreeNodeMap, ZodKind } from "../../../dot-prop-paths/zod.ts";
import isPlainObject from "../../../utils/isPlainObject.ts";
import { convertDotPropPathToSqliteJsonPath } from "./convertDotPropPathToSqliteJsonPath.ts";
import { isValueComparisonRange, isValueComparisonScalar } from "../../typeguards.ts";
import { ValueComparisonRangeOperators } from "../../consts.ts";
import { compileWhereFilterRecursive } from "../compileWhereFilter.ts";
import { isPreparedStatementArgument } from "../types.ts";
import type { IPropertyTranslator, PreparedStatementArgument, PreparedStatementArgumentOrObject, WhereClauseError } from "../types.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";
import { spreadJsonArraysSqlite } from "./spreadJsonArraysSqlite.ts";


/**
 * SQLite JSON implementation of IPropertyTranslator.
 * Generates SQL fragments for a single JSON TEXT column using TreeNodeMap for path validation,
 * json_each for array spreading, and ? positional placeholders.
 */
class BasePropertyTranslatorSqliteJson<T extends Record<string, any> = Record<string, any>> implements IPropertyTranslator<T> {
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

    /** Counts how many ZodArray nodes exist in the ancestry chain for a path. */
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

    /** Wraps convertDotPropPathToSqliteJsonPath using this instance's column name and nodeMap. On failure, records error and returns 'FALSE'. */
    private getSqlIdentifier(dotPropPath: string, errorIfNotAsExpected?: ZodKind[], customColumnName?: string): string {
        const result = convertDotPropPathToSqliteJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
        if (!result.success) {
            this.conversionErrors.push({ kind: 'path_conversion', error: result.error, message: result.error.message });
            return 'FALSE';
        }
        return result.expression;
    }

    /** Pushes a value into the statementArguments array and returns `?`. Objects/arrays are JSON.stringify'd first. */
    protected generatePlaceholder(value: PreparedStatementArgumentOrObject, statementArguments: PreparedStatementArgument[]): string {
        if (isPlainObject(value) || Array.isArray(value)) value = JSON.stringify(value);
        if (!isPreparedStatementArgument(value)) {
            throw new Error("Placeholders for SQL can only be string/number/boolean");
        }
        statementArguments.push(value);
        return '?';
    }

    /**
     * Generates a SQL fragment for a single dot-prop path and its filter value.
     * Two main branches: direct comparison (no arrays), or json_each spreading + EXISTS wrapping (arrays).
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
        const countArraysInPath = this.countArraysInPath(dotpropPath);
        if (countArraysInPath > 0) {

            const path: TreeNode[] = [];
            let target: TreeNode | undefined = this.nodeMap[dotpropPath];
            while (target) {
                path.unshift(target);
                target = target?.parent;
            }
            let sa: ReturnType<typeof spreadJsonArraysSqlite>;

            let subClause: string = '';
            const treeNode = this.nodeMap[dotpropPath];
            if (!treeNode) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if (Array.isArray(filter)) {
                if (treeNode.kind !== 'ZodArray') throw new Error("Cannot compare an array to a non-array");
                if (countArraysInPath === 1) {
                    return this.generateComparison(dotpropPath, filter, statementArguments);
                } else {
                    path.pop();

                    sa = spreadJsonArraysSqlite(this.sqlColumnName, path);
                    if (!sa) throw new Error("Could not locate array in path: " + dotpropPath);

                    subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_column);
                }

            } else if (this.doNotSpreadArray && countArraysInPath === 1) {
                const identifier = this.getSqlIdentifier(dotpropPath, undefined, this.sqlColumnName);
                return this.generateComparison(dotpropPath, filter, statementArguments, `${identifier}`);
            } else {

                sa = spreadJsonArraysSqlite(this.sqlColumnName, path);
                if (!sa) throw new Error("Could not locate array in path: " + dotpropPath);
                const saResolved = sa;
                // $in on array: at least one element must be in the list
                if (isValueComparisonIn(filter)) {
                    const placeholders = filter.$in.map(v => this.generatePlaceholder(v, statementArguments));
                    return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} IN (${placeholders.join(', ')}))`;
                }
                // $nin on array: no element may be in the list
                if (isValueComparisonNin(filter)) {
                    const placeholders = filter.$nin.map(v => this.generatePlaceholder(v, statementArguments));
                    return `NOT EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} IN (${placeholders.join(', ')}))`;
                }
                // $all: array must contain all specified values
                if (isArrayValueComparisonAll(filter)) {
                    const conditions = filter.$all.map(v => {
                        const placeholder = this.generatePlaceholder(v, statementArguments);
                        return `EXISTS (SELECT 1 FROM ${saResolved.sql} WHERE ${saResolved.output_identifier} = ${placeholder})`;
                    });
                    return conditions.join(' AND ');
                }
                // $size: array has exactly N elements
                if (isArrayValueComparisonSize(filter)) {
                    const jsonPath = '$.' + dotpropPath.split('.').join('.');
                    const placeholder = this.generatePlaceholder(filter.$size, statementArguments);
                    return `json_array_length(${this.sqlColumnName}, '${jsonPath}') = ${placeholder}`;
                }
                // $exists on array
                if (isValueComparisonExists(filter)) {
                    const jsonPath = '$.' + dotpropPath.split('.').join('.');
                    if (filter.$exists) {
                        return `json_type(${this.sqlColumnName}, '${jsonPath}') IS NOT NULL`;
                    } else {
                        return `json_type(${this.sqlColumnName}, '${jsonPath}') IS NULL`;
                    }
                }
                // $type on array
                if (isValueComparisonType(filter)) {
                    const jsonPath = '$.' + dotpropPath.split('.').join('.');
                    const placeholder = this.generatePlaceholder(filter.$type, statementArguments);
                    return `json_type(${this.sqlColumnName}, '${jsonPath}') = ${placeholder}`;
                }

                if (isArrayValueComparisonElemMatch(filter)) {
                    // Check for scalar value comparisons first to avoid the ambiguity
                    // where operator objects like {$gt: 5} pass isWhereFilterDefinition.
                    const elemVal = filter.$elemMatch;
                    if (isValueComparisonScalar(elemVal) || isValueComparisonContains(elemVal) || isValueComparisonRange(elemVal)) {
                        // Scalar value comparison
                        const testArrayContainsString = typeof elemVal === 'string';
                        if (testArrayContainsString) {
                            // For scalar string containment: EXISTS (SELECT 1 FROM json_each(...) WHERE value = ?)
                            return this.generateComparison(dotpropPath, elemVal, statementArguments, undefined, testArrayContainsString);
                        } else {
                            subClause = this.generateComparison(dotpropPath, elemVal, statementArguments, sa.output_column);
                        }
                    } else if (isWhereFilterDefinition(elemVal)) {
                        // Object array: recurse with sub-PropertyTranslator scoped to array element schema
                        const subPropertyMap = new PropertyTranslatorSqliteJsonSchema(treeNode.schema!, sa.output_column, true);
                        const result = compileWhereFilterRecursive(elemVal, statementArguments, subPropertyMap, errors, rootFilter);
                        subClause = result;
                    }
                } else {
                    // Compound filter: break it apart and each one must match something
                    if (isPlainObject(filter)) {
                        const keys = Object.keys(filter) as Array<keyof typeof filter>;
                        let andClauses: string[] = [];

                        const subPropertyMap = new PropertyTranslatorSqliteJsonSchema(treeNode.schema!, sa.output_column, true);

                        keys.forEach(key => {
                            const subFilter: WhereFilterDefinition = { [key]: filter[key] };
                            const result = compileWhereFilterRecursive(subFilter, statementArguments, subPropertyMap, errors, rootFilter);
                            andClauses = [...andClauses, result];
                        });

                        const countColumns = andClauses.map((x, index) => {
                            const column_id = `sc${index}`;
                            return {
                                column_sql: `COUNT(DISTINCT CASE WHEN (${x}) THEN 1 END) AS ${column_id}`,
                                column_id
                            }
                        })

                        const compoundSql = `EXISTS (SELECT 1 FROM (SELECT ${countColumns.map(x => x.column_sql).join(',')} FROM ${sa.sql}) AS match_all WHERE ${countColumns.map(x => `${x.column_id} > 0`).join(` AND `)})`;
                        return compoundSql;

                    } else {
                        subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_identifier);
                    }
                }
            }

            const sql = `EXISTS (SELECT 1 FROM ${sa.sql} WHERE ${subClause})`;
            return sql;

        } else {
            return this.generateComparison(dotpropPath, filter, statementArguments, undefined, undefined, errors, rootFilter);
        }
    }

    /**
     * Emits a leaf-level SQL comparison for a single value.
     * $contains → LIKE, range → >/</>=/<= , scalar → =, object/array → json()=json(?), undefined → IS NULL.
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
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            const placeholders = filter.$in.map(v => this.generatePlaceholder(v, statementArguments));
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} IN (${placeholders.join(', ')})`);
        }
        // $nin
        if (isValueComparisonNin(filter)) {
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
            const jsonPath = '$.' + dotpropPath.split('.').join('.');
            const typeMap: Record<string, string> = {
                'string': 'text',
                'number': 'integer',  // json_type returns 'integer' or 'real'
                'boolean': 'true',    // json_type returns 'true' or 'false'
                'object': 'object',
                'array': 'array',
                'null': 'null',
            };
            if (filter.$type === 'number') {
                const placeholder1 = this.generatePlaceholder('integer', statementArguments);
                const placeholder2 = this.generatePlaceholder('real', statementArguments);
                return `json_type(${this.sqlColumnName}, '${jsonPath}') IN (${placeholder1}, ${placeholder2})`;
            } else if (filter.$type === 'boolean') {
                const placeholder1 = this.generatePlaceholder('true', statementArguments);
                const placeholder2 = this.generatePlaceholder('false', statementArguments);
                return `json_type(${this.sqlColumnName}, '${jsonPath}') IN (${placeholder1}, ${placeholder2})`;
            } else {
                const mappedType = typeMap[filter.$type] ?? filter.$type;
                const placeholder = this.generatePlaceholder(mappedType, statementArguments);
                return `json_type(${this.sqlColumnName}, '${jsonPath}') = ${placeholder}`;
            }
        }
        // $regex — SQLite has no native regex support
        if (isValueComparisonRegex(filter)) {
            if (errors && rootFilter) {
                errors.push({
                    kind: 'filter',
                    sub_filter: { [dotpropPath]: filter } as any,
                    root_filter: rootFilter as any,
                    message: '$regex is not supported in SQLite'
                });
            }
            return 'FALSE';
        }

        if (isValueComparisonContains(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);

            const placeholder = this.generatePlaceholder(`%${filter.$contains}%`, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} LIKE ${placeholder}`);
        } else if (isValueComparisonRange(filter)) {

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
                // SQLite doesn't have Pg's ? operator. Use EXISTS + json_each.
                const jsonPath = '$.' + dotpropPath.split('.').join('.');
                const sqlIdentifier = customSqlIdentifier ?? `json_extract(${this.sqlColumnName}, '${jsonPath}')`;
                return optionalWrapper(sqlIdentifier, `EXISTS (SELECT 1 FROM json_each(${this.sqlColumnName}, '${jsonPath}') WHERE value = ${placeholder})`);
            } else {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
            }
        } else if (isPlainObject(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodObject']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `json(${sqlIdentifier}) = json(${placeholder})`);
        } else if (Array.isArray(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodArray']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `json(${sqlIdentifier}) = json(${placeholder})`);
        } else if (filter === null) {
            // Explicit null filter → match SQL NULL (no optionalWrapper — IS NOT NULL guard would contradict)
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            return `${sqlIdentifier} IS NULL`;
        } else if (filter === undefined) {
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
 * SQLite PropertyTranslator that derives its TreeNodeMap from a Zod schema automatically.
 *
 * @example
 * const pm = new PropertyTranslatorSqliteJsonSchema(ContactSchema, 'recordColumn');
 */
export class PropertyTranslatorSqliteJsonSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorSqliteJson<T> implements IPropertyTranslator<T> {
    constructor(schema: z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?: boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
    }
}

/**
 * SQLite PropertyTranslator that accepts a pre-built TreeNodeMap directly.
 */
export class PropertyTranslatorSqliteJson<T extends Record<string, any> = Record<string, any>> extends BasePropertyTranslatorSqliteJson<T> implements IPropertyTranslator<T> {
    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}
