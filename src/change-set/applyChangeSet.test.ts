// applyChangeSet.test.ts

import { describe, it, expect } from 'vitest';
import { applyChangeSet } from './applyChangeSet.ts'; // Assuming the types are in this file
import type { PrimaryKeyValue } from '../utils/getKeyValue.ts';
import type { ChangeSet } from './types.ts';

// Helper types and functions for tests
type Item = {
    id: PrimaryKeyValue;
    name: string;
    value?: number;
};

const pkGetter = (item: Item): PrimaryKeyValue => item.id;

describe('applyChangeSet', () => {

    const initialItems = Object.freeze([
        { id: 1, name: 'Apple' },
        { id: 2, name: 'Banana' },
        { id: 3, name: 'Cherry' },
    ]) as Item[];

    it('should not mutate the original items array', () => {
        const originalItemsClone = JSON.parse(JSON.stringify(initialItems));
        const changeSet: ChangeSet<Item> = { added: [], updated: [], removed: [] };

        const result = applyChangeSet(initialItems, changeSet, pkGetter);

        // Ensure the result is a new array instance
        expect(result).not.toBe(initialItems);
        // Ensure the original array's content is unchanged
        expect(initialItems).toEqual(originalItemsClone);
    });

    it('should return a new, deeply equal array if the changeSet is empty', () => {
        const changeSet: ChangeSet<Item> = { added: [], updated: [], removed: [] };
        const result = applyChangeSet(initialItems, changeSet, pkGetter);

        expect(result).toEqual(initialItems);
        expect(result).not.toBe(initialItems);
    });
    
    describe('Core Operations (using `removed` object array)', () => {
        it('should add new items to the array', () => {
            const changeSet: ChangeSet<Item> = {
                added: [{ id: 4, name: 'Date' }],
                updated: [],
                removed: []
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            expect(result).toHaveLength(4);
            expect(result).toEqual(expect.arrayContaining([
                ...initialItems,
                { id: 4, name: 'Date' }
            ]));
        });

        it('should update existing items in the array', () => {
            const changeSet: ChangeSet<Item> = {
                added: [],
                updated: [{ id: 2, name: 'Blueberry' }],
                removed: []
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            expect(result).toHaveLength(3);
            expect(result.find(item => item.id === 2)?.name).toBe('Blueberry');
            expect(result.find(item => item.id === 1)?.name).toBe('Apple');
        });

        it('should remove items from the array', () => {
            const changeSet: ChangeSet<Item> = {
                added: [],
                updated: [],
                removed: [{ id: 3, name: 'Cherry' }]
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            expect(result).toHaveLength(2);
            expect(result.find(item => item.id === 3)).toBeUndefined();
        });

        it('should handle a combination of adds, updates, and removes', () => {
            const changeSet: ChangeSet<Item> = {
                added: [{ id: 4, name: 'Date' }],
                updated: [{ id: 1, name: 'Apricot' }],
                removed: [{ id: 2, name: 'Banana' }]
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            
            expect(result).toHaveLength(3);
            expect(result).toEqual(expect.arrayContaining([
                { id: 1, name: 'Apricot' },
                { id: 3, name: 'Cherry' },
                { id: 4, name: 'Date' }
            ]));
        });

         it('should treat an item in `added` as an update if its key already exists', () => {
            const changeSet: ChangeSet<Item> = {
                added: [{ id: 2, name: 'Better Banana' }],
                updated: [],
                removed: [],
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            console.log(result);
            expect(result).toHaveLength(3);
            
            expect(result.find(item => item.id === 2)?.name).toBe('Better Banana');
        });
    });

    describe('Core Operations (using `removed_keys`)', () => {
        it('should remove items using an array of primary keys', () => {
            const changeSet: ChangeSet<Item> = {
                added: [],
                updated: [],
                removed_keys: [1, 3]
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ id: 2, name: 'Banana' });
        });

        it('should handle a combination of adds, updates, and removals by key', () => {
            const changeSet: ChangeSet<Item> = {
                added: [{ id: 'd4', name: 'Date' }],
                updated: [{ id: 1, name: 'Apricot' }],
                removed_keys: [2]
            };
            const itemsWithMixedKeys = [
                { id: 1, name: 'Apple' },
                { id: 2, name: 'Banana' },
                { id: 'c3', name: 'Cherry' },
            ]
            const result = applyChangeSet(itemsWithMixedKeys, changeSet, pkGetter);

            expect(result).toHaveLength(3);
            expect(result).toEqual(expect.arrayContaining([
                { id: 1, name: 'Apricot' },
                { id: 'c3', name: 'Cherry' },
                { id: 'd4', name: 'Date' }
            ]));
        });
    });

    describe('Edge Cases and Input Handling', () => {

        it('should handle an empty initial items array', () => {
             const changeSet: ChangeSet<Item> = {
                added: [{ id: 1, name: 'First Item' }],
                updated: [],
                removed: [],
            };
            const result = applyChangeSet([], changeSet, pkGetter);
            expect(result).toEqual([{ id: 1, name: 'First Item' }]);
        });

        it('should ignore removal of keys that do not exist', () => {
            const changeSet: ChangeSet<Item> = {
                added: [],
                updated: [],
                removed_keys: [99, 100]
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            expect(result).toEqual(initialItems);
        });

        it('should not add an item from `updated` if its key does not already exist', () => {
            const changeSet: ChangeSet<Item> = {
                added: [],
                updated: [{ id: 99, name: 'Ghost Item' }],
                removed: [],
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            expect(result).toHaveLength(3);
            expect(result.find(item => item.id === 99)).toBeUndefined();
        });

        it('should prevent duplicates if an item is in both `added` and `updated`', () => {
            const changeSet: ChangeSet<Item> = {
                added: [{ id: 2, name: 'Added Banana' }],
                updated: [{ id: 2, name: 'Updated Banana' }],
                removed: [],
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter);
            // The item should be updated, and only appear once.
            expect(result).toHaveLength(3);
            expect(result.filter(item => item.id === 2)).toHaveLength(1);
            expect(result.find(item => item.id === 2)?.name).toBe('Updated Banana');
        });
    });

    describe('Whitelist Options (`whitelist_item_pks`)', () => {
        const whitelist = [1, 3, 5]; // Whitelist allows Apple, Cherry, and a new item '5'

        it('should remove existing items that are NOT in the whitelist', () => {
            const changeSet: ChangeSet<Item> = { added: [], updated: [], removed: [] }; // No changes
            const result = applyChangeSet(initialItems, changeSet, pkGetter, { whitelist_item_pks: whitelist });
            
            // Item 2 (Banana) should be removed as it's not in the whitelist
            expect(result).toHaveLength(2);
            expect(result.find(item => item.id === 2)).toBeUndefined();
            expect(result.map(item => item.id)).toEqual([1, 3]);
        });

        it('should only add items that are in the whitelist', () => {
            const changeSet: ChangeSet<Item> = {
                added: [
                    { id: 5, name: 'Elderberry' }, // in whitelist
                    { id: 6, name: 'Fig' }          // not in whitelist
                ],
                updated: [],
                removed: []
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter, { whitelist_item_pks: whitelist });

            // Item 2 removed (not in whitelist)
            // Item 5 added (in whitelist)
            // Item 6 NOT added (not in whitelist)
            expect(result).toHaveLength(3);
            expect(result.find(item => item.id === 5)).toBeDefined();
            expect(result.find(item => item.id === 6)).toBeUndefined();
            expect(result.map(i => i.id).sort()).toEqual([1, 3, 5]);
        });

        it('should only update items that are in the whitelist', () => {
             const changeSet: ChangeSet<Item> = {
                added: [],
                updated: [
                    { id: 1, name: 'Awesome Apple' },  // in whitelist
                    { id: 2, name: 'Bold Banana' }      // not in whitelist
                ],
                removed: []
            };
            const result = applyChangeSet(initialItems, changeSet, pkGetter, { whitelist_item_pks: whitelist });

            // Item 1 is updated because it's in the whitelist
            // Item 2 is removed because it's not in the whitelist (the update is ignored)
            // Item 3 remains
            expect(result).toHaveLength(2);
            expect(result.find(item => item.id === 1)?.name).toBe('Awesome Apple');
            expect(result.find(item => item.id === 2)).toBeUndefined();
        });

        it('should correctly apply a complex changeset with a whitelist', () => {
            const complexInitialState: Item[] = [
                { id: 10, name: 'Item 10' },
                { id: 20, name: 'Item 20' }, // Not in whitelist
                { id: 30, name: 'Item 30' },
                { id: 40, name: 'Item 40' }, // To be removed by changeset
            ];
            const complexWhitelist = [10, 30, 50]; // Whitelist pks
            const changeSet: ChangeSet<Item> = {
                added: [
                    { id: 50, name: 'New Item 50' },   // Allowed by whitelist
                    { id: 60, name: 'New Item 60' },   // Blocked by whitelist
                ],
                updated: [
                    { id: 10, name: 'Updated Item 10' }, // Allowed by whitelist
                    { id: 20, name: 'Updated Item 20' }, // Blocked by whitelist
                ],
                removed_keys: [40] // This item is in initial state but not whitelist
            };

            const result = applyChangeSet(complexInitialState, changeSet, pkGetter, { whitelist_item_pks: complexWhitelist });

            /*
             * Expected outcome:
             * - Item 10: Is in whitelist, updated to 'Updated Item 10'.
             * - Item 20: Not in whitelist, removed. Update is ignored.
             * - Item 30: Is in whitelist, remains untouched.
             * - Item 40: Not in whitelist, removed. The explicit removal is redundant but harmless.
             * - Item 50: Is in whitelist, added as 'New Item 50'.
             * - Item 60: Not in whitelist, add is ignored.
            */
           
            expect(result).toHaveLength(3);
            expect(result).toEqual(expect.arrayContaining([
                { id: 10, name: 'Updated Item 10' },
                { id: 30, name: 'Item 30' },
                { id: 50, name: 'New Item 50' }
            ]));
        });
        
        it('should return an empty array if the whitelist is empty', () => {
             const result = applyChangeSet(initialItems, { added:[], updated:[], removed:[] }, pkGetter, { whitelist_item_pks: [] });
             expect(result).toEqual([]);
        });
    });
});