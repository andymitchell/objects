import type { FlattenedQuerySql, PreparedQueryClauses } from '../types.ts';
import type { SqlDialect } from './types.ts';
import { appendSqlParameters } from './internals/sqlParameterUtils.ts';

/**
 * Assembles decomposed `PreparedQueryClauses` (from `prepareObjectTableQuery` or
 * `prepareColumnTableQuery`) into a single SQL string with a unified parameter array.
 * Adds the SQL keywords (`WHERE`, `ORDER BY`, `LIMIT`, `OFFSET`) and rebases parameter
 * numbering so all clauses share a single parameter list without collisions.
 *
 * The resulting SQL is designed to be appended to a `SELECT * FROM <table>` statement.
 * Clauses that are `null` are omitted from the output.
 *
 * @param result - Decomposed query clauses from a SQL query builder.
 * @param dialect - SQL dialect: `'pg'` for Postgres (`$N` params) or `'sqlite'` (`?` params).
 *   Must match the dialect used when building the clauses.
 * @returns `{ sql, parameters }` — a single SQL fragment and its parameter array.
 *
 * @example
 * const result = prepareObjectTableQuery('pg', table, { sender: 'Andy' }, {
 *   sort: [{ key: 'date', direction: -1 }], limit: 20,
 * });
 * if (result.success) {
 *   const { sql, parameters } = flattenQueryClausesToSql(result, 'pg');
 *   db.query(`SELECT * FROM emails ${sql}`, parameters);
 *   // sql: "WHERE ... ORDER BY ... LIMIT $2"
 *   // parameters: ['Andy', 20]
 * }
 *
 * @example
 * // SQLite equivalent
 * const { sql, parameters } = flattenQueryClausesToSql(result, 'sqlite');
 * db.prepare(`SELECT * FROM emails ${sql}`).all(...parameters);
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
