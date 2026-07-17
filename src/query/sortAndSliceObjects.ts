import { SortAndSliceSchema } from './schemas.ts';
import { buildSortComparator } from './sortCompare.ts';
import type { QueryError, SortAndSlice, SortAndSliceObjectsResult, SortDefinition } from './types.ts';

/**
 * Sorts and paginates an in-memory array of objects using the same `SortAndSlice`
 * configuration used by the SQL query builders (`prepareObjectTableQuery`, `prepareColumnTableQuery`).
 * This ensures identical ordering semantics whether querying in-memory or against a database.
 *
 * Supports multi-key sorting (Mongo-style: `1` = ASC, `-1` = DESC), cursor-based pagination
 * (`after_pk`), offset-based pagination, and limits. A primary key tiebreaker is automatically
 * appended to ensure deterministic ordering when sort keys have duplicate values.
 *
 * @param items - The array to sort and paginate. Never mutated; a copy is returned.
 * @param sortAndSlice - Sorting and pagination config. `offset` and `after_pk` are mutually exclusive.
 * @param primaryKey - The property name that uniquely identifies each item (used for cursor lookup and tiebreaking).
 * @returns `{ success: true, items: T[] }` on success, `{ success: false, errors: QueryError[] }` on validation failure.
 *
 * @example
 * // Page 1: newest 20 emails
 * const page1 = sortAndSliceObjects(emails, { sort: [{ key: 'date', direction: -1 }], limit: 20 }, 'id');
 *
 * @example
 * // Page 2: cursor pagination using the last item's PK
 * const page2 = sortAndSliceObjects(emails, { sort: [{ key: 'date', direction: -1 }], limit: 20, after_pk: lastId }, 'id');
 *
 * @example
 * // Offset pagination
 * const page3 = sortAndSliceObjects(emails, { sort: [{ key: 'date', direction: -1 }], limit: 20, offset: 40 }, 'id');
 *
 * @note Null/undefined values always sort last, regardless of sort direction — matching SQL `NULLS LAST`.
 * @note Cross-type sort values order by bracket: finite numbers before all String-formed values (see `compareValues`).
 * @note A stale `after_pk` (pointing to a deleted/missing item) returns an empty array, not an error.
 * @note Input is validated at runtime via Zod. Invalid config (e.g. `offset` + `after_pk` together) returns errors as values, never throws.
 */
export function sortAndSliceObjects<T extends Record<string, any>>(
    items: T[],
    sortAndSlice: SortAndSlice<T>,
    primaryKey: keyof T & string
): SortAndSliceObjectsResult<T> {
    // 1. Validate
    const parsed = SortAndSliceSchema.safeParse(sortAndSlice);
    if (!parsed.success) {
        const errors: QueryError[] = parsed.error.issues.map(issue => ({
            type: 'validation',
            message: issue.message,
        }));
        return { success: false, errors };
    }

    const data = parsed.data;

    // 2. Copy (immutability)
    let result = [...items];

    // 3. Sort — the comparator implements the full ordering contract (nulls last,
    // type brackets, pk tiebreaker). Zod validation widens the keys to `string`;
    // the input was typed as dot-prop paths of T.
    if (data.sort && data.sort.length > 0) {
        result.sort(buildSortComparator(data.sort as SortDefinition<T>, primaryKey));
    }

    // 4. Apply after_pk cursor
    if (data.after_pk !== undefined) {
        const cursorIndex = result.findIndex(item => item[primaryKey] === data.after_pk);
        if (cursorIndex === -1) {
            return { success: true, items: [] };
        }
        result = result.slice(cursorIndex + 1);
    }

    // 5. Apply offset
    if (data.offset !== undefined) {
        result = result.slice(data.offset);
    }

    // 6. Apply limit
    if (data.limit !== undefined) {
        result = result.slice(0, data.limit);
    }

    return { success: true, items: result };
}
