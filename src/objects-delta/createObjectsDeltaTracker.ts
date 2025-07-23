import { isEqual } from "lodash-es";
import type { ObjectsDeltaTracker, ObjectsDeltaTrackerOptions, ObjectsDelta } from "./types.ts";
import { isFullPrimaryKeyValue, makePrimaryKeyGetter, type PrimaryKeyGetter, type PrimaryKeyValue } from "../utils/getKeyValue.ts";



/**
 * Creates and returns a stateful function that tracks changes between array states.
 * @param primaryKey The key to uniquely identify items in the array.
 * @param options Configuration for the tracker's behavior.
 * @returns A function that you pass a new array to, which returns the `ObjectsDelta` from the last call.
 */
export function createObjectsDeltaTracker<T extends Record<string, any> = Record<string, any>>(
    primaryKey: keyof T | PrimaryKeyGetter<T>,
    options: ObjectsDeltaTrackerOptions = {}
): ObjectsDeltaTracker<T> {
    const getPrimaryKey:PrimaryKeyGetter<T> = isFullPrimaryKeyValue(primaryKey)? makePrimaryKeyGetter<T>(primaryKey) : primaryKey;
    const { useDeepEqual = true } = options;

    // State: This array is "closed over" by the function returned below.
    // It will persist across calls to that returned function.
    let lastItems: T[] = [];

    return (newItems: T[]): ObjectsDelta<T> => {
        // When useDeepEqual is enabled, we perform a structuredClone to create a completely new, deep copy of the objects. This is necessary because deep equality checking with isEqual would fail to detect changes if the underlying objects in both lastItems and newItems were mutated externally to the same reference. By cloning, we ensure that the comparison is always between the new state and the unmodified previous state.
        // In the case of referential equality (useDeepEqual is false), a shallow copy using the spread syntax ([...newItems]) is sufficient. This creates a new array wrapper, which is important for maintaining lastItems as a distinct snapshot for the next comparison, even if the objects themselves are not cloned.    
        newItems = useDeepEqual? structuredClone(newItems) : [...newItems];

        const newItemsMap = new Map<PrimaryKeyValue, T>(newItems.map(item => [getPrimaryKey(item), item]));
        const lastItemsMap = new Map<PrimaryKeyValue, T>(lastItems.map(item => [getPrimaryKey(item), item]));

        const added: T[] = [];
        const updated: T[] = [];
        const removed: T[] = [];

        // Check for new or updated items
        for (const [key, newItem] of newItemsMap.entries()) {
            if (!lastItemsMap.has(key)) {
                added.push(newItem);
            } else {
                const oldItem = lastItemsMap.get(key);
                
                // Use the selected comparison method
                const areItemsEqual = useDeepEqual ? isEqual(oldItem, newItem) : oldItem === newItem;
                //console.log({areItemsEqual, useDeepEqual, oldItem, newItem});

                if (!areItemsEqual) {
                    updated.push(newItem);
                }
            }
        }

        // Check for removed items
        for (const [key, oldItem] of lastItemsMap.entries()) {
            if (!newItemsMap.has(key)) {
                removed.push(oldItem);
            }
        }

        // Update the state for the *next* time the function is called
        lastItems = newItems;

        return { added, updated, removed };
    };
}