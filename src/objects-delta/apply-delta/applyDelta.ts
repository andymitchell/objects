import type { PrimaryKeyValue } from "../../utils/getKeyValue.ts";
import type { ObjectsDeltaApplicable } from "../types.ts";


// Helper type for the primary key getter function
type PrimaryKeyGetter<T> = (item: T) => PrimaryKeyValue;

// Optional configuration for the function as specified
type ApplyDeltaChangesOptions = {
    /**
     * An optional list of primary keys. Only items whose keys appear in this list
     * will be inserted, updated, or deleted.
     *
     * If existing items in the array don't match the whitelist, they'll be effectively removed from the final result.
     * If an empty array (`[]`) is provided, the function will immediately return an empty array.
     *
     * @default undefined (no whitelist)
     */
    whitelist_item_pks?: PrimaryKeyValue[];

    /**
     * If true, it will mutate the passed-in array. This is useful for performance-critical scenarios
     * or when integrating with libraries like Immer that use drafts.
     *
     * @default false (The function is a pure operation and returns a new array)
     */
    mutate?: boolean;
};

/**
 * Applies a delta (`ObjectsDeltaApplicable`) to an existing array of items, returning the resulting array.
 * 
 * What changes:
 * - Items in `removed_keys` removed. 
 * - Items in 'insert' are added only if they don't exist 
 * - Items in 'update' are updated only if they exist 
 * - Items in 'upsert' are added if they don't exist, or updated if they do 
 * 
 * Conflict resolution: 
 * - A key cannot be removed and inserted/updated/upserted simultaneously. Throws an error.
 * - `upsert` takes precedence over `insert` and `update`.
 * - An item in both `insert` and `update` is treated as an `upsert`.
 *
 *
 * @param items The original array of objects.
 * @param delta The `ObjectsDeltaApplicable` object containing the changes to apply.
 * @param pk A getter function that takes an item of type `T` and returns its unique primary key.
 * @param options Optional configuration for whitelisting and mutation.
 * @returns A new array with the delta changes applied, or the mutated original array if `options.mutate` is true.
 * @throws {Error} if a primary key is found in `remove_keys` and also in any modification list (`insert`, `update`, `upsert`).
 * 
 * @note Applying a delta is distinct from a `WriteAction`. While a `WriteAction` provides explicit instructions
 * on how to *modify* data (e.g., "increment this value"), a delta simply provides the final
 * state of the objects that have been insert or changed. This makes it ideal for scenarios where
 * the system receives a batch of the most current data from a source and needs to synchronize its
 * local state to match, without needing to know the specific operations that led to the new state.
 */
export function applyDelta<T extends Record<string, any>>(
    items: T[],
    delta: ObjectsDeltaApplicable<T>,
    pk: PrimaryKeyGetter<T>,
    options: ApplyDeltaChangesOptions = {}
): T[] {
    // #### Options Handling and Initial Setup ####

    const { mutate = false, whitelist_item_pks } = options;

    // If the whitelist is an empty array, the result is always an empty array.
    if (whitelist_item_pks && whitelist_item_pks.length === 0) {
        if (mutate) {
            items.length = 0;
            return items;
        }
        return [];
    }

    const whitelistSet = whitelist_item_pks ? new Set(whitelist_item_pks) : undefined;
    const workingArray = mutate ? items : [...items];

    // ####  Pre-computation and Conflict Resolution ####

    const removeKeys = new Set(delta.remove_keys ?? []);
    const insertMap = new Map((delta.insert ?? []).map(item => [pk(item), item]));
    const updateMap = new Map((delta.update ?? []).map(item => [pk(item), item]));
    const upsertMap = new Map((delta.upsert ?? []).map(item => [pk(item), item]));

    // #### Resolve Conflicts (Highest Priority) ####

    // A key cannot be removed and inserted/modified simultaneously.
    for (const key of removeKeys) {
        if (insertMap.has(key) || updateMap.has(key) || upsertMap.has(key)) {
            throw new Error("Conflicting delta: A primary key cannot be in 'remove_keys' and also in 'insert', 'update', or 'upsert'.");
        }
    }

    // `upsert` takes precedence over `insert` and `update`.
    for (const key of upsertMap.keys()) {
        insertMap.delete(key);
        updateMap.delete(key);
    }

    // An item in both `insert` and `update` is treated as an `upsert`.
    for (const [key] of insertMap) {
        if (updateMap.has(key)) {
            upsertMap.set(key, updateMap.get(key)!);
            insertMap.delete(key);
            updateMap.delete(key);
        }
    }

    // #### Applying the Delta ####

    // Build the final state in a Map for efficient key-based operations.
    const finalItemsMap = new Map<PrimaryKeyValue, T>();

    // Initialize with current items, applying the whitelist.
    for (const item of workingArray) {
        const key = pk(item);
        if (whitelistSet && !whitelistSet.has(key)) {
            continue; // This item is not in the whitelist, so it's effectively removed.
        }
        finalItemsMap.set(key, item);
    }

    // Apply removals.
    for (const key of removeKeys) {
        finalItemsMap.delete(key);
    }

    // Apply updates (only if the item already exists).
    for (const [key, item] of updateMap.entries()) {
        if (whitelistSet && !whitelistSet.has(key)) continue;
        if (finalItemsMap.has(key)) {
            finalItemsMap.set(key, item);
        }
    }

    // Apply upserts (updates or inserts).
    for (const [key, item] of upsertMap.entries()) {
        if (whitelistSet && !whitelistSet.has(key)) continue;
        finalItemsMap.set(key, item);
    }

    // Apply inserts (only if the item does not already exist).
    for (const [key, item] of insertMap.entries()) {
        if (whitelistSet && !whitelistSet.has(key)) continue;
        if (!finalItemsMap.has(key)) {
            finalItemsMap.set(key, item);
        }
    }

    // #### Finalization and Return Value ####

    if (mutate) {
        const finalValues = Array.from(finalItemsMap.values());
        // Modify the original array in-place to match the final state.
        items.length = 0;
        items.push(...finalValues);
        return items;
    } else {
        // Return a new array containing the final state.
        return Array.from(finalItemsMap.values());
    }
}