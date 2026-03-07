import type { SortDefinition } from '../../types.ts';
import type { SqlDialect } from '../types.ts';

/**
 * Generates an ORDER BY expression string from a SortDefinition.
 * No 'ORDER BY' keyword — just the column list with directions.
 * Appends NULLS LAST to match JS runtime null-sorting behaviour.
 *
 * @example
 * _buildOrderByClause([{ key: 'date', direction: -1 }], k => `data->>'${k}'`, 'pg')
 * // "data->>'date' DESC NULLS LAST"
 */
export function _buildOrderByClause(
    sort: SortDefinition<any>,
    pathToSqlExpression: (dotPropPath: string) => string,
    dialect: SqlDialect
): string {
    const fragments: string[] = [];

    for (const entry of sort) {
        const expr = pathToSqlExpression(entry.key);
        const dir = entry.direction === 1 ? 'ASC' : 'DESC';

        if (dialect === 'pg') {
            fragments.push(`${expr} ${dir} NULLS LAST`);
        } else {
            // SQLite: no NULLS LAST syntax. Simulate via IS NULL prefix.
            fragments.push(`${expr} IS NULL ASC, ${expr} ${dir}`);
        }
    }

    return fragments.join(', ');
}
