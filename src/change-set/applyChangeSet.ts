import type { PrimaryKeyGetter, PrimaryKeyValue } from "../utils/getKeyValue.ts";
import type { ChangeSet } from "./types.ts";



type ApplyChangeSetOptions = {
    /**
     * An optional list of primary keys. Only items whose keys appear in this list
     * will be added, updated, or deleted.
     *
     * This can be useful when applying changes scoped to a particular subset of data (e.g., filtered views).
     * 
     * If existing items in the array don't match the whitelist, they'll be deleted.
     * 
     * @default []
     *
     * @example
     * { whitelist_item_pks: [2, 3] }
     */
    whitelist_item_pks?:PrimaryKeyValue[]

}
/**
 * Applies a `ChangeSet` to an existing array of items, returning a new array with:
 * - Items in `deleted_keys` removed,
 * - Items in `added_or_updated` added or replacing existing ones with matching primary keys.
 * 
 * This function is a pure operation and does not mutate the original `items` array, or any of its items.
 * 
 * 
 * It performs three main operations in a single pass:
 * 1.  **Updates:** If an item in `changeSet.updates` has a primary key that already exists in the `items` array, it replaces the old item.
 * 2.  **Additions:** If an item in `changeSet.added` has a primary key that is not in the `items` array, it is added to the array. If it is in the `items` array, it replaces the old item.
 * 3.  **Deletions:** It removes any items from the `items` array whose primary keys are listed in `changeSet.deleted_keys`.
 * 
 * 
 * @param items The original array of objects that will be changed (and replaced - not mutated).
 * @param changeSet The `ChangeSet` object containing the items to add, update and delete. If it's adding an item that's already in the array, it'll be updated.
 * @param pk A function that takes an item of type `T` and returns its unique primary key, for comparison. 
 * @param options Optional controls, such as a whitelist of primary keys to allow.
 * @returns A **new array** of objects with the change set applied.
 * 
 * 
 * @example
 * const items = [
 *   { id: 1, name: 'Apple' },
 *   { id: 2, name: 'Banana' },
 *   { id: 3, name: 'Cherry' }
 * ];
 * 
 * const changeSet = {
 *   added: [{ id: 4, name: 'Date' }],
 *   updated: [{ id: 2, name: 'Blueberry' }],
 *   deleted_keys: [1]
 * };
 * 
 * const result = applyChangeSet(items, changeSet, item => item.id);
 * // result:
 * // [
 * //   { id: 2, name: 'Blueberry' },
 * //   { id: 3, name: 'Cherry' },
 * //   { id: 4, name: 'Date' }
 * // ]
 * 
 * @example
 * // When an item in `added` has a primary key already in the array, it replaces the existing item:
 * const items = [
 *   { id: 1, name: 'Alpha' },
 *   { id: 2, name: 'Beta' }
 * ];
 * 
 * const changeSet = {
 *   added: [{ id: 2, name: 'Beta Prime' }], // replaces existing item with id:2
 *   updated: [],
 *   deleted_keys: []
 * };
 * 
 * const result = applyChangeSet(items, changeSet, item => item.id);
 * // result:
 * // [
 * //   { id: 1, name: 'Alpha' },
 * //   { id: 2, name: 'Beta Prime' }
 * // ]
 * 
 */
export function applyChangeSet<T extends Record<string, any>>(items:T[], changeSet:ChangeSet<T>, pk:PrimaryKeyGetter<T>, options?: ApplyChangeSetOptions):T[] {

    const removedKeys = 'removed_keys' in changeSet? changeSet.removed_keys : changeSet.removed.map(x => pk(x));



    const updatedItemMap = new Map<PrimaryKeyValue, T>();
    [...changeSet.added, ...changeSet.updated].forEach(item => updatedItemMap.set(pk(item), item));


    const whitelist:Set<PrimaryKeyValue> | undefined = options?.whitelist_item_pks? new Set(options.whitelist_item_pks) : undefined;

    const updatedPks = new Set<PrimaryKeyValue>();

    // Update or delete items
    items = items.map(item => {
        const itemPk = pk(item);
        if( removedKeys.includes(itemPk) || (whitelist && !whitelist.has(itemPk)) ) {
            return undefined;
        } else if( updatedItemMap.has(itemPk) ) {
            updatedPks.add(itemPk);
            return updatedItemMap.get(itemPk)!;
        } else {
            return item;
        }
    })
    .filter((item):item is T => !!item);

    
    // Add new items
    const addItems = changeSet.added.filter(item => {
        const itemPk = pk(item);
        return !updatedPks.has(itemPk) && 
            (!whitelist || whitelist.has(itemPk))
    })
    if( addItems.length>0 ) {
        items = [
            ...items, 
            ...addItems
        ]
    }

    return items;
}

