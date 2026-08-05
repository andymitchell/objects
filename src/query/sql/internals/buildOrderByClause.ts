import type { SortDefinition } from '../../types.ts';
import type { QueryError } from '../../types.ts';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import type { SqlDialect } from '../types.ts';

type BuildOrderByClauseResult =
    | { success: true; orderBy: string }
    | { success: false; errors: QueryError[] };

/**
 * Builds the ORDER BY expression list (no `ORDER BY` keyword) from a resolved sort definition:
 * one `expr DIR NULLS LAST` fragment per key, comma-joined. Nulls are forced last to match the
 * in-memory comparator, which sorts null/undefined last in both directions (see {@link compareValues}).
 *
 * Both dialects take the same grammar — Postgres has always had `NULLS LAST`, SQLite since 3.30 —
 * which keeps each term a single sort expression the engine can read straight out of a matching
 * index. Each key's expression comes from `pathToSqlExpression`, so when that converter pins a text
 * key with `COLLATE "C"` the emitted ordering inherits the pin and matches the comparator regardless
 * of the database's default collation.
 *
 * @param sort - The resolved sort definition (primary-key tiebreaker already appended).
 * @param pathToSqlExpression - Resolves each key to its SQL expression, carrying any collation pin.
 * @param dialect - The target dialect, `'pg'` or `'sqlite'`.
 * @returns `{ success: true, orderBy }` with the comma-joined expression list, or `{ success: false, errors }`. Never throws.
 *
 * @example
 * _buildOrderByClause([{ key: 'date', direction: -1 }], k => ({ success: true, expression: `data->>'${k}'` }), 'pg')
 * // { success: true, orderBy: "data->>'date' DESC NULLS LAST" }
 *
 * @remarks
 * An engine reads ordering from an index only when the whole ORDER BY list matches the index's own
 * ordering; a trailing term it cannot match (typically the primary-key tiebreaker) leaves it sorting
 * within ties rather than sorting the whole result.
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

        fragments.push(`${expr} ${dir} NULLS LAST`);
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    return { success: true, orderBy: fragments.join(', ') };
}
