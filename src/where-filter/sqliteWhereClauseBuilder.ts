
import { z } from "zod";
import type { ValueComparisonFlexi, ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "./types.js";
import { isArrayValueComparisonElemMatch, isValueComparisonContains, isWhereFilterDefinition } from './schemas.ts';
import { convertSchemaToDotPropPathTree } from "../dot-prop-paths/zod.js";
import type { TreeNode, TreeNodeMap, ZodKind } from "../dot-prop-paths/zod.js";
import isPlainObject from "../utils/isPlainObject.js";
import { convertDotPropPathToSqliteJsonPath } from "./convertDotPropPathToSqliteJsonPath.js";
import { isValueComparisonRange, isValueComparisonScalar } from "./typeguards.ts";
import { ValueComparisonRangeOperators } from "./consts.ts";
import { buildWhereClause, whereClauseBuilder, isPreparedStatementArgument } from "./whereClauseEngine.ts";
import type { IPropertyMap, PreparedWhereClauseStatement, PreparedStatementArgument, PreparedStatementArgumentOrObject } from "./whereClauseEngine.ts";

/**
 * Converts a WhereFilterDefinition into a parameterised SQLite WHERE clause for a JSON column.
 * SQLite equivalent of postgresWhereClauseBuilder: validates the filter, then delegates to the shared recursive engine.
 *
 * @example
 * const pm = new SqlitePropertyMapSchema(myZodSchema, 'data');
 * const { whereClauseStatement, statementArguments } = sqliteWhereClauseBuilder({ name: 'Andy' }, pm);
 * // whereClauseStatement: "json_extract(data, '$.name') = ?"
 * // statementArguments: ['Andy']
 */
export default function sqliteWhereClauseBuilder<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, propertySqlMap: IPropertyMap<T>): PreparedWhereClauseStatement {
    return buildWhereClause(filter, propertySqlMap);
}


/**
 * SQLite JSON implementation of IPropertyMap.
 * Generates SQL fragments for a single JSON TEXT column using TreeNodeMap for path validation,
 * json_each for array spreading, and ? positional placeholders.
 */
class SqliteBasePropertyMap<T extends Record<string, any> = Record<string, any>> implements IPropertyMap<T> {
    protected nodeMap: TreeNodeMap;
    protected sqlColumnName: string;
    protected doNotSpreadArray: boolean;

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

    /** Wraps convertDotPropPathToSqliteJsonPath using this instance's column name and nodeMap. */
    private getSqlIdentifier(dotPropPath: string, errorIfNotAsExpected?: ZodKind[], customColumnName?: string): string {
        return convertDotPropPathToSqliteJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
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
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[]): string {
        const countArraysInPath = this.countArraysInPath(dotpropPath);
        if (countArraysInPath > 0) {

            const path: TreeNode[] = [];
            let target: TreeNode | undefined = this.nodeMap[dotpropPath];
            while (target) {
                path.unshift(target);
                target = target?.parent;
            }
            let sa: SpreadedJsonArrays | undefined;

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
                if (isArrayValueComparisonElemMatch(filter)) {
                    // Check for scalar value comparisons first to avoid the ambiguity
                    // where operator objects like {gt: 5} pass isWhereFilterDefinition.
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
                        // Object array: recurse with sub-PropertyMap scoped to array element schema
                        const subPropertyMap = new SqlitePropertyMapSchema(treeNode.schema!, sa.output_column, true);
                        const result = whereClauseBuilder(elemVal, statementArguments, subPropertyMap);
                        subClause = result;
                    }
                } else {
                    // Compound filter: break it apart and each one must match something
                    if (isPlainObject(filter)) {
                        const keys = Object.keys(filter) as Array<keyof typeof filter>;
                        let andClauses: string[] = [];

                        const subPropertyMap = new SqlitePropertyMapSchema(treeNode.schema!, sa.output_column, true);

                        keys.forEach(key => {
                            const subFilter: WhereFilterDefinition = { [key]: filter[key] };
                            const result = whereClauseBuilder(subFilter, statementArguments, subPropertyMap);
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
            return this.generateComparison(dotpropPath, filter, statementArguments);
        }
    }

    /**
     * Emits a leaf-level SQL comparison for a single value.
     * contains → LIKE, range → >/</>=/<= , scalar → =, object/array → json()=json(?), undefined → IS NULL.
     * Wraps optional/nullable paths with an IS NOT NULL guard.
     */
    protected generateComparison(dotpropPath: string, filter: WhereFilterDefinition<T> | ValueComparisonFlexi<string | number | boolean> | PreparedStatementArgumentOrObject[] | undefined, statementArguments: PreparedStatementArgument[], customSqlIdentifier?: string, testArrayContainsString?: boolean): string {

        const optionalWrapper = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if (this.nodeMap[dotpropPath]!.optional_or_nullable) {
                return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
            }
            return query;
        }

        if (isValueComparisonContains(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);

            const placeholder = this.generatePlaceholder(`%${filter.contains}%`, statementArguments);
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
 * SQLite PropertyMap that derives its TreeNodeMap from a Zod schema automatically.
 *
 * @example
 * const pm = new SqlitePropertyMapSchema(ContactSchema, 'recordColumn');
 */
export class SqlitePropertyMapSchema<T extends Record<string, any> = Record<string, any>> extends SqliteBasePropertyMap<T> implements IPropertyMap<T> {
    constructor(schema: z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?: boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
    }
}

/**
 * SQLite PropertyMap that accepts a pre-built TreeNodeMap directly.
 */
export class SqlitePropertyMap<T extends Record<string, any> = Record<string, any>> extends SqliteBasePropertyMap<T> implements IPropertyMap<T> {
    constructor(nodeMap: TreeNodeMap, sqlColumnName: string, doNotSpreadArray?: boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}


type SpreadedJsonArrays = { sql: string, output_column: string, output_identifier: string };
/**
 * Builds a FROM clause that spreads nested JSON arrays using `json_each()`, joined via CROSS JOIN.
 * SQLite equivalent of spreadJsonbArrays. Each array layer produces a new aliased table.
 *
 * @example
 * // For path children.grandchildren.name (two arrays):
 * // → "json_each(col, '$.children') AS je1 CROSS JOIN json_each(je1.value, '$.grandchildren') AS je2"
 * // output_column: "je2.value", output_identifier: "je2.value"
 */
export function spreadJsonArraysSqlite(column: string, nodesDesc: TreeNode[]): SpreadedJsonArrays | undefined {
    const parts: { sql: string, output_value: string }[] = [];

    // Derive alias prefix from column to avoid conflicts in nested spreading.
    // Top-level: column='recordColumn' → prefix='je', aliases: je1, je2
    // Nested: column='je1.value' → prefix='je1_', aliases: je1_1, je1_2
    const aliasMatch = column.match(/^(je\S*)\./);
    const aliasBase = aliasMatch ? aliasMatch[1] + '_' : 'je';

    let arrayDepth = 1;
    let currentSource = column;
    let pathSegments: string[] = [];

    for (let i = 0; i < nodesDesc.length; i++) {
        const node = nodesDesc[i];
        if (!node) throw new Error("node was empty in spreadJsonArraysSqlite");
        if (node.name) {
            pathSegments = [...pathSegments, node.name];
            if (node.kind === 'ZodArray') {
                const alias = `${aliasBase}${arrayDepth}`;
                const jsonPath = '$.' + pathSegments.join('.');
                parts.push({
                    sql: `json_each(${currentSource}, '${jsonPath}') AS ${alias}`,
                    output_value: `${alias}.value`
                });

                arrayDepth++;
                currentSource = `${alias}.value`;
                pathSegments = [];
            }
        }
    }

    if (parts.length === 0) return undefined;

    const lastPart = parts[parts.length - 1]!;
    return {
        sql: parts.map(p => p.sql).join(' CROSS JOIN '),
        output_column: lastPart.output_value,
        output_identifier: lastPart.output_value
    };
}


type ValueComparisonRangeOperatorSqlTyped = {
    [K in typeof ValueComparisonRangeOperators[number]]: (sqlKey: string, parameterizedQueryPlaceholder: string) => string;
};
const ValueComparisonRangeOperatorsSqlFunctions: ValueComparisonRangeOperatorSqlTyped = {
    'gt': (sqlKey, placeholder) => `${sqlKey} > ${placeholder}`,
    'lt': (sqlKey, placeholder) => `${sqlKey} < ${placeholder}`,
    'gte': (sqlKey, placeholder) => `${sqlKey} >= ${placeholder}`,
    'lte': (sqlKey, placeholder) => `${sqlKey} <= ${placeholder}`,
}
