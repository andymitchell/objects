import type { PrimaryKeyGetter } from "../utils/getKeyValue.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import { constrainChangeSetToFilter } from "./constrainChangeSetToFilter.ts";
import type { ChangeSet } from "./types.ts";

describe('constrainChangeSetToFilter', () => {

    // --- Test Data ---
    interface Item {
        id: number;
        status: 'active' | 'inactive';
        category: 'A' | 'B' | 'C';
        value: number;
    }
    const pk: PrimaryKeyGetter<Item> = (item) => item.id;

    const item1: Item = { id: 1, status: 'active', category: 'A', value: 10 };
    const item2: Item = { id: 2, status: 'inactive', category: 'A', value: 20 };
    const item3: Item = { id: 3, status: 'active', category: 'B', value: 30 };
    const item4: Item = { id: 4, status: 'inactive', category: 'B', value: 40 };
    const item5: Item = { id: 5, status: 'active', category: 'C', value: 50 }; // Initially removed

    const filterActive: WhereFilterDefinition<Item> = { status: 'active' };
    const filterCategoryA: WhereFilterDefinition<Item> = { category: 'A' };
    const filterValueGt25: WhereFilterDefinition<Item> = { value: { gte: 25 } };

    // This helper runs tests for both ChangeSet variants (`removed` and `removed_keys`)
    const testBothChangeSetTypes = (
        description: string,
        testFn: (type: 'removed' | 'removed_keys') => void
    ) => {
        describe(description, () => {
            it('should work for ChangeSet with `removed`', () => testFn('removed'));
            it('should work for ChangeSet with `removed_keys`', () => testFn('removed_keys'));
        });
    };

    describe('Core filtering behavior', () => {
        testBothChangeSetTypes('when items from `added` and `updated` are filtered out', (type) => {
            const changeSet = {
                added: [item1, item2], // item2 is inactive, should be removed
                updated: [item3, item4], // item4 is inactive, should be removed
                ...(type === 'removed' ? { removed: [item5] } : { removed_keys: [item5.id] }),
            };

            const result = constrainChangeSetToFilter(filterActive, changeSet, pk);

            expect(result.added).toEqual([item1]);
            expect(result.updated).toEqual([item3]);

            if ('removed' in result) {
                expect(result.removed).toHaveLength(3);
                expect(result.removed).toEqual(expect.arrayContaining([item5, item2, item4]));
            } else {
                expect(result.removed_keys).toHaveLength(3);
                expect(result.removed_keys).toEqual(expect.arrayContaining([5, 2, 4]));
            }
        });

        testBothChangeSetTypes('when a filter removes all `added` and `updated` items', (type) => {
             const changeSet = {
                added: [item2, item4], // Both inactive
                updated: [],
                ...(type === 'removed' ? { removed: [] } : { removed_keys: [] }),
            };
            
            const result = constrainChangeSetToFilter(filterActive, changeSet, pk);

            expect(result.added).toEqual([]);
            expect(result.updated).toEqual([]);

            if ('removed' in result) {
                expect(result.removed).toEqual(expect.arrayContaining([item2, item4]));
            } else {
                expect(result.removed_keys).toEqual(expect.arrayContaining([2, 4]));
            }
        });
    });

    describe('Referential equality', () => {
        it('should return the original ChangeSet object if no changes are made', () => {
            const changeSet: ChangeSet<Item> = {
                added: [item1, item3], // All active
                updated: [item5], // All active
                removed: [],
            };
            const result = constrainChangeSetToFilter(filterActive, changeSet, pk);
            expect(result).toBe(changeSet);
        });

        testBothChangeSetTypes('should return original `updated` array if only `added` is changed', (type) => {
            const originalUpdated = [item3];
            const changeSet = {
                added: [item1, item2], // item2 will be removed
                updated: originalUpdated,
                ...(type === 'removed' ? { removed: [] } : { removed_keys: [] }),
            };
            
            const result = constrainChangeSetToFilter(filterActive, changeSet, pk);

            expect(result.added).toEqual([item1]); // New array
            expect(result.added).not.toBe(changeSet.added);
            expect(result.updated).toBe(originalUpdated); // Same array reference
        });

        testBothChangeSetTypes('should return original `added` array if only `updated` is changed', (type) => {
            const originalAdded = [item1];
            const changeSet = {
                added: originalAdded,
                updated: [item3, item4], // item4 will be removed
                ...(type === 'removed' ? { removed: [] } : { removed_keys: [] }),
            };
            
            const result = constrainChangeSetToFilter(filterActive, changeSet, pk);

            expect(result.updated).toEqual([item3]); // New array
            expect(result.updated).not.toBe(changeSet.updated);
            expect(result.added).toBe(originalAdded); // Same array reference
        });
    });

    describe('De-duplication of removed items', () => {
        testBothChangeSetTypes('should not add a duplicate if a filtered item was already in the removed list', (type) => {
            // item2 is in `added` but also already in `removed`/`removed_keys`.
            // The filter will fail it, moving it to the removed set. The function must not create a duplicate.
            const changeSet = {
                added: [item1, item2], // item2 is inactive
                updated: [],
                ...(type === 'removed' ? { removed: [item2] } : { removed_keys: [item2.id] }),
            };

            const result = constrainChangeSetToFilter(filterActive, changeSet, pk);

            expect(result.added).toEqual([item1]);
            
            if ('removed' in result) {
                // The map will just overwrite the key, so the count remains 1.
                expect(result.removed).toHaveLength(1);
                expect(result.removed[0]!.id).toBe(2);
            } else {
                // The set will handle de-duplication.
                expect(result.removed_keys).toHaveLength(1);
                expect(result.removed_keys[0]).toBe(2);
            }
        });
    });

    describe('Edge Cases', () => {
        testBothChangeSetTypes('should handle an empty ChangeSet correctly', (type) => {
            const changeSet = {
                added: [],
                updated: [],
                ...(type === 'removed' ? { removed: [] } : { removed_keys: [] }),
            };
            const result = constrainChangeSetToFilter(filterCategoryA, changeSet, pk);
            expect(result).toBe(changeSet); // No changes, should return the same object
            expect(result).toEqual({ added: [], updated: [], ...(type === 'removed' ? { removed: [] } : { removed_keys: [] }) });
        });
        
        testBothChangeSetTypes('should handle a ChangeSet with only removed items', (type) => {
            const changeSet = {
                added: [],
                updated: [],
                ...(type === 'removed' ? { removed: [item1] } : { removed_keys: [item1.id] }),
            };
            const result = constrainChangeSetToFilter(filterCategoryA, changeSet, pk);
            expect(result).toBe(changeSet);
        });

        testBothChangeSetTypes('should handle a complex filter correctly', (type) => {
             const changeSet = {
                added: [item1, item3], // item1 (val 10) fails, item3 (val 30) passes
                updated: [item2, item4], // item2 (val 20) fails, item4 (val 40) passes
                ...(type === 'removed' ? { removed: [] } : { removed_keys: [] }),
            };

            const result = constrainChangeSetToFilter(filterValueGt25, changeSet, pk);

            expect(result.added).toEqual([item3]);
            expect(result.updated).toEqual([item4]);
            
            if ('removed' in result) {
                expect(result.removed).toEqual(expect.arrayContaining([item1, item2]));
            } else {
                expect(result.removed_keys).toEqual(expect.arrayContaining([1, 2]));
            }
        });
    });
});
