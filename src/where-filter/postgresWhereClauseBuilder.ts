
import { z } from "zod";
import { isArrayValueComparisonElemMatch, isLogicFilter, isValueComparisonContains, isValueComparisonNumeric, isValueComparisonScalar, isWhereFilterArray, isWhereFilterDefinition, ValueComparison, ValueComparisonNumericOperators, ValueComparisonNumericOperatorsTyped, WhereFilterDefinition, WhereFilterLogicOperators, WhereFilterLogicOperatorsTyped } from "./types";
import {  convertSchemaToDotPropPathTree, TreeNode, TreeNodeMap, ZodKind } from "../dot-prop-paths/zod";
import isPlainObject from "../utils/isPlainObject";
import { convertDotPropPathToPostgresJsonPath } from "./convertDotPropPathToPostgresJsonPath";


/*
Future improvements:
PropertyMap needs to be much more composable. It probably needs plugins for: 
- SQL Dialect / whether it's columner or JSONB
- Schema generated or custom 

*/




export default function postgresWhereClauseBuilder<T extends Record<string, any> = any>(filter:WhereFilterDefinition<T>, propertySqlMap:IPropertyMap<T>):PreparedWhereClauseStatement {
    const statementArguments:PreparedStatementArgument[] = [];

    const whereClauseStatement = _postgresWhereClauseBuilder<T>(filter, statementArguments, propertySqlMap);
    return {whereClauseStatement, statementArguments};
}

export interface IPropertyMap<T extends Record<string, any>> {
    generateSql(dotpropPath:string, filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[]):string;
}


class BasePropertyMap<T extends Record<string, any> = Record<string, any>> implements IPropertyMap<T> {
    protected nodeMap:TreeNodeMap;
    protected sqlColumnName:string;
    protected doNotSpreadArray:boolean;

    constructor(nodeMap:TreeNodeMap, sqlColumnName: string, doNotSpreadArray?:boolean) {
        this.nodeMap = nodeMap;
        this.sqlColumnName = sqlColumnName;
        this.doNotSpreadArray = doNotSpreadArray ?? false;
    }

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

    private getSqlIdentifier(dotPropPath:string, errorIfNotAsExpected?:ZodKind[], customColumnName?: string):string {
        return convertDotPropPathToPostgresJsonPath(customColumnName ?? this.sqlColumnName, dotPropPath, this.nodeMap, errorIfNotAsExpected);
    }

    protected generatePlaceholder(value:PreparedStatementArgumentOrObject, statementArguments:PreparedStatementArgument[]):string {

        if( isPlainObject(value) || Array.isArray(value) ) value = JSON.stringify(value);
        if( !isPreparedStatementArgument(value) ) {
            throw new Error("Placeholders for SQL can only be string/number/boolean");
        }
        statementArguments.push(value);
        return `$${statementArguments.length}`;
    }

    generateSql(dotpropPath:string, filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[]):string {
        // TODO Probably provide a version of this for JSONB that others can reference 
        const countArraysInPath = this.countArraysInPath(dotpropPath);
        if( countArraysInPath>0  ) { // && !this.doNotSpreadArray
            
            //throw new Error("Unsupported");
            // Almost all will involve the format EXISTS(SELECT 1 FROM jsonb_array_elements [CROSS JOIN...] WHERE <<as_column> run on _postgresWhereClauseBuilder>)

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
                    if( isWhereFilterDefinition(filter.elem_match) ) {
                        // Recurse
                        const subPropertyMap = new PropertyMapSchema(treeNode.schema!, sa.output_column, true);
                        const result = _postgresWhereClauseBuilder(filter.elem_match, statementArguments, subPropertyMap);
                        //return result;
                        subClause = result;

                        //throw new Error("Not figured out. Presume need to pass the identifier to override this.sqlColumnName, but what about dotPropPath scoping?");
                    } else {
                        const testArrayContainsString = typeof filter.elem_match==='string';
                        if( testArrayContainsString ) {
                            return this.generateComparison(dotpropPath, filter.elem_match, statementArguments, undefined, testArrayContainsString);
                        } else {
                            subClause = this.generateComparison(dotpropPath, filter.elem_match, statementArguments, sa.output_column);
                        }
                    }
                } else {
                    // Compound filter: break it apart and each one must match something
                    if( isPlainObject(filter) ) {                        
                        const keys = Object.keys(filter) as Array<keyof typeof filter>;
                        let andClauses:string[] = [];

                        const subPropertyMap = new PropertyMapSchema(treeNode.schema!, sa.output_column, true);

                        keys.forEach(key => {
                            const subFilter:WhereFilterDefinition = {[key]: filter[key]};
                            const result = _postgresWhereClauseBuilder(subFilter, statementArguments, subPropertyMap);
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

    protected generateComparison(dotpropPath:string, filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], customSqlIdentifier?:string, testArrayContainsString?:boolean):string {
        
        const optionalWrapper = (sqlIdentifier:string, query:string) => {
            if( !this.nodeMap[dotpropPath] ) throw new Error(`dotpropPath (${dotpropPath}) is not known in this.nodeMap`);
            if( this.nodeMap[dotpropPath]!.optional_or_nullable ) {
                return `(${sqlIdentifier} IS NOT NULL AND ${query})`;
            }
            return query;
        }

        if( isValueComparisonContains(filter) ) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodString']);

            const placeholder = this.generatePlaceholder(`%${filter.contains}%`, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} LIKE ${placeholder}`); // TODO Like ValueComparisonNumericOperatorsSqlFunctions, this should be a dialect pack 
        } else if( isValueComparisonNumeric(filter) ) {            
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath, ['ZodNumber']);

            const operators = ValueComparisonNumericOperators
                .filter((x):x is ValueComparisonNumericOperatorsTyped => x in filter && filter[x]!==undefined && filter[x]!==null)
                .map(x => {
                    const placeholder = this.generatePlaceholder(filter[x]!, statementArguments);
                    return ValueComparisonNumericOperatorsSqlFunctions[x](sqlIdentifier, placeholder);
                });
            return optionalWrapper(sqlIdentifier, operators.length>1? `(${operators.join(' AND ')})` : operators[0]!);
        
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
        } else {
            //debugger;
            throw new Error("Unknown filter type");
        }
    }
}



export class PropertyMapSchema<T extends Record<string, any> = Record<string, any>> extends BasePropertyMap<T> implements IPropertyMap<T> {
    constructor(schema:z.ZodSchema<T>, sqlColumnName: string, doNotSpreadArray?:boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, doNotSpreadArray);
    }
}
export class PropertyMap<T extends Record<string, any> = Record<string, any>> extends BasePropertyMap<T> implements IPropertyMap<T> {
    
    constructor(nodeMap:TreeNodeMap, sqlColumnName: string, doNotSpreadArray?:boolean) {
        super(nodeMap, sqlColumnName, doNotSpreadArray);
    }
}

function _postgresWhereClauseBuilder<T extends Record<string, any> = any>(filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], propertySqlMap:IPropertyMap<T>):string {
    
    // If there's more than 1 key on the filter, split it formally into an AND 
    const keys = Object.keys(filter) as Array<keyof typeof filter>;
    if( keys.length>1 ) {
        filter = {
            AND: keys.map(key => ({[key]: filter[key]}))
        }
    }

    if( isLogicFilter(filter) ) {
        let andClauses:string[] = [];

        for( const type of WhereFilterLogicOperators ) {
            const filterType = filter[type];
            if( isWhereFilterArray(filterType) ) {
                let subClauseString = '';
                const subClauses = [...filterType].map(subFilter => _postgresWhereClauseBuilder(subFilter, statementArguments, propertySqlMap));
                if( type==='NOT' ) {
                    subClauseString =`NOT (${subClauses.join(' OR ')})`;
                } else {
                    if( typeof subClauses[0]!=='string' ) throw new Error("subClauses[0] was empty");
                    subClauseString = subClauses.length===1? subClauses[0] : `(${subClauses.join(` ${type} `)})`;
                }
                andClauses = [...andClauses, subClauseString];
            }
        }
        
        return andClauses.length===1? andClauses[0]! : `(${andClauses.join(' AND ')})`;

    } else {
        const key = keys[0];
        if( typeof key!=='string' ) throw new Error("Bad number of keys - should have gone to logic filter.");

        return propertySqlMap.generateSql(key, filter[key] as WhereFilterDefinition, statementArguments);


    }
}


type SpreadedJsonbArrays = {sql: string, output_column: string, output_identifier:string};
/**
 * Combine jsonb_array_elements with CROSS JOIN to list every possible combination of all parent arrays, yielding a final column name that'll contain each permutation.
 * @param column 
 * @param nodesDesc 
 * @returns 
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

export type PreparedWhereClauseStatement = {whereClauseStatement:string, statementArguments:PreparedStatementArgument[]};
export type PreparedStatementArgument = string | number | boolean | null;
type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;
function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}



type ValueComparisonNumericOperatorSqlTyped = {
    [K in typeof ValueComparisonNumericOperators[number]]: (sqlKey:string, parameterizedQueryPlaceholder:string) => string; 
};
const ValueComparisonNumericOperatorsSqlFunctions:ValueComparisonNumericOperatorSqlTyped = {
    'gt': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} > ${parameterizedQueryPlaceholder}`,
    'lt': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} < ${parameterizedQueryPlaceholder}`,
    'gte': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} >= ${parameterizedQueryPlaceholder}`,
    'lte': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} <= ${parameterizedQueryPlaceholder}`,
}
