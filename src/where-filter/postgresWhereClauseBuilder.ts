
import { z } from "zod";
import { isArrayValueComparisonElemMatch, isLogicFilter, isValueComparisonContains, isValueComparisonNumeric, isValueComparisonScalar, isWhereFilterArray, isWhereFilterDefinition, ValueComparison, ValueComparisonNumericOperators, ValueComparisonNumericOperatorsTyped, WhereFilterDefinition, WhereFilterLogicOperators, WhereFilterLogicOperatorsTyped } from "./types";
import { convertSchemaToDotPropPathKind, convertSchemaToDotPropPathTree, TreeNode, TreeNodeMap, ZodKind } from "../dot-prop-paths/zod";
import isPlainObject from "../utils/isPlainObject";

/*
Future improvements:
PropertyMap needs to be much more composable. It probably needs plugins for: 
- SQL Dialect / whether it's columner or JSONB
- Schema generated or custom 

*/


export default function postgresWhereClauseBuilder<T extends Record<string, any> = any>(filter:WhereFilterDefinition<T>, propertySqlMap:PropertyMap):PreparedWhereClauseStatement {
    const statementArguments:PreparedStatementArgument[] = [];

    const whereClauseStatement = _postgresWhereClauseBuilder(filter, statementArguments, propertySqlMap);
    return {whereClauseStatement, statementArguments};
}

export interface IPropertyMap<T extends Record<string, any>> {
    generateSql(dotpropPath:string, filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[]):string;
}

class BasePropertyMap<T extends Record<string, any> = Record<string, any>> implements IPropertyMap<T> {
    protected nodeMap:TreeNodeMap;
    protected sqlColumnName:string;
    protected evaluateAsNonArray:boolean;

    constructor(nodeMap:TreeNodeMap, sqlColumnName: string, evaluateAsNonArray?:boolean) {
        this.nodeMap = nodeMap;
        this.sqlColumnName = sqlColumnName;
        this.evaluateAsNonArray = evaluateAsNonArray ?? false;
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
        if( !this.nodeMap[dotPropPath] ) {
            debugger;
            throw new Error("Unknown dotPropPath. It's unsafe to generate a SQL identifier for this.");
        }

        const jsonbParts = dotPropPath.split(".");
        const castingMap:Partial<Record<ZodKind, string>> = {
            'ZodString': '::text', 
            'ZodNumber': '::numeric', 
            'ZodBoolean': '::boolean', 
            'ZodBigInt': '::bigint',
            'ZodObject': '::jsonb',
            'ZodArray': '::jsonb',
            'ZodNull': '',
        }
        
        let jsonbPath:string = '';
        while(jsonbParts.length) {
            const part = jsonbParts.shift();
            jsonbPath += `${jsonbParts.length? '->' : '->>'}'${part}'`;
        }

        const zodKind = this.nodeMap[dotPropPath].kind;
        if( !castingMap[zodKind] ) throw new Error("Unknown ZodKind Postgres cast: "+zodKind);

        return `(${customColumnName ?? this.sqlColumnName}${jsonbPath})${castingMap[zodKind] ?? ''}`
        
   
    }

    protected generatePlaceholder(value:PreparedStatementArgument, statementArguments:PreparedStatementArgument[]):string {

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
        if( countArraysInPath>0  ) { // && !this.evaluateAsNonArray
            
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
            if( Array.isArray(filter) ) {
                if( this.nodeMap[dotpropPath].kind!=='ZodArray' ) throw new Error("Cannot compare an array to a non-array");
                if( countArraysInPath===1 ) {
                    // Just do a direct comparison
                    return this.generateComparison(dotpropPath, filter, statementArguments);
                } else {
                    // Ignore the last array in the path, as this is comparing an array against it (not its elements)
                    path.pop();
                    
                    sa = spreadJsonbArrays(this.sqlColumnName, path);
                    if( !sa ) throw new Error("Could not locate array in path: "+dotpropPath);

                    if( this.nodeMap[dotpropPath].kind!=='ZodArray' ) throw new Error("Cannot compare an array to a non-array");
                    subClause = this.generateComparison(dotpropPath, filter, statementArguments, sa.output_column);
                }
                
            } else if( this.evaluateAsNonArray && countArraysInPath===1 ) {
                // this.nodeMap[''].kind==='ZodArray' && !this.nodeMap[''].name && 
                // With just 1 array, we don't want to do the spread. In fact we're arriving from a spread (that's what column name is). So we need the identifier on it. 
                // The problem is that 
                // It is probably spreading an array, and has recursed into this 
                
                const identifier = this.getSqlIdentifier(dotpropPath, undefined, this.sqlColumnName);
                return this.generateComparison(dotpropPath, filter, statementArguments, `${identifier}`);
            } else {
                sa = spreadJsonbArrays(this.sqlColumnName, path);
                if( !sa ) throw new Error("Could not locate array in path: "+dotpropPath);
                if( isArrayValueComparisonElemMatch(filter) ) {
                    if( isWhereFilterDefinition(filter.elem_match) ) {
                        // Recurse
                        const subPropertyMap = new PropertyMapSchema(this.nodeMap[dotpropPath].schema!, sa.output_column, true);
                        const result = _postgresWhereClauseBuilder(filter.elem_match, statementArguments, subPropertyMap);
                        //return result;
                        subClause = result;

                        //throw new Error("Not figured out. Presume need to pass the identifier to override this.sqlColumnName, but what about dotPropPath scoping?");
                    } else {
                        subClause = this.generateComparison(dotpropPath, filter.elem_match, statementArguments, sa.output_column);
                    }
                } else {
                    // Compound filter: break it apart and each one must match something
                    if( isPlainObject(filter) ) {                        
                        const keys = Object.keys(filter) as Array<keyof typeof filter>;
                        let andClauses:string[] = [];

                        const subPropertyMap = new PropertyMapSchema(this.nodeMap[dotpropPath].schema!, sa.output_column, true);

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

    protected generateComparison(dotpropPath:string, filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], customSqlIdentifier?:string):string {
        const optionalWrapper = (sqlIdentifier:string, query:string) => {
            if( this.nodeMap[dotpropPath].optional_or_nullable ) {
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
                .filter((x):x is ValueComparisonNumericOperatorsTyped => x in filter)
                .map(x => {
                    const placeholder = this.generatePlaceholder(filter[x]!, statementArguments);
                    return ValueComparisonNumericOperatorsSqlFunctions[x](sqlIdentifier, placeholder);
                });
            return optionalWrapper(sqlIdentifier, operators.length>1? `(${operators.join(' AND ')})` : operators[0]);
        
        } else if( isValueComparisonScalar(filter) ) {
            const sqlIdentifier = customSqlIdentifier ?? this.getSqlIdentifier(dotpropPath);

            const placeholder = this.generatePlaceholder(filter, statementArguments);
            return optionalWrapper(sqlIdentifier, `${sqlIdentifier} = ${placeholder}`);
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
    constructor(schema:z.ZodSchema<T>, sqlColumnName: string, evaluateAsNonArray?:boolean) {
        const result = convertSchemaToDotPropPathTree(schema);
        super(result.map, sqlColumnName, evaluateAsNonArray);
    }
}
export class PropertyMap<T extends Record<string, any> = Record<string, any>> extends BasePropertyMap<T> implements IPropertyMap<T> {
    
    constructor(nodeMap:TreeNodeMap, sqlColumnName: string, evaluateAsNonArray?:boolean) {
        super(nodeMap, sqlColumnName, evaluateAsNonArray);
    }
}

function _postgresWhereClauseBuilder<T extends Record<string, any> = any>(filter:WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], propertySqlMap:PropertyMap):string {
    
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
                    subClauseString = subClauses.length===1? subClauses[0] : `(${subClauses.join(` ${type} `)})`;
                }
                andClauses = [...andClauses, subClauseString];
            }
        }
        
        return andClauses.length===1? andClauses[0] : `(${andClauses.join(' AND ')})`;

    } else {
        if( keys.length!==1 ) throw new Error("Bad number of keys - should have gone to logic filter.");

        return propertySqlMap.generateSql(keys[0], filter[keys[0]] as WhereFilterDefinition, statementArguments);

        if('ZodArray' ) {
            throw new Error("Unsupported. It's going to be very hard to do this right, and even then it'll probably generate expensive queries. It's probably easier to SQL read many rows with a simpler criteria, and then run matchJavascriptObject over them in memory.")
            /*
            if( propSql.sql_data_type!=='jsonb' ) throw new Error("Unsupported. It's unclear what form arrays would take in columns. It would probably be mapped out to tables, which means PropertySqlMap might need bespoke functions adding for things like 'spreadArrays'.")


            // TODO If it has arrays in the parent tree (i.e. it's a spread array), does it need special handling? Probably want to combine jsonb_array_elements with CROSS JOIN for each 

            if( Array.isArray(filterValue) ) {
                // Two arrays = straight comparison
                return `${propSql.sql_identifier} = ${JSON.stringify(filterValue)}::jsonb`;
            } else if( isArrayValueComparisonElemMatch(filterValue) ) {
                // In an elem_match, one item in the 'value' array must match all the criteria
                if( isWhereFilterDefinition(filterValue.elem_match) ) {
                    // TODO It's going to need to run a query like EXISTS(SELECT 1 FROM jsonb_array_elements(COLUMN) as elem WHERE [_postgresWhereClauseBuilder for 'elem' column in converted propertySqlMap])
                    return value.some(x => _matchJavascriptObject(x, filterValue.elem_match, [...debugPath, filterValue.elem_match]))
                } else {
                    // It's a value comparison
                    // Same as above, using EXISTS, but much easier now 
                    // TODO Split out value comparison 
                    return value.some(x => compareValue(x, filterValue.elem_match))
                }
            } else {
                // it's a compound. every filter item must be satisfied by at least one element of the array 
                if( isPlainObject(filterValue) ) {
                    // TODO Convert into an OR search where any keyed filter can match, but each one must match.
                    // split it apart across its keys, where each must be satisfied
                    const keys = Object.keys(filterValue) as Array<keyof typeof filterValue>;
        
                    const result = keys.every(key => {
        
                    
                        const subFilter:WhereFilterDefinition = {[key]: filterValue[key]};
                        return value.some(x => _matchJavascriptObject(x, subFilter, [...debugPath, subFilter]))
                    });
                    return result;
                } else {
                    // It's scalar - just see if it the array contains it 
                    const result = value.indexOf(filterValue)>-1;
                    return result;
                }
            }
            */



        }

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

    const output_column = jsonbbArrayElementsParts[jsonbbArrayElementsParts.length-1].output_column;
    return {
        sql: jsonbbArrayElementsParts.map(x => x.sql).join(` CROSS JOIN `),
        output_column,
        output_identifier: `${output_column} #>> '{}'` // This uses the JSONB text extraction operator (#>>) with an empty array ({}) as the path, which converts the JSONB element into text if it is a scalar (like a string or a number).
    }
}

export type PreparedWhereClauseStatement = {whereClauseStatement:string, statementArguments:PreparedStatementArgument[]};
export type PreparedStatementArgument = string | number | boolean | object;
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
