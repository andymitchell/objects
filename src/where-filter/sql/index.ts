
// Shared engine
export { compileWhereFilter, compileWhereFilterRecursive } from './compileWhereFilter.ts';

// Unified entry point
export { prepareWhereClause } from './prepareWhereClause.ts';

// Shared types
export type { IPropertyTranslator, PreparedWhereClauseResult, PreparedWhereClauseStatement, PreparedStatementArgument, PreparedStatementArgumentOrObject, SqlDialect, WhereClauseError, WhereClauseDialectMismatchError, WhereClauseFilterError, WhereClausePathError, ValueComparisonRangeOperatorSqlFunctions } from './types.ts';
export { isPreparedStatementArgument } from './types.ts';
export { ValueComparisonRangeOperatorsSqlFunctions } from './sharedSqlOperators.ts';

// Postgres
export { prepareWhereClauseForPg, PropertyTranslatorPgJsonbSchema, PropertyTranslatorPgJsonb, spreadJsonbArrays, convertDotPropPathToPostgresJsonPath, UNSAFE_WARNING } from './postgres/index.ts';

// SQLite
export { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema, PropertyTranslatorSqliteJson, spreadJsonArraysSqlite, convertDotPropPathToSqliteJsonPath, SQLITE_UNSAFE_WARNING } from './sqlite/index.ts';
