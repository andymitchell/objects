
import {  type PrimaryKeyGetter, type PrimaryKeyValue } from "../utils/getKeyValue.ts";
import matchJavascriptObject from "../where-filter/matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import type { ChangeSet } from "./types.ts";


/**
 * Applies a filter to a `ChangeSet`, removing any `added` or `updated` items that do not match the filter.
 *
 * This is useful when you receive a broad set of updates but only want to apply the changes relevant to a specific subset
 * (e.g. filtered by user permissions, scoped context, or client-defined rules).
 *
 * ## Behavior:
 * - Items in `added` or `updated` that **do not match** the provided `filter` are **moved to the deleted set**.
 * - The return value preserves the structure of the original `ChangeSet`:
 *   - If `removed_keys` were used, deleted items are returned as keys.
 *   - If `removed` was used, deleted items are returned as full objects.
 * - The function ensures **referential comparability** wherever possible:
 *   - If the filtered `added` or `updated` arrays are unchanged, the original arrays are returned as-is.
 *   - New arrays are only created if changes are detected in that group.
 *
 * @template T - The type of objects in the `ChangeSet`.
 *
 * @param {WhereFilterDefinition<T>} filter - The filter condition that determines which items to keep.
 * @param {ChangeSet<T>} changeSet - The original set of changes (may contain full removed items or just keys).
 * @param {(item: T) => PrimaryKeyValue} pk - A function to extract the primary key value from an object.
 *
 * @returns {ChangeSet<T>} A new `ChangeSet` where only matching items are kept in `added`/`updated`, and non-matching items are moved to `removed` or `removed_keys`.
 *
 * @example
 * const changeSet = {
 *   added: [{ id: 1, type: 'fruit' }, { id: 2, type: 'vegetable' }],
 *   updated: [{ id: 3, type: 'fruit' }],
 *   removed: [{ id: 4 }]
 * };
 *
 * const filter = { type: 'fruit' };
 *
 * const result = constrainChangeSetToFilter(filter, changeSet, item => item.id);
 * // -> Only items with type 'fruit' remain in added/updated; others moved to removed.
 */
export function constrainChangeSetToFilter<T extends Record<string, any>>(filter: WhereFilterDefinition<T>, changeSet: ChangeSet<T>, pk: PrimaryKeyGetter<T>): ChangeSet<T> {

    const newChangeSet: Omit<ChangeSet<T>, 'removed'> = {
        added: [],
        updated: []
    }

    // The items deleted by not being part of the filter
    const deletedMap = new Map<PrimaryKeyValue, T>();
    // Start with initial removed items (if changeSet has 'removed_keys' instead, this is handled later)
    if( "removed" in changeSet ) {
        changeSet.removed.forEach(x => deletedMap.set(pk(x), x));
    }

    let addChanges = false;
    let updateChanges = false;
    changeSet.added.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            newChangeSet.added.push(item);
        } else {
            addChanges = true;
            deletedMap.set(pk(item), item);
        }
    })
    changeSet.updated.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            newChangeSet.updated.push(item);
        } else {
            updateChanges = true;
            deletedMap.set(pk(item), item);
        }
    })

    if (addChanges || updateChanges) {
        // Return the same format it was given
        if ("removed_keys" in changeSet) {
            const deletedKeys = new Set<PrimaryKeyValue>([...changeSet.removed_keys, ...deletedMap.keys()]);
            return {
                added: addChanges? newChangeSet.added : changeSet.added,
                updated: updateChanges? newChangeSet.updated : changeSet.updated,
                removed_keys: [...deletedKeys]
            }
        } else {
            return {
                added: addChanges? newChangeSet.added : changeSet.added,
                updated: updateChanges? newChangeSet.updated : changeSet.updated,
                removed: [...deletedMap.values()]
            }
        }
    } else {
        // No change
        return changeSet;
    }

}
