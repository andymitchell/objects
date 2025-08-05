import { isEqual } from "lodash-es";
import type { ObjectsArrayDiffer, ObjectsArrayDifferOptions, ObjectsDelta } from "./types.ts";
import { isFullPrimaryKeyValue, makePrimaryKeyGetter, type PrimaryKeyGetter, type PrimaryKeyValue } from "../utils/getKeyValue.ts";



/**
 * Creates a **stateful differ** function to track changes between successive versions of an array of objects.
 *
 * The returned function remembers the last array it was called with and computes a diff (`ObjectsDelta`)
 * each time it is called with a new array.
 * 
 * @param primaryKey The key to uniquely identify items in the array.
 * @param options Configuration for the tracker's behavior.
 *                  - `useDeepEqual` (default `true`): Whether to compare objects deeply (`_.isEqual`) or by reference.
 * @returns A function that you pass a new array to, which returns the `ObjectsDelta` from the last call's array.
 * 
 * @example
 * const track = createObjectsArrayDiffer('id');
 * const delta1 = track([{ id: 1, name: 'Alice' }]);
 * const delta2 = track([{ id: 1, name: 'Alicia' }, { id: 2, name: 'Bob' }]);
 * // delta2 => { insert: [{ id: 2, name: 'Bob' }], update: [{ id: 1, name: 'Alicia'}], remove_keys: [] }
 */
export function createObjectsArrayDiffer<T extends Record<string, any> = Record<string, any>>(
    primaryKey: keyof T | PrimaryKeyGetter<T>,
    options: ObjectsArrayDifferOptions = {}
): ObjectsArrayDiffer<T> {
    const getPrimaryKey:PrimaryKeyGetter<T> = isFullPrimaryKeyValue(primaryKey)? makePrimaryKeyGetter<T>(primaryKey) : primaryKey;
    const safeOptions = getSafeOptions(options);
    
    // State: This array will persist across calls to the returned function.
    let lastItems: T[] = [];

    return (current: T[]): ObjectsDelta<T> => {
        const {final, delta} = _diffObjectsArrays(getPrimaryKey, current, lastItems, safeOptions);
        
        // Update the state for the *next* time the function is called
        lastItems = final;

        return delta;
    };
}


/**
 * Computes the difference (`ObjectsDelta`) between two arrays of objects
 * 
 * @template T - The object type of the array items.
 *
 * @param primaryKey - The unique identifier for each object in the array.
 *                     You can pass either the property key (e.g., `'id'`) or a custom function.
 * @param current - The latest version of the array.
 * @param previous - The older version of the array. Defaults to `[]` if not provided.
 * @param options - Optional comparison options:
 *                  - `useDeepEqual` (default `true`): Whether to compare objects deeply or by reference.
 * @returns An `ObjectsDelta<T>` with:
 * - `insert`: Items in `current` not found in `previous`.
 * - `update`: Items in `current` whose keys exist in `previous` but whose values differ.
 * - `remove_keys`: Primary keys of items that existed in `previous` but not in `current`.
 * 
 * @example
 * const prev = [{ id: 1, name: 'Alice' }];
 * const next = [{ id: 1, name: 'Alicia' }, { id: 2, name: 'Bob' }];
 * const delta = diffObjectsArrays('id', next, prev);
 * // delta => {
 * //   insert: [{ id: 2, name: 'Bob' }],
 * //   update: [{ id: 1, name: 'Alicia' }],
 * //   remove_keys: []
 * // }
 */
export function diffObjectsArrays<T extends Record<string, any> = Record<string, any>>(primaryKey: keyof T | PrimaryKeyGetter<T>, current:T[], previous?:T[], options?: ObjectsArrayDifferOptions): ObjectsDelta<T> {
    const getPrimaryKey:PrimaryKeyGetter<T> = isFullPrimaryKeyValue(primaryKey)? makePrimaryKeyGetter<T>(primaryKey) : primaryKey;
    const safeOptions = getSafeOptions(options);

    return _diffObjectsArrays<T>(getPrimaryKey, current, previous ?? [], safeOptions).delta;
}




function getSafeOptions(options?:ObjectsArrayDifferOptions):Required<ObjectsArrayDifferOptions> {
    return {
        useDeepEqual: true, 
        ...options
    }
}

function _diffObjectsArrays<T extends Record<string, any> = Record<string, any>>(getPrimaryKey:PrimaryKeyGetter<T>, current:T[], previous:T[], options: Required<ObjectsArrayDifferOptions>): {final: T[], delta: ObjectsDelta<T>} {

    // When useDeepEqual is enabled, we perform a structuredClone to create a completely new, deep copy of the objects. This is necessary because deep equality checking with isEqual would fail to detect changes if the underlying objects in both lastItems and current were mutated externally to the same reference. By cloning, we ensure that the comparison is always between the new state and the unmodified previous state.
    // In the case of referential equality (useDeepEqual is false), a shallow copy using the spread syntax ([...current]) is sufficient. This creates a new array wrapper, which is important for maintaining lastItems as a distinct snapshot for the next comparison, even if the objects themselves are not cloned.    
    current = options.useDeepEqual? structuredClone(current) : [...current];

    const currentMap = new Map<PrimaryKeyValue, T>(current.map(item => [getPrimaryKey(item), item]));
    const lastItemsMap = new Map<PrimaryKeyValue, T>(previous.map(item => [getPrimaryKey(item), item]));

    const insert: T[] = [];
    const update: T[] = [];
    const remove_keys: PrimaryKeyValue[] = [];

    // Check for new or update items
    for (const [key, newItem] of currentMap.entries()) {
        if (!lastItemsMap.has(key)) {
            insert.push(newItem);
        } else {
            const oldItem = lastItemsMap.get(key);
            
            // Use the selected comparison method
            const areItemsEqual = options.useDeepEqual ? isEqual(oldItem, newItem) : oldItem === newItem;
            //console.log({areItemsEqual, useDeepEqual, oldItem, newItem});

            if (!areItemsEqual) {
                update.push(newItem);
            }
        }
    }

    // Check for removed items
    for (const [key, oldItem] of lastItemsMap.entries()) {
        if (!currentMap.has(key)) {
            remove_keys.push(getPrimaryKey(oldItem));
        }
    }

    return {
        final: current, // The cloned version
        delta: { insert, update, remove_keys, created_at: Date.now() }
    }
        
}