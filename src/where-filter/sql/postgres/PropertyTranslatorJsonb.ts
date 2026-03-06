
import { z } from "zod";
import type { ValueComparisonFlexi, ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "../../types.ts";
import { isArrayValueComparisonElemMatch, isArrayValueComparisonAll, isArrayValueComparisonSize, isValueComparisonContains, isValueComparisonNe, isValueComparisonIn, isValueComparisonNin, isValueComparisonNot, isValueComparisonExists, isValueComparisonType, isValueComparisonRegex, isWhereFilterDefinition } from '../../schemas.ts';
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import type { TreeNode, TreeNodeMap, ZodKind } from "../../../dot-prop-paths/zod.ts";
import isPlainObject from "../../../utils/isPlainObject.ts";
import { convertDotPropPathToPostgresJsonPath } from "./convertDotPropPathToPostgresJsonPath.ts";
import { isValueComparisonRange, isValueComparisonScalar } from "../../typeguards.ts";
import { ValueComparisonRangeOperators } from "../../consts.ts";
import { compileWhereFilter, compileWhereFilterRecursive } from "../compileWhereFilter.ts";
import { isPreparedStatementArgument } from "../types.ts";
import type { IPropertyTranslator, PreparedWhereClauseResult, PreparedStatementArgument, PreparedStatementArgumentOrObject, WhereClauseError } from "../types.ts";
import { ValueComparisonRangeOperatorsSqlFunctions } from "../sharedSqlOperators.ts";
import { spreadJsonbArrays } from "./spreadJsonbArrays.ts";

/**
 * Converts a WhereFilterDefinition into a parameterised Postgres WHERE clause for a JSONB column.
 * The mental model: your Zod schema describes the shape stored in a JSONB column, and this function
 * turns a MongoDB-style query object into the equivalent SQL WHERE clause with positional `$N` parameters.
 * Internally validates the filter, walks the filter tree, and delegates leaf comparisons to a PropertyTranslator.
 *
 * @example
 * const pm = new PropertyTranslatorJsonbSchema(myZodSchema, 'data');
 * const result = postgresWhereClauseBuilder({ name: 'Andy' }, pm);
 * if (result.success) { use(result.where_clause_statement, result.statement_arguments); }
 */
export default function postgresWhereClauseBuilder<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, propertySqlMap: IPropertyTranslator<T>): PreparedWhereClauseResult {
    return compileWhereFilter(filter, propertySqlMap);
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

    /** Wraps convertDotPropPathToPostgresJsonPath, using this instance's column name and nodeMap. */
    private getSqlIdentifier(dotPropPath: string, errorIfNotAsExpected?: ZodKind[], customColumnName?: string): string {
        return convertDotPropPathToPostgresJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
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
     * Compound array filters use COUNT(DISTINCT CASE WHEN...) so different elements can satisfy different keys.
     */
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {
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
                    // Use jsonb_array_length on the raw JSONB array path
                    const jsonbPath = convertDotPropPathToPostgresJsonPath(this.sqlColumnName, dotpropPath, this.nodeMap, undefined, true);
                    const placeholder = this.generatePlaceholder(filter.$size, statementArguments);
                    return `jsonb_array_length(${jsonbPath}) = ${placeholder}`;
                }
                // $exists on array
                if (isValueComparisonExists(filter)) {
                    const jsonbPath = convertDotPropPathToPostgresJsonPath(this.sqlColumnName, dotpropPath, this.nodeMap, undefined, true);
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
                    const placeholder = this.generatePlaceholder(filter.$type, statementArguments);
                    return `jsonb_typeof(${rawJsonbExpr}) = ${placeholder}`;
                }

                if (isArrayValueComparisonElemMatch(filter)) {
                    // Check for scalar value comparisons first to avoid the ambiguity
                    // where operator objects like {$gt: 5} pass isWhereFilterDefinition.
                    const elemVal = filter.$elemMatch;
                    if (isValueComparisonScalar(elemVal) || isValueComparisonContains(elemVal) || isValueComparisonRange(elemVal)) {
                        // Scalar value comparison — output_identifier extracts text via #>> '{}',
                        // but numeric comparisons need an explicit ::numeric cast.
                        const testArrayContainsString = typeof elemVal === 'string';
                        if (testArrayContainsString) {
                            return this.generateComparison(dotpropPath, elemVal, statementArguments, undefined, testArrayContainsString);
                        } else {
                            // Determine if numeric cast is needed for range operators
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
                    } else if (isWhereFilterDefinition(elemVal)) {
                        // Object array: recurse with sub-PropertyTranslator
                        const subPropertyMap = new PropertyTranslatorJsonbSchema(treeNode.schema!, sa.output_column, true);
                        const result = compileWhereFilterRecursive(elemVal, statementArguments, subPropertyMap, errors, rootFilter);
                        subClause = result;
                    }
                } else {
                    // Compound filter: break it apart and each one must match something
                    if (isPlainObject(filter)) {
                        const keys = Object.keys(filter) as Array<keyof typeof filter>;
                        let andClauses: string[] = [];

                        const subPropertyMap = new PropertyTranslatorJsonbSchema(treeNode.schema!, sa.output_column, true);

                        keys.forEach(key => {
                            const subFilter: WhereFilterDefinition = { [key]: filter[key] };
                            const result = compileWhereFilterRecursive(subFilter, statementArguments, subPropertyMap, errors, rootFilter);
                            andClauses = [
                                ...andClauses,
                                result
                            ];
                        });

                        const countColumns = andClauses.map((x, index) => {
                            const column_id = `sc${index}`;
                            return {
                                column_sql: `COUNT(DISTINCT CASE WHEN (${x}) THEN 1 END) AS ${column_id}`,
                                column_id
                            }
                        })

                        // This has to use another technique, because we want every AND to be represented once, but not necessarily on the same row
                        // So we count the appearance of each AND, and are only satisfied if they're all present

                        const compoundSql = `EXISTS (SELECT 1 FROM (SELECT ${countColumns.map(x => x.column_sql).join(',')} FROM ${sa.sql}) as match_all WHERE ${countColumns.map(x => `${x.column_id} > 0`).join(` AND `)})`;
                        return compoundSql;

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
     * Emits a leaf-level SQL comparison for a single value ($contains → LIKE, range → >/</>=/<= , scalar → =, object/array → =::jsonb, undefined → IS NULL).
     * Wraps optional/nullable paths with an IS NOT NULL guard.
     */
    protected generateComparison(dotpropPath: string, filter: WhereFilterDefinition<T> | ValueComparisonFlexi<string | number | boolean> | PreparedStatementArgumentOrObject[] | undefined, statementArguments: PreparedStatementArgument[], customSqlIdentifier?: string, testArrayContainsString?: boolean, errors?: WhereClauseError[], rootFilter?: WhereFilterDefinition<T>): string {

        const optionalWrapper = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if (this.nodeMap[dotpropPath]!.optional_or_nullable) {
                return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
            }
            return query;
        }

        /** Wrapper for optional fields where missing matches (e.g. $ne, $nin, $not). */
        const optionalWrapperNullMatches = (sqlIdentifier: string, query: string) => {
            if (!this.nodeMap[dotpropPath]) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
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
            const placeholder = this.generatePlaceholder(filter.$type, statementArguments);
            return `jsonb_typeof(${rawJsonbExpr}) = ${placeholder}`;
        }
        // $regex
        if (isValueComparisonRegex(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);
            const placeholder = this.generatePlaceholder(filter.$regex, statementArguments);
            const op = filter.$options?.includes('i') ? '~*' : '~';
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} ${op} ${placeholder}`);
        }

        if (isValueComparisonContains(filter)) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);

            const placeholder = this.generatePlaceholder(`%${filter.$contains}%`, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} LIKE ${placeholder}`);
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
