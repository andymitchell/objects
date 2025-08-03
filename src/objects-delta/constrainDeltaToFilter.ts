
import {  type PrimaryKeyGetter, type PrimaryKeyValue } from "../utils/getKeyValue.ts";
import matchJavascriptObject from "../where-filter/matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";

import { isObjectsDeltaUsingRemovedKeysFast } from "./schemas.ts";
import type { ObjectsDeltaFlexible } from "./types.ts";


/**
 * Applies a filter to a `ObjectsDeltaFlexible`, removing any `added` or `updated` items that do not match the filter.
 *
 * This is useful when you receive a broad set of updates but only want to apply the changes relevant to a specific subset
 * (e.g. filtered by user permissions, scoped context, or client-defined rules).
 *
 * ## Behavior:
 * - Items in `added` or `updated` that **do not match** the provided `filter` are **moved to the deleted set**.
 * - The return value preserves the structure of the original `ObjectsDeltaFlexible`:
 *   - If `removed_keys` were used, deleted items are returned as keys.
 *   - If `removed` was used, deleted items are returned as full objects.
 * - The function ensures **referential comparability** wherever possible:
 *   - If the filtered `added` or `updated` arrays are unchanged, the original arrays are returned as-is.
 *   - New arrays are only created if changes are detected in that group.
 *
 * @template T - The type of objects in the `ObjectsDeltaFlexible`.
 *
 * @param {WhereFilterDefinition<T>} filter - The filter condition that determines which items to keep.
 * @param {ObjectsDeltaFlexible<T>} delta - The original set of changes (may contain full removed items or just keys).
 * @param {(item: T) => PrimaryKeyValue} pk - A function to extract the primary key value from an object.
 *
 * @returns {ObjectsDeltaFlexible<T>} A new `ObjectsDeltaFlexible` where only matching items are kept in `added`/`updated`, and non-matching items are moved to `removed` or `removed_keys`.
 *
 * @example
 * const delta = {
 *   added: [{ id: 1, type: 'fruit' }, { id: 2, type: 'vegetable' }],
 *   updated: [{ id: 3, type: 'fruit' }],
 *   removed: [{ id: 4 }]
 * };
 *
 * const filter = { type: 'fruit' };
 *
 * const result = constrainDeltaToFilter(filter, delta, item => item.id);
 * // -> Only items with type 'fruit' remain in added/updated; others moved to removed.
 */
export function constrainDeltaToFilter<T extends Record<string, any>>(filter: WhereFilterDefinition<T>, delta: ObjectsDeltaFlexible<T>, pk: PrimaryKeyGetter<T>): ObjectsDeltaFlexible<T> {

    const newObjectsDeltaFlexible: Omit<ObjectsDeltaFlexible<T>, 'removed'> = {
        added: [],
        updated: []
    }

    // The items deleted by not being part of the filter
    const deletedMap = new Map<PrimaryKeyValue, T>();
    // Start with initial removed items (if delta has 'removed_keys' instead, this is handled later)
    if( !isObjectsDeltaUsingRemovedKeysFast(delta) ) {
        delta.removed.forEach(x => deletedMap.set(pk(x), x));
    }

    let addChanges = false;
    let updateChanges = false;
    delta.added.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            newObjectsDeltaFlexible.added.push(item);
        } else {
            addChanges = true;
            deletedMap.set(pk(item), item);
        }
    })
    delta.updated.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            newObjectsDeltaFlexible.updated.push(item);
        } else {
            updateChanges = true;
            deletedMap.set(pk(item), item);
        }
    })

    if (addChanges || updateChanges) {
        // Return the same format it was given
        if (isObjectsDeltaUsingRemovedKeysFast(delta)) {
            const deletedKeys = new Set<PrimaryKeyValue>([...delta.removed_keys, ...deletedMap.keys()]);
            return {
                ...delta, // in case it has modified_at on it 
                added: addChanges? newObjectsDeltaFlexible.added : delta.added,
                updated: updateChanges? newObjectsDeltaFlexible.updated : delta.updated,
                removed_keys: [...deletedKeys]
            }
        } else {
            return {
                ...delta, // in case it has modified_at on it 
                added: addChanges? newObjectsDeltaFlexible.added : delta.added,
                updated: updateChanges? newObjectsDeltaFlexible.updated : delta.updated,
                removed: [...deletedMap.values()]
            }
        }
    } else {
        // No change
        return delta;
    }

}
