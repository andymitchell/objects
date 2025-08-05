import { describe, it, expect, beforeEach } from 'vitest';
import { createObjectsArrayDiffer } from './createObjectsArrayDiffer.ts';
import type { ObjectsArrayDiffer } from './types.ts';

// Define a standard interface for test items.
interface TestItem {
    id: number;
    name: string;
    data?: {
        value: string;
        nested?: {
            prop: string;
        }
    }
}

// === Test Data ===

/**
 * A factory function to create a fresh set of initial items for each test,
 * ensuring referential integrity within a single test run.
 */
const getInitialItems = (): TestItem[] => [
    { id: 1, name: 'Apple' },
    { id: 2, name: 'Banana' },
    { id: 3, name: 'Cherry' },
];


describe('createObjectsArrayDiffer', () => {

    // A suite of reusable tests that should pass for both `useDeepEqual: true` and `useDeepEqual: false`
    // when object references are managed correctly (i.e., new data means a new object reference).
    const runSharedTests = (trackerGenerator: () => ObjectsArrayDiffer<TestItem>) => {
        let tracker: ObjectsArrayDiffer<TestItem>;

        beforeEach(() => {
            tracker = trackerGenerator();
        });

        it('should return all items as insert on the first run', () => {
            const items = getInitialItems();
            const delta = tracker(items);
            expect(delta.insert).toEqual(items);
            expect(delta.update).toEqual([]);
            expect(delta.remove_keys).toEqual([]);
        });

        it('should detect no changes when the same array is passed again', () => {
            const items = getInitialItems();
            tracker(items); // Initial run
            const delta = tracker(items); // Second run with same items
            expect(delta.insert).toEqual([]);
            expect(delta.update).toEqual([]);
            expect(delta.remove_keys).toEqual([]);
        });

        it('should correctly identify insert items', () => {
            const items = getInitialItems();
            tracker(items);
            const newItem = { id: 4, name: 'Date' };
            const newItems = [...items, newItem];
            const delta = tracker(newItems);

            expect(delta.insert).toEqual([newItem]);
            expect(delta.update).toEqual([]);
            expect(delta.remove_keys).toEqual([]);
        });

        it('should correctly identify remove_keys items', () => {
            const items = getInitialItems();
            tracker(items);
            const newItems = items.slice(0, 2); // Remove item with id 3
            const delta = tracker(newItems);

            expect(delta.remove_keys).toEqual([items[2]!.id]);
            expect(delta.insert).toEqual([]);
            expect(delta.update).toEqual([]);
        });

        it('should correctly identify update items when references change', () => {
            const items = getInitialItems();
            tracker(items);

            const updateItem = { ...items[1], name: 'Better Banana' } as TestItem; // New reference
            const newItems: TestItem[] = [items[0]!, updateItem, items[2]!];
            const delta = tracker(newItems);

            expect(delta.update).toEqual([updateItem]);
            expect(delta.insert).toEqual([]);
            expect(delta.remove_keys).toEqual([]);
        });

        it('should handle a mix of additions, updates, and removals', () => {
            const items = getInitialItems();
            tracker(items);

            const updateItem = { ...items[1], name: 'Blueberry' } as TestItem; // Update id 2
            const newItem = { id: 4, name: 'Date' }; // Add id 4

            // New state: remove id 1, update id 2, keep id 3, add id 4
            const newItems = [updateItem, items[2]!, newItem];
            const delta = tracker(newItems);

            expect(delta.insert).toEqual([newItem]);
            expect(delta.update).toEqual([updateItem]);
            expect(delta.remove_keys).toEqual([items[0]!.id]); // Removed Apple
        });

        it('should handle replacing all items', () => {
            const items = getInitialItems();
            tracker(items);
            const newItems = [{ id: 10, name: 'Xylophone' }, { id: 11, name: 'Yacht' }];
            const delta = tracker(newItems);

            expect(delta.insert).toEqual(newItems);
            expect(delta.remove_keys).toEqual(items.map(x => x.id));
            expect(delta.update).toEqual([]);
        });

        it('should handle an empty initial array', () => {
            const delta = tracker([]);

            expect(delta.insert).toEqual([]);
            expect(delta.update).toEqual([]);
            expect(delta.remove_keys).toEqual([]);
        });

        it('should handle an empty new array (all items remove_keys)', () => {
            const items = getInitialItems();
            tracker(items); // Initial state
            const delta = tracker([]); // Pass empty array

            expect(delta.remove_keys).toEqual(items.map(x => x.id));
            expect(delta.insert).toEqual([]);
            expect(delta.update).toEqual([]);
        });

    };

    describe('with strict equality (useDeepEqual: false)', () => {

        const trackerGenerator = () => createObjectsArrayDiffer<TestItem>('id', { useDeepEqual: false })



        // Run all the shared tests
        runSharedTests(trackerGenerator);

        describe('non standard tests', () => {
            let tracker: ObjectsArrayDiffer<TestItem>;
            beforeEach(() => {
                tracker = trackerGenerator();
            });

            it('should NOT detect an update if an item is mutated but its reference is the same', () => {
                const items = getInitialItems();
                tracker(items);

                // Mutate an item directly without changing its reference
                const itemToMutate = items[1];
                itemToMutate!.name = 'Mutated Banana';

                const delta = tracker(items);

                // With strict equality, this mutation is missed.
                expect(delta.update).toEqual([]);
                expect(delta.insert).toEqual([]);
                expect(delta.remove_keys).toEqual([]);
            });
        })

    });

    describe('with deep equality (useDeepEqual: true)', () => {

        const trackerGenerator = () => createObjectsArrayDiffer<TestItem>('id', { useDeepEqual: true })

        // Run all the shared tests
        runSharedTests(trackerGenerator);

        describe('non standard tests', () => {
            let tracker: ObjectsArrayDiffer<TestItem>;
            beforeEach(() => {
                tracker = trackerGenerator();
            });


            it('should detect an update even if the object reference is the same (mutation)', () => {
                const items = [
                    { id: 1, name: 'Original', data: { value: 'A' } }
                ];
                tracker(items);

                // Mutate the object
                items[0]!.data!.value = 'Mutated';
                const delta = tracker(items);

                expect(delta.update).toEqual([items[0]]);
                expect(delta.insert).toEqual([]);
                expect(delta.remove_keys).toEqual([]);
            });

            it('should detect an update for deeply equal but not referentially equal objects', () => {
                const initial = [
                    { id: 1, name: 'Deep', data: { value: 'A' } }
                ];
                tracker(initial);

                // Create a new object with the same data
                const update = [
                    { id: 1, name: 'Deep', data: { value: 'B' } }
                ];

                // Ensure references are not the same
                expect(initial[0]).not.toBe(update[0]);

                const delta = tracker(update);
                expect(delta.update).toEqual(update);
                expect(delta.insert).toEqual([]);
                expect(delta.remove_keys).toEqual([]);
            });

            it('should NOT detect an update for deeply equal objects with different references', () => {
                const initial: TestItem[] = [
                    { id: 1, name: 'Deep', data: { value: 'some', nested: { prop: 'value' } } }
                ];
                tracker(initial);

                // Create a new object that is a deep clone
                const newItems: TestItem[] = [
                    { id: 1, name: 'Deep', data: { value: 'some', nested: { prop: 'value' } } }
                ];

                // Ensure references are different
                expect(initial[0]).not.toBe(newItems[0]);

                const delta = tracker(newItems);
                expect(delta.update).toEqual([]);
                expect(delta.insert).toEqual([]);
                expect(delta.remove_keys).toEqual([]);
            });

            it('should handle complex nested object changes', () => {
                const initial = [
                    { id: 1, name: 'Nested', data: { value: 'X', nested: { prop: 'Y' } } }
                ];
                tracker(initial);

                const update = [
                    { id: 1, name: 'Nested', data: { value: 'X', nested: { prop: 'Z' } } }
                ];

                const delta = tracker(update);
                expect(delta.update).toEqual(update);
                expect(delta.insert).toEqual([]);
                expect(delta.remove_keys).toEqual([]);
            });
        })


    });
});