import type { SqlDialect, SqlFragment } from '../types.ts';

/**
 * Shifts all `$N` parameter indexes in a SQL string by a given offset.
 * No-op for SQLite (uses positional `?`).
 *
 * @example rebaseSqlParameters('age > $1 AND name = $2', 2, 'pg') // 'age > $3 AND name = $4'
 */
export function rebaseSqlParameters(sql: string, rebase: number, dialect: SqlDialect): string {
    if (dialect === 'sqlite' || rebase === 0) return sql;
    return sql.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + rebase}`);
}

/**
 * Appends a parameterised SQL fragment to existing parameters, rebasing placeholders.
 *
 * @example appendSqlParameters(['a'], { sql: 'x = $1', parameters: [5] }, 'pg')
 * // { sql: 'x = $2', parameters: [5], allParameters: ['a', 5] }
 */
export function appendSqlParameters(
    existingParameters: unknown[],
    appending: SqlFragment,
    dialect: SqlDialect
): { sql: string; parameters: unknown[]; allParameters: unknown[] } {
    const rebased = rebaseSqlParameters(appending.sql, existingParameters.length, dialect);
    return {
        sql: rebased,
        parameters: appending.parameters,
        allParameters: [...existingParameters, ...appending.parameters],
    };
}

/**
 * Combines multiple parameterised SQL fragments, renumbering placeholders for safe concatenation.
 *
 * @example
 * concatSqlParameters([
 *   { sql: 'age > $1', parameters: [5] },
 *   { sql: 'name = $1', parameters: ['Bob'] }
 * ], 'pg', ' AND ')
 * // { sql: 'age > $1 AND name = $2', parameters: [5, 'Bob'] }
 */
export function concatSqlParameters(
    fragments: SqlFragment[],
    dialect: SqlDialect,
    join: string = ' AND '
): SqlFragment {
    const allParameters: unknown[] = [];
    const sqlParts: string[] = [];

    for (const fragment of fragments) {
        const rebased = rebaseSqlParameters(fragment.sql, allParameters.length, dialect);
        sqlParts.push(rebased);
        allParameters.push(...fragment.parameters);
    }

    return { sql: sqlParts.join(join), parameters: allParameters as SqlFragment['parameters'] };
}
