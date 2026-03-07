import type { FlattenedQuerySql, PreparedQueryClauses } from '../types.ts';
import type { SqlDialect } from './types.ts';
import { appendSqlParameters } from './internals/sqlParameterUtils.ts';

/**
 * Flattens a PreparedQueryClauses into a single SQL fragment + parameter array.
 * Appends to "SELECT * FROM table" — adds WHERE, ORDER BY, LIMIT, OFFSET keywords.
 *
 * @example
 * const { sql, parameters } = flattenQueryClausesToSql(result, 'sqlite');
 * db.query(`SELECT * FROM emails ${sql}`, parameters);
 */
export function flattenQueryClausesToSql(
    result: PreparedQueryClauses,
    dialect: SqlDialect
): FlattenedQuerySql {
    const sqlParts: string[] = [];
    let parameters: unknown[] = [];

    if (result.where_statement) {
        const appended = appendSqlParameters(
            parameters,
            { sql: result.where_statement.where_clause_statement, parameters: result.where_statement.statement_arguments },
            dialect
        );
        sqlParts.push(`WHERE ${appended.sql}`);
        parameters = appended.allParameters;
    }

    if (result.order_by_statement) {
        sqlParts.push(`ORDER BY ${result.order_by_statement}`);
    }

    if (result.limit_statement) {
        const appended = appendSqlParameters(
            parameters,
            { sql: result.limit_statement.where_clause_statement, parameters: result.limit_statement.statement_arguments },
            dialect
        );
        sqlParts.push(`LIMIT ${appended.sql}`);
        parameters = appended.allParameters;
    }

    if (result.offset_statement) {
        const appended = appendSqlParameters(
            parameters,
            { sql: result.offset_statement.where_clause_statement, parameters: result.offset_statement.statement_arguments },
            dialect
        );
        sqlParts.push(`OFFSET ${appended.sql}`);
        parameters = appended.allParameters;
    }

    return { sql: sqlParts.join(' '), parameters: parameters as FlattenedQuerySql['parameters'] };
}
