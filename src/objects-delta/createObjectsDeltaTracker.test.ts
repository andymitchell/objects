import { describe, it, expect, beforeEach } from 'vitest';
import { createObjectsDeltaTracker } from './createObjectsDeltaTracker.ts';
import type { ObjectsDeltaTracker } from './types.ts';

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


describe('createObjectsDeltaTracker', () => {

    // A suite of reusable tests that should pass for both `useDeepEqual: true` and `useDeepEqual: false`
    // when object references are managed correctly (i.e., new data means a new object reference).
    const runSharedTests = (trackerGenerator: () => ObjectsDeltaTracker<TestItem>) => {
        let tracker: ObjectsDeltaTracker<TestItem>;

        beforeEach(() => {
            tracker = trackerGenerator();
        });

        it('should return all items as added on the first run', () => {
            const items = getInitialItems();
            const delta = tracker(items);
            expect(delta.added).toEqual(items);
            expect(delta.updated).toEqual([]);
            expect(delta.removed).toEqual([]);
        });

        it('should detect no changes when the same array is passed again', () => {
            const items = getInitialItems();
            tracker(items); // Initial run
            const delta = tracker(items); // Second run with same items
            expect(delta.added).toEqual([]);
            expect(delta.updated).toEqual([]);
            expect(delta.removed).toEqual([]);
        });

        it('should correctly identify added items', () => {
            const items = getInitialItems();
            tracker(items);
            const newItem = { id: 4, name: 'Date' };
            const newItems = [...items, newItem];
            const delta = tracker(newItems);

            expect(delta.added).toEqual([newItem]);
            expect(delta.updated).toEqual([]);
            expect(delta.removed).toEqual([]);
        });

        it('should correctly identify removed items', () => {
            const items = getInitialItems();
            tracker(items);
            const newItems = items.slice(0, 2); // Remove item with id 3
            const delta = tracker(newItems);

            expect(delta.removed).toEqual([items[2]]);
            expect(delta.added).toEqual([]);
            expect(delta.updated).toEqual([]);
        });

        it('should correctly identify updated items when references change', () => {
            const items = getInitialItems();
            tracker(items);

            const updatedItem = { ...items[1], name: 'Better Banana' } as TestItem; // New reference
            const newItems: TestItem[] = [items[0]!, updatedItem, items[2]!];
            const delta = tracker(newItems);

            expect(delta.updated).toEqual([updatedItem]);
            expect(delta.added).toEqual([]);
            expect(delta.removed).toEqual([]);
        });

        it('should handle a mix of additions, updates, and removals', () => {
            const items = getInitialItems();
            tracker(items);

            const updatedItem = { ...items[1], name: 'Blueberry' } as TestItem; // Update id 2
            const newItem = { id: 4, name: 'Date' }; // Add id 4

            // New state: remove id 1, update id 2, keep id 3, add id 4
            const newItems = [updatedItem, items[2]!, newItem];
            const delta = tracker(newItems);

            expect(delta.added).toEqual([newItem]);
            expect(delta.updated).toEqual([updatedItem]);
            expect(delta.removed).toEqual([items[0]]); // Removed Apple
        });

        it('should handle replacing all items', () => {
            const items = getInitialItems();
            tracker(items);
            const newItems = [{ id: 10, name: 'Xylophone' }, { id: 11, name: 'Yacht' }];
            const delta = tracker(newItems);

            expect(delta.added).toEqual(newItems);
            expect(delta.removed).toEqual(items);
            expect(delta.updated).toEqual([]);
        });

        it('should handle an empty initial array', () => {
            const delta = tracker([]);

            expect(delta.added).toEqual([]);
            expect(delta.updated).toEqual([]);
            expect(delta.removed).toEqual([]);
        });

        it('should handle an empty new array (all items removed)', () => {
            const items = getInitialItems();
            tracker(items); // Initial state
            const delta = tracker([]); // Pass empty array

            expect(delta.removed).toEqual(items);
            expect(delta.added).toEqual([]);
            expect(delta.updated).toEqual([]);
        });

    };

    describe('with strict equality (useDeepEqual: false)', () => {

        const trackerGenerator = () => createObjectsDeltaTracker<TestItem>('id', { useDeepEqual: false })



        // Run all the shared tests
        runSharedTests(trackerGenerator);

        describe('non standard tests', () => {
            let tracker: ObjectsDeltaTracker<TestItem>;
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
                expect(delta.updated).toEqual([]);
                expect(delta.added).toEqual([]);
                expect(delta.removed).toEqual([]);
            });
        })

    });

    describe('with deep equality (useDeepEqual: true)', () => {

        const trackerGenerator = () => createObjectsDeltaTracker<TestItem>('id', { useDeepEqual: true })

        // Run all the shared tests
        runSharedTests(trackerGenerator);

        describe('non standard tests', () => {
            let tracker: ObjectsDeltaTracker<TestItem>;
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

                expect(delta.updated).toEqual([items[0]]);
                expect(delta.added).toEqual([]);
                expect(delta.removed).toEqual([]);
            });

            it('should detect an update for deeply equal but not referentially equal objects', () => {
                const initial = [
                    { id: 1, name: 'Deep', data: { value: 'A' } }
                ];
                tracker(initial);

                // Create a new object with the same data
                const updated = [
                    { id: 1, name: 'Deep', data: { value: 'B' } }
                ];

                // Ensure references are not the same
                expect(initial[0]).not.toBe(updated[0]);

                const delta = tracker(updated);
                expect(delta.updated).toEqual(updated);
                expect(delta.added).toEqual([]);
                expect(delta.removed).toEqual([]);
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
                expect(delta.updated).toEqual([]);
                expect(delta.added).toEqual([]);
                expect(delta.removed).toEqual([]);
            });

            it('should handle complex nested object changes', () => {
                const initial = [
                    { id: 1, name: 'Nested', data: { value: 'X', nested: { prop: 'Y' } } }
                ];
                tracker(initial);

                const updated = [
                    { id: 1, name: 'Nested', data: { value: 'X', nested: { prop: 'Z' } } }
                ];

                const delta = tracker(updated);
                expect(delta.updated).toEqual(updated);
                expect(delta.added).toEqual([]);
                expect(delta.removed).toEqual([]);
            });
        })


    });
});