
import type { WhereFilterDefinition } from "../types.ts";
import type { ValueComparisonRangeOperators } from "../consts.ts";
import type { DotPropPathConversionError } from "../../utils/sql/types.ts";

// Re-export base SQL types from canonical location
export type { PreparedStatementArgument, PreparedStatementArgumentOrObject } from '../../utils/sql/types.ts';
export { isPreparedStatementArgument } from '../../utils/sql/types.ts';

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

/** Error from a sub-filter that could not be compiled to SQL (has filter context). */
export type WhereClauseFilterError = {
    kind: 'filter';
    sub_filter: WhereFilterDefinition;
    root_filter: WhereFilterDefinition;
    message: string;
};

/** Error from a dot-prop path conversion failure (no filter context available). */
export type WhereClausePathError = {
    kind: 'path_conversion';
    error: DotPropPathConversionError;
    message: string;
};

/** Discriminated union of where-clause compilation errors. All variants carry `.message` for uniform access. */
export type WhereClauseError = WhereClauseFilterError | WhereClausePathError;

/**
 * Discriminated union result from SQL where-clause builders.
 * Consumers must check `.success` before accessing statement fields.
 */
export type PreparedWhereClauseResult =
    | { success: true; } & PreparedWhereClauseStatement
    | { success: false; errors: WhereClauseError[] };


export type PreparedWhereClauseStatement = { where_clause_statement: string, statement_arguments: PreparedStatementArgument[] };

/** Maps range operators to dialect-agnostic SQL comparison functions (>, <, >=, <=). */
export type ValueComparisonRangeOperatorSqlFunctions = {
    [K in typeof ValueComparisonRangeOperators[number]]: (sqlKey: string, parameterizedQueryPlaceholder: string) => string;
};
