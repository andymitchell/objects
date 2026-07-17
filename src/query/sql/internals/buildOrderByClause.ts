import type { SortDefinition } from '../../types.ts';
import type { QueryError } from '../../types.ts';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import type { SqlDialect } from '../types.ts';

type BuildOrderByClauseResult =
    | { success: true; orderBy: string }
    | { success: false; errors: QueryError[] };

/**
 * Builds the ORDER BY expression list (no `ORDER BY` keyword) from a resolved sort definition:
 * one `expr DIR` fragment per key, comma-joined, with nulls forced last to match the in-memory
 * comparator, which sorts null/undefined last in both directions (see {@link compareValues}).
 *
 * Postgres uses native `NULLS LAST`; SQLite has no such syntax and simulates it with a leading
 * `expr IS NULL ASC` term. Each key's expression comes from `pathToSqlExpression`, so when that
 * converter pins a text key with `COLLATE "C"` the emitted ordering inherits the pin and matches
 * the comparator regardless of the database's default collation.
 *
 * @param sort - The resolved sort definition (primary-key tiebreaker already appended).
 * @param pathToSqlExpression - Resolves each key to its SQL expression, carrying any collation pin.
 * @param dialect - `'pg'` (native `NULLS LAST`) or `'sqlite'` (`IS NULL` prefix).
 * @returns `{ success: true, orderBy }` with the comma-joined expression list, or `{ success: false, errors }`. Never throws.
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
            errors.push({ type: result.error.type, message: result.error.message });
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
