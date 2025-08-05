import { describe, it, expect, beforeEach } from 'vitest';

import type { ObjectsDeltaApplicable } from '../types.ts';
import type { PrimaryKeyValue } from '../../utils/getKeyValue.ts';

// Define a generic interface for the object type used in tests.
interface TestObject {
    id: PrimaryKeyValue;
    value: string;
    version?: number;
}

// Define the signature for the function under test. 
// This allows the test suite to be generic and accept any matching implementation.
type ApplyDeltaFunction<T extends Record<string, any>> = (
    items: T[],
    delta: ObjectsDeltaApplicable<T>,
    pk: (item: T) => PrimaryKeyValue,
    options?: {
        whitelist_item_pks?: PrimaryKeyValue[];
        mutate?: boolean;
    }
) => T[];


/**
 * A reusable test suite for any `applyDelta` function.
 * 
 * @param applyDelta The specific implementation of the applyDelta function to be tested.
 * @throws on remove/update conflicts
 */
export function testApplyDelta(
    applyDelta: ApplyDeltaFunction<TestObject>
) {
    describe('Generic applyDelta Test Suite', () => {
        let initialItems: TestObject[];
        const pkGetter = (item: TestObject) => item.id;

        // Reset the initial data before each test to ensure isolation.
        beforeEach(() => {
            initialItems = [
                { id: 1, value: 'one', version: 1 },
                { id: 2, value: 'two', version: 1 },
                { id: 3, value: 'three', version: 1 },
            ];
        });

        describe('Core Behavior: Immutability (Default)', () => {
            it('should not mutate the original `items` array by default', () => {
                const originalArrayReference = initialItems;
                const delta: ObjectsDeltaApplicable<TestObject> = { insert: [{ id: 4, value: 'four' }] };

                applyDelta(initialItems, delta, pkGetter);

                // Verify the original array is unchanged.
                expect(initialItems).toEqual([
                    { id: 1, value: 'one', version: 1 },
                    { id: 2, value: 'two', version: 1 },
                    { id: 3, value: 'three', version: 1 },
                ]);
                expect(initialItems).toBe(originalArrayReference);
            });

            it('should return a new array instance', () => {
                const result = applyDelta(initialItems, {}, pkGetter);
                expect(result).not.toBe(initialItems);
            });

            it('should return a new, deeply equal array when the delta is empty', () => {
                const result = applyDelta(initialItems, {}, pkGetter);
                expect(result).toEqual(initialItems);
                expect(result).not.toBe(initialItems);
            });
        });

        describe('Core Behavior: Mutability (`mutate: true`)', () => {
            it('should return the same array reference when `mutate: true` is passed', () => {
                const originalArrayReference = initialItems;
                const delta: ObjectsDeltaApplicable<TestObject> = { insert: [{ id: 4, value: 'four' }] };
                const result = applyDelta(initialItems, delta, pkGetter, { mutate: true });
                expect(result).toBe(originalArrayReference);
            });

            it('should add inserted items to the mutated array', () => {
                const originalArrayReference = initialItems;
                const delta: ObjectsDeltaApplicable<TestObject> = { insert: [{ id: 4, value: 'four' }] };
                applyDelta(initialItems, delta, pkGetter, { mutate: true });
                expect(initialItems).toHaveLength(4);
                expect(initialItems[3]).toEqual({ id: 4, value: 'four' });
                expect(originalArrayReference[3]).toEqual({ id: 4, value: 'four' });
            });

            it('should remove items from the mutated array', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { remove_keys: [2] };
                applyDelta(initialItems, delta, pkGetter, { mutate: true });
                expect(initialItems).toHaveLength(2);
                expect(initialItems.find(item => item.id === 2)).toBeUndefined();
            });

            it('should replace object references within the array on update/upsert', () => {
                const originalItemRef = initialItems[1]; // { id: 2, ... }
                const delta: ObjectsDeltaApplicable<TestObject> = { update: [{ id: 2, value: 'two-updated' }] };

                applyDelta(initialItems, delta, pkGetter, { mutate: true });

                const updatedItem = initialItems.find(item => item.id === 2);
                expect(updatedItem).toBeDefined();
                expect(updatedItem).not.toBe(originalItemRef);
                expect(updatedItem?.value).toBe('two-updated');
            });
        });

        describe('Delta Operations', () => {
            it('should add new items with `insert`', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { insert: [{ id: 4, value: 'four' }] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(4);
                expect(result).toContainEqual({ id: 4, value: 'four' });
            });

            it('should update existing items with `update`', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { update: [{ id: 2, value: 'two-updated', version: 2 }] };
                const result = applyDelta(initialItems, delta, pkGetter);
                const updatedItem = result.find(item => item.id === 2);
                expect(updatedItem).toEqual({ id: 2, value: 'two-updated', version: 2 });
            });

            it('should remove items using an array of primary keys with `remove_keys`', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { remove_keys: [1, 3] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(1);
                expect(result[0]!.id).toBe(2);
            });

            it('should insert a new item with `upsert` if it does not exist', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { upsert: [{ id: 4, value: 'four-upserted' }] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(4);
                expect(result).toContainEqual({ id: 4, value: 'four-upserted' });
            });

            it('should update an existing item with `upsert` if it does exist', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { upsert: [{ id: 2, value: 'two-upserted', version: 2 }] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(3);
                expect(result.find(item => item.id === 2)).toEqual({ id: 2, value: 'two-upserted', version: 2 });
            });

            it('should handle a combination of inserts, updates, upserts, and removals', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    insert: [{ id: 10, value: 'ten' }], // Add 10
                    update: [{ id: 1, value: 'one-updated' }], // Update 1
                    upsert: [
                        { id: 3, value: 'three-upserted' }, // Upsert-update 3
                        { id: 20, value: 'twenty' } // Upsert-insert 20
                    ],
                    remove_keys: [2] // Remove 2
                };

                const result = applyDelta(initialItems, delta, pkGetter);

                const finalIds = result.map(i => i.id).sort((a, b) => Number(a) - Number(b));
                expect(finalIds).toEqual([1, 3, 10, 20]);

                expect(result.find(item => item.id === 1)?.value).toBe('one-updated');
                expect(result.find(item => item.id === 3)?.value).toBe('three-upserted');
                expect(result.find(item => item.id === 10)).toBeDefined();
                expect(result.find(item => item.id === 20)).toBeDefined();
            });
        });

        describe('Conflicting Delta Operations', () => {
            // Precedence: `remove_keys` is a terminal operation that conflicts with any modification.
            // Otherwise, `upsert` takes precedence over `insert` and `update`.
            // A combination of `insert` and `update` for the same key is effectively an `upsert`.

            it('should throw an error if a key is in `remove_keys` and `insert`', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    remove_keys: [1],
                    insert: [{ id: 1, value: 'conflict' }]
                };
                expect(() => applyDelta(initialItems, delta, pkGetter)).toThrow();
            });

            it('should throw an error if a key is in `remove_keys` and `update`', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    remove_keys: [1],
                    update: [{ id: 1, value: 'conflict' }]
                };
                expect(() => applyDelta(initialItems, delta, pkGetter)).toThrow();
            });

            it('should throw an error if a key is in `remove_keys` and `upsert`', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    remove_keys: [1],
                    upsert: [{ id: 1, value: 'conflict' }]
                };
                expect(() => applyDelta(initialItems, delta, pkGetter)).toThrow();
            });


            it('should treat an item in both `insert` and `update` as an `upsert` (insert case)', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    insert: [{ id: 4, value: 'ignored' }],
                    update: [{ id: 4, value: 'four-updated' }]
                };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(4);
                expect(result.find(i => i.id === 4)?.value).toBe('four-updated');
            });

            it('should treat an item in both `insert` and `update` as an `upsert` (update case)', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    insert: [{ id: 1, value: 'ignored' }],
                    update: [{ id: 1, value: 'one-updated' }]
                };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(3);
                expect(result.find(i => i.id === 1)?.value).toBe('one-updated');
            });

            it('should prioritize `upsert` over `insert` for the same key', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    insert: [{ id: 1, value: 'ignored' }],
                    upsert: [{ id: 1, value: 'one-upserted' }]
                };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result.find(i => i.id === 1)?.value).toBe('one-upserted');
            });
        });

        describe('Edge Cases and Input Handling', () => {
            it('should handle an empty initial `items` array', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { upsert: [{ id: 1, value: 'one' }] };
                const result = applyDelta([], delta, pkGetter);
                expect(result).toEqual([{ id: 1, value: 'one' }]);
            });

            it('should skip `insert` for items that already exist', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { insert: [{ id: 2, value: 'two-new' }] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result.find(item => item.id === 2)?.value).toBe('two');
            });

            it('should skip `update` for items that do not exist', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { update: [{ id: 99, value: 'does-not-exist' }] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toEqual(initialItems);
            });

            it('should ignore removal of keys that do not exist in the array', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = { remove_keys: [99, 100] };
                const result = applyDelta(initialItems, delta, pkGetter);
                expect(result).toHaveLength(3);
            });
        });

        describe('`whitelist_item_pks` option', () => {
            it('should remove existing items not present in the whitelist', () => {
                const options = { whitelist_item_pks: [1, 3] }; // Item with id: 2 should be removed.
                const result = applyDelta(initialItems, {}, pkGetter, options);
                expect(result.map(i => i.id).sort()).toEqual([1, 3]);
            });

            it('should only add items whose keys are in the whitelist', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    insert: [{ id: 4, value: 'four' }], // Allowed
                    upsert: [{ id: 5, value: 'five' }]  // Blocked
                };
                const options = { whitelist_item_pks: [1, 2, 3, 4] };
                const result = applyDelta(initialItems, delta, pkGetter, options);
                expect(result.find(i => i.id === 4)).toBeDefined();
                expect(result.find(i => i.id === 5)).toBeUndefined();
            });

            it('should only update items whose keys are in the whitelist', () => {
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    update: [{ id: 1, value: 'one-updated' }], // Allowed
                    upsert: [{ id: 2, value: 'two-updated' }]  // Blocked, because 2 is not in whitelist
                };
                const options = { whitelist_item_pks: [1, 3] }; // Item 2 will be removed.
                const result = applyDelta(initialItems, delta, pkGetter, options);

                const finalIds = result.map(i => i.id).sort();
                expect(finalIds).toEqual([1, 3]);
                expect(result.find(i => i.id === 1)?.value).toBe('one-updated');
                expect(result.find(i => i.id === 2)).toBeUndefined();
            });

            it('should correctly apply a complex changeset with a whitelist', () => {
                initialItems.push({ id: 5, value: 'five' }); // Add item 5 to initial set.
                const delta: ObjectsDeltaApplicable<TestObject> = {
                    insert: [{ id: 6, value: 'six' }],           // ADD (allowed)
                    update: [{ id: 1, value: 'one-updated' }],   // UPDATE (allowed)
                    upsert: [{ id: 3, value: 'three-updated' }], // UPDATE (allowed)
                    remove_keys: [5]                              // REMOVE (allowed)
                };
                // Whitelist allows 1, 3, 6. It implicitly removes 2 and 5.
                const options = { whitelist_item_pks: [1, 3, 6] };
                const result = applyDelta(initialItems, delta, pkGetter, options);

                const finalIds = result.map(i => i.id).sort((a, b) => Number(a) - Number(b));
                expect(finalIds).toEqual([1, 3, 6]);
                expect(result.find(i => i.id === 1)?.value).toBe('one-updated');
                expect(result.find(i => i.id === 3)?.value).toBe('three-updated');
            });

            it('should return an empty array if the whitelist is empty', () => {
                const options = { whitelist_item_pks: [] };
                const result = applyDelta(initialItems, {}, pkGetter, options);
                expect(result).toEqual([]);
            });
        });

        describe('Order Preservation', () => {
            const getOrderTestState = () => ({
                // Use non-sequential IDs to ensure order isn't just a side-effect of sorting.
                initialItems: [
                    { id: 10, value: 'ten', version: 1 },
                    { id: 2, value: 'two', version: 1 },
                    { id: 5, value: 'five', version: 1 },
                    { id: 8, value: 'eight', version: 1 },
                ],
                delta: {
                    update: [{ id: 5, value: 'five-updated', version: 2 }], // Update item in the middle
                    remove_keys: [2], // Remove item `two`
                    insert: [{ id: 1, value: 'one', version: 1 }], // Insert a new item
                }
            });

            // Expected final order: Untouched items first, then new items.
            // [10, 5 (updated in place), 8, 1 (new)]
            const expectedIdOrder = [10, 5, 8, 1];

            describe('Non-mutating (default)', () => {
                it('should preserve item order, update in place, and add insertions to the end', () => {
                    const { initialItems, delta } = getOrderTestState();
                    const originalItemsRef = initialItems;

                    const result = applyDelta(initialItems, delta, pkGetter);
                    const finalIdOrder = result.map(item => item.id);

                    expect(finalIdOrder).toEqual(expectedIdOrder);

                    // Ensure the original array was not changed
                    expect(initialItems).toBe(originalItemsRef);
                    expect(initialItems.map(i => i.id)).toEqual([10, 2, 5, 8]);
                });
            });

            describe('Mutating (`mutate: true`)', () => {
                it('should preserve item order, update in place, and add insertions to the end', () => {
                    const { initialItems, delta } = getOrderTestState();
                    const originalItemsRef = initialItems;

                    const result = applyDelta(initialItems, delta, pkGetter, { mutate: true });
                    const finalIdOrder = result.map(item => item.id);

                    expect(finalIdOrder).toEqual(expectedIdOrder);

                    // Ensure the operation mutated the original array reference
                    expect(result).toBe(originalItemsRef);
                });
            });
        });
    });
}