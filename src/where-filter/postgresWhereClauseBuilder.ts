
import { z } from "zod";
import type {  ValueComparisonFlexi, ValueComparisonRangeOperatorsTyped, WhereFilterDefinition } from "./types.js";
import {isArrayValueComparisonElemMatch, isValueComparisonContains, isWhereFilterDefinition } from './schemas.ts';
import {  convertSchemaToDotPropPathTree } from "../dot-prop-paths/zod.js";
import type {  TreeNode, TreeNodeMap, ZodKind } from "../dot-prop-paths/zod.js";
import isPlainObject from "../utils/isPlainObject.js";
import { convertDotPropPathToPostgresJsonPath } from "./convertDotPropPathToPostgresJsonPath.js";
import { isValueComparisonRange, isValueComparisonScalar } from "./typeguards.ts";
import { ValueComparisonRangeOperators } from "./consts.ts";
import { buildWhereClause, whereClauseBuilder, isPreparedStatementArgument } from "./whereClauseEngine.ts";
import type { IPropertyMap, PreparedWhereClauseStatement, PreparedStatementArgument, PreparedStatementArgumentOrObject } from "./whereClauseEngine.ts";

/*
Future improvements:
PropertyMap needs to be much more composable. It probably needs plugins for: 
- SQL Dialect / whether it's columner or JSONB
- Schema generated or custom 

*/




// Re-export shared types from engine for backwards compatibility
export type { IPropertyMap, PreparedWhereClauseStatement, PreparedStatementArgument };

/**
 * Converts a WhereFilterDefinition into a parameterised Postgres WHERE clause for a JSONB column.
 * Entry point for the whole pipeline: validates the filter, then delegates to the recursive builder.
 *
 * @example
 * const pm = new PropertyMapSchema(myZodSchema, 'data');
 * const { whereClauseStatement, statementArguments } = postgresWhereClauseBuilder({ name: 'Andy' }, pm);
 * // whereClauseStatement: "(data->>'name')::text = $1"
 * // statementArguments: ['Andy']
 */
export default function postgresWhereClauseBuilder<T extends Record<string, any> = any>(filter:WhereFilterDefinition<T>, propertySqlMap:IPropertyMap<T>):PreparedWhereClauseStatement {
    return buildWhereClause(filter, propertySqlMap);
}


/**
 * Postgres JSONB implementation of IPropertyMap.
 * Generates SQL fragments for a single JSONB column using TreeNodeMap for type-aware casting,
 * array spreading via jsonb_array_elements, and parameterised placeholders.
 */
class BasePropertyMap<T extends Record<string, any> = Record<string, any>> implements IPropertyMap<T> {
    protected nodeMap:TreeNodeMap;
    protected sqlColumnName:string;
    protected doNotSpreadArray:boolean;

    constructor(nodeMap:TreeNodeMap, sqlColumnName: string, doNotSpreadArray?:boolean) {
        this.nodeMap = nodeMap;
        this.sqlColumnName = sqlColumnName;
        this.doNotSpreadArray = doNotSpreadArray ?? false;
    }

    /** Counts how many ZodArray nodes exist in the ancestry chain for a path. Determines whether array spreading is needed. */
    private countArraysInPath(dotpropPath:string):number {
        if( (this.nodeMap[dotpropPath]?.kind==='ZodArray' || this.nodeMap[dotpropPath]?.descended_from_array) ) {
            let count = 0; 
            let target:TreeNode | undefined = this.nodeMap[dotpropPath];
            while( target ) {
                if( target.kind==='ZodArray' ) count++;
                target = target?.parent;
            }
            return count;
        } else {
            return 0;
        }
    }

    /** Wraps convertDotPropPathToPostgresJsonPath, using this instance's column name and nodeMap. */
    private getSqlIdentifier(dotPropPath:string, errorIfNotAsExpected?:ZodKind[], customColumnName?: string):string {
        return convertDotPropPathToPostgresJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
    }

    /** Pushes a value into the statementArguments array and returns its `$N` placeholder. Objects/arrays are JSON.stringify'd first. */
    protected generatePlaceholder(value:PreparedStatementArgumentOrObject, statementArguments:PreparedStatementArgument[]):string {

        if( isPlainObject(value) || Array.isArray(value) ) value = JSON.stringify(value);
        if( !isPreparedStatementArgument(value) ) {
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
    generateSql(dotpropPath:string, filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[]):string {
        // TODO Probably provide a version of this for JSONB that others can reference
        const countArraysInPath = this.countArraysInPath(dotpropPath);
        if( countArraysInPath>0  ) { // && !this.doNotSpreadArray
            
            //throw new Error("Unsupported");
            // Almost all will involve the format EXISTS(SELECT 1 FROM jsonb_array_elements [CROSS JOIN...] WHERE <<as_column> run on whereClauseBuilder>)

            const path = [];
            let target:TreeNode | undefined = this.nodeMap[dotpropPath];
            while( target ) {
                path.unshift(target);
                target = target?.parent;
            }
            let sa:SpreadedJsonbArrays | undefined;

            let subClause:string = '';
            const treeNode = this.nodeMap[dotpropPath];
            if( !treeNode ) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if( Array.isArray(filter) ) {
                if( treeNode.kind!=='ZodArray' ) throw new Error("Cannot compare an array to a non-array");
                if( countArraysInPath===1 ) {
                    // Just do a direct comparison
                    return this.generateComparison(dotpropPath, filter, statementArguments);
                } else {
                    // Ignore the last array in the path, as this is comparing an array against it (not its elements)
                    path.pop();
                    
                    sa = spreadJsonbArrays(this.sqlColumnName, path);
                    if( !sa ) throw new Error("Could not locate array in path: "+dotpropPath);

                    if( treeNode.kind!=='ZodArray' ) throw new Error("Cannot compare an array to a non-array");
                    subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_column);
                }
                
            } else if( this.doNotSpreadArray && countArraysInPath===1 ) {
                // With just 1 array, we don't want to do the spread. In fact we're arriving from a spread (that's what column name is). So we need the identifier on it. 
                // It is probably spreading an array, and has recursed into this 
                
                const identifier = this.getSqlIdentifier(dotpropPath, undefined, this.sqlColumnName);
                return this.generateComparison(dotpropPath, filter, statementArguments, `${identifier}`);
            } else {
                
                sa = spreadJsonbArrays(this.sqlColumnName, path);
                if( !sa ) throw new Error("Could not locate array in path: "+dotpropPath);
                if( isArrayValueComparisonElemMatch(filter) ) {
                    // Check for scalar value comparisons first to avoid the ambiguity
                    // where operator objects like {$gt: 5} pass isWhereFilterDefinition.
                    const elemVal = filter.$elemMatch;
                    if( isValueComparisonScalar(elemVal) || isValueComparisonContains(elemVal) || isValueComparisonRange(elemVal) ) {
                        // Scalar value comparison — output_identifier extracts text via #>> '{}',
                        // but numeric comparisons need an explicit ::numeric cast.
                        const testArrayContainsString = typeof elemVal==='string';
                        if( testArrayContainsString ) {
                            return this.generateComparison(dotpropPath, elemVal, statementArguments, undefined, testArrayContainsString);
                        } else {
                            // Determine if numeric cast is needed for range operators
                            let customId = sa.output_identifier;
                            if( isValueComparisonRange(elemVal) ) {
                                const firstVal = Object.values(elemVal)[0];
                                if( typeof firstVal === 'number' ) {
                                    customId = `(${sa.output_identifier})::numeric`;
                                }
                            } else if( typeof elemVal === 'number' ) {
                                customId = `(${sa.output_identifier})::numeric`;
                            }
                            subClause = this.generateComparison(dotpropPath, elemVal, statementArguments, customId);
                        }
                    } else if( isWhereFilterDefinition(elemVal) ) {
                        // Object array: recurse with sub-PropertyMap
                        const subPropertyMap = new PropertyMapSchema(treeNode.schema!, sa.output_column, true);
                        const result = whereClauseBuilder(elemVal, statementArguments, subPropertyMap);
                        subClause = result;
                    }
                } else {
                    // Compound filter: break it apart and each one must match something
                    if( isPlainObject(filter) ) {                        
                        const keys = Object.keys(filter) as Array<keyof typeof filter>;
                        let andClauses:string[] = [];

                        const subPropertyMap = new PropertyMapSchema(treeNode.schema!, sa.output_column, true);

                        keys.forEach(key => {
                            const subFilter:WhereFilterDefinition = {[key]: filter[key]};
                            const result = whereClauseBuilder(subFilter, statementArguments, subPropertyMap);
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
            

            return this.generateComparison(dotpropPath, filter, statementArguments);
        }
    }

    /**
     * Emits a leaf-level SQL comparison for a single value ($contains → LIKE, range → >/</>=/<= , scalar → =, object/array → =::jsonb, undefined → IS NULL).
     * Wraps optional/nullable paths with an IS NOT NULL guard.
     */
    protected generateComparison(dotpropPath:string, filter:WhereFilterDefinition<T> | ValueComparisonFlexi<string | number | boolean> | PreparedStatementArgumentOrObject[] | undefined, statementArguments: PreparedStatementArgument[], customSqlIdentifier?:string, testArrayContainsString?:boolean):string {
        
        const optionalWrapper = (sqlIdentifier:string, query:string) => {
            if( !this.nodeMap[dotpropPath] ) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if( this.nodeMap[dotpropPath]!.optional_or_nullable ) {
                return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
            }
            return query;
        }

        if( isValueComparisonContains(filter) ) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);

            const placeholder = this.generatePlaceholder(`%${filter.$contains}%`, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} LIKE ${placeholder}`); // TODO Like ValueComparisonRangeOperatorsSqlFunctions, this should be a dialect pack 
        } else if( isValueComparisonRange(filter) ) {            

            // Range comparison can be string or filter, so we need to determinate what we're dealing with to set the SQL straight. 
            // E.g. if the filter is {$gt: 'A'}, this will be 'string'. If the filter is {$gt: 1}, this will be 'number'.
            const firstFilterValueType = typeof (Object.values(filter)[0]);
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, [firstFilterValueType==='string'? 'ZodString' :'ZodNumber']);

            const operators = ValueComparisonRangeOperators
                .filter((x):x is ValueComparisonRangeOperatorsTyped => x in filter && filter[x]!==undefined && filter[x]!==null)
                .map(x => {
                    const placeholder = this.generatePlaceholder(filter[x]!, statementArguments);
                    return ValueComparisonRangeOperatorsSqlFunctions[x](sqlIdentifier, placeholder);
                });
            const result = optionalWrapper(sqlIdentifier, operators.length>1? `(${operators.join(' AND ')})` : operators[0]!);
            return result;
        
        } else if( isValueComparisonScalar(filter) ) {
            

            const placeholder = this.generatePlaceholder(filter, statementArguments);
            if( testArrayContainsString ) {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodArray']);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} ? ${placeholder}`);
            } else {
                const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
                return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
            }
        } else if( isPlainObject(filter) ) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodObject']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
        } else if( Array.isArray(filter) ) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodArray']);
            const placeholder = this.generatePlaceholder(filter, statementArguments);
            //debugger;
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}::jsonb`);
        } else if( filter===undefined ) {
            // Want it to return nothing (same as matchJavascriptObject), so treat it as a null
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} IS NULL`);
        } else {
            //debugger;
            let filterString = 'na';
            try {
                filterString = JSON.stringify(filter);
            } finally {
                throw new Error("Unknown filter type: "+filterString);
            }
            
        }
    }
}



/**
 * PropertyMap that derives its TreeNodeMap from a Zod schema automatically.
 *
 * @example
 * const pm = new PropertyMapSchema(ContactSchema, 'recordColumn');
 */
export class PropertyMapSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyMap<T> implements IPropertyMap<T> {
    constructor(schema:z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?:boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
    }
}
/**
 * PropertyMap that accepts a pre-built TreeNodeMap directly (when schema introspection is already done).
 */
export class PropertyMap<T extends Record<string, any> = Record<string, any>> extends BasePropertyMap<T> implements IPropertyMap<T> {

    constructor(nodeMap:TreeNodeMap, sqlColumnName: string, doNotSpreadArray?:boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}

type SpreadedJsonbArrays = {sql: string, output_column: string, output_identifier:string};
/**
 * Builds a FROM clause that spreads nested JSONB arrays using `jsonb_array_elements`, joined via CROSS JOIN.
 * Each array layer in the TreeNode path produces a new aliased column. Used by generateSql to wrap
 * array-path filters in `EXISTS (SELECT 1 FROM <this output> WHERE ...)`.
 *
 * @example
 * // For path children.grandchildren.name (two arrays):
 * // → "jsonb_array_elements(col->'children') AS col1 CROSS JOIN jsonb_array_elements(col1->'grandchildren') AS col2"
 */
export function spreadJsonbArrays(column:string, nodesDesc:TreeNode[]):SpreadedJsonbArrays | undefined {
    const jsonbbArrayElementsParts:{sql:string, output_column:string}[] = [];

    let arrayDepth = 1;
    let jsonbParts:string[] = [column];
    for( let i = 0; i < nodesDesc.length; i++ ) {
        const node = nodesDesc[i];
        if( !node ) throw new Error("node was empty in spreadJsonbArrays");
        if( node.name ) {
            jsonbParts.push(`'${node.name}'`);
            if( node.kind==='ZodArray' ) {
                
                const newColumn = column+arrayDepth;
                const outputColumn = `${newColumn}`;

                jsonbbArrayElementsParts.push({
                    sql: `jsonb_array_elements(${jsonbParts.join('->')}) AS ${newColumn}`,
                    output_column: outputColumn
                })

                arrayDepth++;
                jsonbParts = [outputColumn];
                
            }
        }
    }

    if( jsonbbArrayElementsParts.length===0 ) return undefined;

    const output_column = jsonbbArrayElementsParts[jsonbbArrayElementsParts.length-1]!.output_column;
    return {
        sql: jsonbbArrayElementsParts.map(x => x.sql).join(` CROSS JOIN `),
        output_column,
        output_identifier: `${output_column} #>> '{}'` // This uses the JSONB text extraction operator (#>>) with an empty array ({}) as the path, which converts the JSONB element into text if it is a scalar (like a string or a number).
    }
}


type ValueComparisonRangeNumericOperatorSqlTyped = {
    [K in typeof ValueComparisonRangeOperators[number]]: (sqlKey:string, parameterizedQueryPlaceholder:string) => string; 
};
const ValueComparisonRangeOperatorsSqlFunctions:ValueComparisonRangeNumericOperatorSqlTyped = {
    '$gt': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} > ${parameterizedQueryPlaceholder}`,
    '$lt': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} < ${parameterizedQueryPlaceholder}`,
    '$gte': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} >= ${parameterizedQueryPlaceholder}`,
    '$lte': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} <= ${parameterizedQueryPlaceholder}`,
}
