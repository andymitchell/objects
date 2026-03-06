
import type { WhereFilterDefinition } from "../types.ts";
import type { ValueComparisonRangeOperators } from "../consts.ts";

/**
 * Dialect-specific abstraction for converting a single dot-prop path + filter value into SQL.
 * Implementations know how to map WhereFilterDefinition leaf values to dialect-specific SQL fragments.
 *
 * ```
 * compileWhereFilter(filter, translator)
 *   └─ recursive walk ─► translator.generateSql(path, leaf, args, errors, root)
 *                              └─ dialect-specific SQL fragment
 * ```
 *
 * @example
 * class MyTranslator implements IPropertyTranslator<MyType> {
 *   generateSql(path, filter, args, errors, root) { return `col->>'${path}' = $1`; }
 * }
 */
export interface IPropertyTranslator<T extends Record<string, any>> {
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string;
}

/** Error detail for a sub-filter that could not be compiled to SQL. */
export type WhereClauseError = {
    sub_filter: WhereFilterDefinition;
    root_filter: WhereFilterDefinition;
    message: string;
};

/**
 * Discriminated union result from SQL where-clause builders.
 * Consumers must check `.success` before accessing statement fields.
 */
export type PreparedWhereClauseResult =
    | { success: true; where_clause_statement: string; statement_arguments: PreparedStatementArgument[] }
    | { success: false; errors: WhereClauseError[] };

/** @deprecated Use `PreparedWhereClauseResult` instead. */
export type PreparedWhereClauseStatement = { whereClauseStatement: string, statementArguments: PreparedStatementArgument[] };
export type PreparedStatementArgument = string | number | boolean | null;
export type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;

/** Typeguard: value is a primitive that can be used as a parameterised query argument. */
export function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}

/** Maps range operators to dialect-agnostic SQL comparison functions (>, <, >=, <=). */
export type ValueComparisonRangeOperatorSqlFunctions = {
    [K in typeof ValueComparisonRangeOperators[number]]: (sqlKey: string, parameterizedQueryPlaceholder: string) => string;
};
