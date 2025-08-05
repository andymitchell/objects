

import {  type PrimaryKeyGetter, type PrimaryKeyValue } from "../utils/getKeyValue.ts";
import matchJavascriptObject from "../where-filter/matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import type { ObjectsDelta, ObjectsDeltaApplicable } from "./types.ts";



/**
 * Applies a filter to a `ObjectsDelta` or `ObjectsDeltaApplicable`, removing any `insert`/`update`/`upsert` items that do not match the filter.
 *
 * This is useful when you receive a broad set of updates but only want to apply the changes relevant to a specific subset
 * (e.g. filtered by user permissions, scoped context, or client-defined rules).
 *
 * ## Behavior:
 * - Items in `insert`, `update` or `upsert` that **do not match** the provided `filter` are **moved to the deleted set**.
 * - The return value preserves the structure of the original `ObjectsDelta` or `ObjectsDeltaApplicable`:
 *   - The `created_at` value does not change, because it may reflect the state of the objects (T) at a given time, but that has not changed. It just constrained the set. 
 * - The function ensures **referential comparability** wherever possible:
 *   - If the filtered `insert`, `update` or `upsert` arrays are unchanged, the original arrays are returned as-is.
 *   - New arrays are only created if changes are detected in that group.
 *
 * @template T - The type of objects in the `ObjectsDelta` or `ObjectsDeltaApplicable`.
 *
 * @param {WhereFilterDefinition<T>} filter - The filter condition that determines which items to keep.
 * @param {ObjectsDelta<T> | ObjectsDeltaApplicable<T>} delta - The original set of changes (may contain full removed items or just keys).
 * @param {(item: T) => PrimaryKeyValue} pk - A function to extract the primary key value from an object.
 *
 * @returns {ObjectsDelta<T> | ObjectsDeltaApplicable<T>} A new `ObjectsDelta<T>` or `ObjectsDeltaApplicable<T>` where only matching items are kept in `insert`/`update`/`upsert`, and non-matching items are moved to `remove_keys`.
 *
 * @example
 * const delta = {
 *   insert: [{ id: 1, type: 'fruit' }, { id: 2, type: 'vegetable' }],
 *   update: [{ id: 3, type: 'fruit' }],
 *   remove_keys: [4]
 * };
 *
 * const filter = { type: 'fruit' };
 *
 * const result = constrainDeltaToFilter(filter, delta, item => item.id);
 * // -> Only items with type 'fruit' remain in insert/update; others moved to removed.
 * // {insert: [{ id: 1, type: 'fruit' }],  update: [{ id: 3, type: 'fruit' }], remove_keys: [4, 2]}
 */
export function constrainDeltaToFilter<T extends Record<string, any>, D extends ObjectsDelta<T> | ObjectsDeltaApplicable<T>>(filter: WhereFilterDefinition<T>, delta:D, pk: PrimaryKeyGetter<T>): D {

    const updatedObjectArrays = {
        insert: [] as T[],
        update: [] as T[],
        upsert: [] as T[]
    }

    // The items deleted by not being part of the filter
    const deletedMap = new Map<PrimaryKeyValue, T>();


    let addChanges = false;
    let updateChanges = false;
    let upsertChanges = false;
    delta.insert?.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            updatedObjectArrays.insert.push(item);
        } else {
            addChanges = true;
            deletedMap.set(pk(item), item);
        }
    })
    delta.update?.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            updatedObjectArrays.update.push(item);
        } else {
            updateChanges = true;
            deletedMap.set(pk(item), item);
        }
    });
    (delta as ObjectsDeltaApplicable<T>).upsert?.forEach(item => {
        if (matchJavascriptObject(item, filter)) {
            updatedObjectArrays.upsert.push(item);
        } else {
            upsertChanges = true;
            deletedMap.set(pk(item), item);
        }
    })

    if (addChanges || updateChanges || upsertChanges) {
        
        const deletedKeys = new Set<PrimaryKeyValue>([...(delta.remove_keys ?? []), ...deletedMap.keys()]);

        // Type as ObjectsDeltaApplicable as it is conveniently a partial, which helps us construct it piece by piece 
        const replacedDelta:ObjectsDeltaApplicable<T> = {
            created_at: delta.created_at, // Preserve, as we're not changing any of the objects, we're just potentially narrowing them. 
        }

        // Only bring over the properties it previously had (same format)
        // If no changes for a property, retain the old array (for referential comparison)
        if( delta.insert ) replacedDelta.insert = addChanges? updatedObjectArrays.insert : delta.insert;
        if( delta.update ) replacedDelta.update = updateChanges? updatedObjectArrays.update : delta.update;
        if( delta.remove_keys || deletedKeys.size>0 ) replacedDelta.remove_keys = [...deletedKeys];
        if( (delta as ObjectsDeltaApplicable<T>).upsert ) replacedDelta.upsert = upsertChanges? updatedObjectArrays.upsert : (delta as ObjectsDeltaApplicable<T>).upsert;

        return replacedDelta as D;
    } else {
        // No change
        return delta;
    }

}
