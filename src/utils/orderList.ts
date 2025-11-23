import type { ListOrdering } from "@andyrmitchell/objects";


type OrderListOptions = {

    /**
     * Handling of null/undefined values.
     * 
     * - 'standard' (Default): Treats null/undefined as the lowest possible value. 
     *    In 'asc', they appear at the START. 
     *    In 'desc', they appear at the END.
     * 
     * - 'always-last': Null/undefined values are always pushed to the bottom of the list, 
     *    regardless of sort direction. (Matches Lodash/UI friendly behavior).
     */
    nulls?: 'standard' | 'always-last';
}

/**
 * Sorts a list of objects by a single key, returning a new, ordered array.
 *
 * - Uses the `order.key` field as the property to sort by.
 * - Sorts ascending by default; pass `direction: 'desc'` to reverse.
 * - Does **not** mutate the input `items` array (it works on a shallow copy).
 * - Is stable: items with equal sort values keep their original relative order.
 *
 * `null` / `undefined` handling (controlled by `options.nulls`):
 *
 * - `'standard'` (default):
 *    - Treats `null`/`undefined` as the lowest possible value.
 *    - Ascending (`'asc'`): nulls appear at the **start**.
 *    - Descending (`'desc'`): nulls appear at the **end**.
 *
 * - `'always-last'`:
 *    - `null`/`undefined` are always placed at the **end**,
 *      regardless of sort direction.
 *
 * @typeParam T - Object type of each item in `items`.
 * @param items - The list of items to sort.
 * @param order - Sort configuration: which key to use and direction (`'asc' | 'desc'`).
 * @param options - Optional behavior flags (e.g. how to treat `null`/`undefined`).
 * @returns A new array containing the sorted items. Returns `[]` if `items` is empty or invalid.
 * 
 * @note Designed to be similar to Lodash's orderBy 
 */
export function orderList<T extends Record<string, any>>(items: T[], order:ListOrdering<T>, options?: OrderListOptions):T[] {
    // Guard clause for empty or invalid inputs
    if (!items || !Array.isArray(items) || items.length === 0) {
        return [];
    }

    const { key, direction = 'asc' } = order;
    const isAsc = direction === 'asc';
    const multiplier = isAsc ? 1 : -1;

    // create a shallow copy to avoid mutating the original array
    return [...items].sort((a, b) => {
        const valA = a[key as keyof T];
        const valB = b[key as keyof T];

        // Handle strict equality immediately (preserves stability)
        if (valA === valB) return 0;

        const aIsNull = valA === null || valA === undefined;
        const bIsNull = valB === null || valB === undefined;

        // Handle Null/Undefined permutations
        if (aIsNull || bIsNull) {
            if (aIsNull && bIsNull) return 0;

            if (options?.nulls === 'always-last') {
                // Regardless of direction, null goes to the bottom (returns 1 if A is null)
                return aIsNull ? 1 : -1;
            } else {
                // 'standard' mode: Null is treated as mathematically "lowest" value (-Infinity).
                // If ASC (multiplier 1): Null < Value -> returns -1 (Null comes first)
                // If DESC (multiplier -1): Null < Value -> returns 1 (Null comes last)
                if (aIsNull) return -1 * multiplier;
                if (bIsNull) return 1 * multiplier;
            }
        }

        // Compare PrimaryKeyValues (string | number)
        if (valA < valB) return -1 * multiplier;
        if (valA > valB) return 1 * multiplier;

        return 0;
    });
}