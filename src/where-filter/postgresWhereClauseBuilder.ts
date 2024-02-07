
import { z } from "zod";
import { getValidFilterType, isLogicFilter, isValueComparisonArrayContains, isValueComparisonContains, isValueComparisonNumeric, isValueComparisonScalar, isWhereFilterArray, ValueComparison, ValueComparisonNumericOperators, ValueComparisonNumericOperatorsTyped, WhereFilter, WhereFilterLogicOperators, WhereFilterLogicOperatorsTyped } from "./types";
import { convertSchemaToDotPropPathKind } from "../dot-prop-paths/zod";

export type PreparedWhereClauseStatement = {whereClauseStatement:string, statementArguments:PreparedStatementArgument[]};
export type PreparedStatementArgument = string | number | boolean;
function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}

export type PropertySqlMap = (dropPropPath:string) => string | undefined;

// Function to generate a PropertySqlMap, given Zod Schema, and a column name 

export function postgresCreatePropertySqlMapFromSchema(schema:z.ZodTypeAny, sqlColumnName: string):PropertySqlMap {
    
    const pathsToKindMap = convertSchemaToDotPropPathKind(schema, ['ZodString', 'ZodNumber', 'ZodBoolean', 'ZodBigInt', 'ZodNull']);

    /*
    Some examples 
    SELECT * FROM people WHERE col->>'id' = '1';
    SELECT * FROM people WHERE (col->>'id')::int > 1;
    SELECT * FROM people WHERE col->>'location' = 'London';
    SELECT * FROM people WHERE col->>'location' LIKE 'Lon%';
    SELECT * FROM people WHERE (col->'person'->>'age')::int <> 1;
    */

    const pathsToSqlKey:Record<keyof typeof pathsToKindMap, string> = {}    
    Object.keys(pathsToKindMap).forEach(dotPropPath => {
        // dotPropPath is 'person.age', etc. 
        const zodKind = pathsToKindMap[dotPropPath];

        const jsonbParts = dotPropPath.split(".").join(`,`);
        const castingMap = {
            'ZodString': '::text', 
            'ZodNumber': '::numeric', 
            'ZodBoolean': '::boolean', 
            'ZodBigInt': '::bigint',
            'ZodNull': ''
        }

        // This should yield a query like... (task#>>'{person,age}')::numeric (for a schema like z.object({person: z.object({age: z.number()})}))
        pathsToSqlKey[dotPropPath] = `(${sqlColumnName}#>>'{${jsonbParts}}')${castingMap[zodKind] ?? ''}`;
    });

    return (dotPropPath:string) => pathsToSqlKey[dotPropPath];
}

export default function postgresWhereClauseBuilder<T = any>(filter:WhereFilter<T>, propertySqlMap:PropertySqlMap):PreparedWhereClauseStatement {
    const statementArguments:PreparedStatementArgument[] = [];

    const whereClauseStatement = _postgresWhereClauseBuilder(filter, statementArguments, propertySqlMap);
    return {whereClauseStatement, statementArguments};
}

function _postgresWhereClauseBuilder<T = any>(filter:WhereFilter<T>, statementArguments: PreparedStatementArgument[], propertySqlMap:PropertySqlMap):string {
    

    if( isLogicFilter(filter) ) {
        const andClauses:string[] = [];

        function addSubClauseString(type: WhereFilterLogicOperatorsTyped, subFilters: WhereFilter<T>[]):void {
            let subClauseString = '';
            const subClauses = [...subFilters].map(subFilter => _postgresWhereClauseBuilder(subFilter, statementArguments, propertySqlMap));
            if( type==='NOT' ) {
                subClauseString =`NOT (${subClauses.join(' OR ')})`;
            } else {
                subClauseString = subClauses.length===1? subClauses[0] : `(${subClauses.join(` ${type} `)})`;
            }
            if( !subClauseString ) throw new Error("Sub Clause String should always be set");
            andClauses.push(subClauseString);
        }

        for( const type of WhereFilterLogicOperators ) {
            const value = filter[type];
            if( isWhereFilterArray(value) ) addSubClauseString(type, value);
        }
        
        return andClauses.length===1? andClauses[0] : `(${andClauses.join(' AND ')})`;

    } else {
        
        const filterDotpropKey = Object.keys(filter)[0];
        const filterValue = (filter as any)[filterDotpropKey];
        const sqlKey = propertySqlMap(filterDotpropKey);
        if( sqlKey===undefined ) throw new Error("Unknown filterDotpropKey. There a chance it's malicious. Please approve each one.");
        if( isValueComparisonContains(filterValue) ) {
            const placeholder = generatePlaceholder(`%${filterValue.contains}%`, statementArguments);
            return `${sqlKey} LIKE ${placeholder}`;
        } else if( isValueComparisonArrayContains(filterValue) ) {
            // TODO Need a way to confirm that sqlKey is a JSON object, as that's the only time this is valid. 
            // Use the @> operator
            throw new Error(`Issue a JSONB lookup`);
        } else if( isValueComparisonNumeric(filterValue) ) {            
            const operators = ValueComparisonNumericOperators
                .filter((x):x is ValueComparisonNumericOperatorsTyped => x in filterValue)
                .map(x => {
                    const placeholder = generatePlaceholder(filterValue[x]!, statementArguments);
                    return ValueComparisonNumericOperatorsSqlFunctions[x](sqlKey, placeholder);
                });
            return operators.length>1? `(${operators.join(' AND ')})` : operators[0];
        
        } else if( isValueComparisonScalar(filterValue) ) {
            const placeholder = generatePlaceholder(filterValue, statementArguments);
            return `${sqlKey} = ${placeholder}`;
        } else {
            throw new Error("Unknown value comparison type.")
        }

    }
}

function generatePlaceholder(value:PreparedStatementArgument, statementArguments:PreparedStatementArgument[]):string {
    if( !isPreparedStatementArgument(value) ) {
        throw new Error("Placeholders for SQL can only be string/number/boolean");
    }
    statementArguments.push(value);
    return `$${statementArguments.length}`;
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
