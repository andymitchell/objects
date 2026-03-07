import type { SortDefinition } from '../../types.ts';
import type { QueryError } from '../../types.ts';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import type { SqlDialect } from '../types.ts';

type BuildOrderByClauseResult =
    | { success: true; orderBy: string }
    | { success: false; errors: QueryError[] };

/**
 * Generates an ORDER BY expression string from a SortDefinition.
 * No 'ORDER BY' keyword — just the column list with directions.
 * Appends NULLS LAST to match JS runtime null-sorting behaviour.
 *
 * @example
 * _buildOrderByClause([{ key: 'date', direction: -1 }], k => ({ success: true, expression: `data->>'${k}'` }), 'pg')
 * // { success: true, orderBy: "data->>'date' DESC NULLS LAST" }
 */
export function _buildOrderByClause(
    sort: SortDefinition<any>,
    pathToSqlExpression: (dotPropPath: string) => DotPropPathConversionResult,
    dialect: SqlDialect
): BuildOrderByClauseResult {
    const fragments: string[] = [];
    const errors: QueryError[] = [];

    for (const entry of sort) {
        const result = pathToSqlExpression(entry.key);
        if (!result.success) {
            errors.push({ type: 'path_conversion', message: result.error });
            continue;
        }
        const expr = result.expression;
        const dir = entry.direction === 1 ? 'ASC' : 'DESC';

        if (dialect === 'pg') {
            fragments.push(`${expr} ${dir} NULLS LAST`);
        } else {
            // SQLite: no NULLS LAST syntax. Simulate via IS NULL prefix.
            fragments.push(`${expr} IS NULL ASC, ${expr} ${dir}`);
        }
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    return { success: true, orderBy: fragments.join(', ') };
}
