import { getProperty } from "../dot-prop-paths/getPropertySimpleDot.ts";
import { SortAndSliceSchema } from './schemas.ts';
import type { QueryError, SortAndSlice, SortAndSliceObjectsResult } from './types.ts';

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

    // 2. Resolve sort with PK tiebreaker
    let resolvedSort: Array<{ key: string; direction: 1 | -1 }> | undefined;
    if (data.sort && data.sort.length > 0) {
        const lastEntry = data.sort[data.sort.length - 1]!;
        if (lastEntry.key === primaryKey) {
            resolvedSort = data.sort;
        } else {
            resolvedSort = [...data.sort, { key: primaryKey, direction: 1 as const }];
        }
    }

    // 3. Copy (immutability)
    let result = [...items];

    // 4. Sort
    if (resolvedSort) {
        const sortEntries = resolvedSort;
        result.sort((a, b) => {
            for (const entry of sortEntries) {
                const aVal = getProperty(a, entry.key);
                const bVal = getProperty(b, entry.key);

                const aNull = aVal === null || aVal === undefined;
                const bNull = bVal === null || bVal === undefined;

                // Nulls always last, regardless of direction
                if (aNull && bNull) continue;
                if (aNull) return 1;
                if (bNull) return -1;

                const cmp = compareValues(aVal, bVal);
                if (cmp !== 0) return cmp * entry.direction;
            }
            return 0;
        });
    }

    // 5. Apply after_pk cursor
    if (data.after_pk !== undefined) {
        const cursorIndex = result.findIndex(item => item[primaryKey] === data.after_pk);
        if (cursorIndex === -1) {
            return { success: true, items: [] };
        }
        result = result.slice(cursorIndex + 1);
    }

    // 6. Apply offset
    if (data.offset !== undefined) {
        result = result.slice(data.offset);
    }

    // 7. Apply limit
    if (data.limit !== undefined) {
        result = result.slice(0, data.limit);
    }

    return { success: true, items: result };
}

/** Compares two values: numbers numerically, strings lexicographically, nulls/undefined last. */
function compareValues(a: unknown, b: unknown): number {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;

    if (aNull && bNull) return 0;
    if (aNull) return 1;  // nulls last
    if (bNull) return -1;

    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;

    // Mixed types: coerce to string
    const aStr = String(a);
    const bStr = String(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
}
