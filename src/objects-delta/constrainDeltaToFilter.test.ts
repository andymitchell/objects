
import type { PrimaryKeyGetter } from "../utils/getKeyValue.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import { constrainDeltaToFilter } from "./constrainDeltaToFilter.ts";
import type { ObjectsDelta, ObjectsDeltaApplicable } from "./types.ts";


describe('constrainDeltaToFilter', () => {

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

    describe('using ObjectsDelta', () => {


        describe('Core filtering behavior', () => {
            it('should handle when items from `insert` and `update` are filtered out', () => {
                const changeSet: ObjectsDelta<Item> = {
                    insert: [item1, item2], // item2 is inactive, should be removed
                    update: [item3, item4], // item4 is inactive, should be removed
                    remove_keys: [item5.id],
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterActive, changeSet, pk);

                expect(result.insert).toEqual([item1]);
                expect(result.update).toEqual([item3]);
                expect(result.remove_keys).toHaveLength(3);
                expect(result.remove_keys).toEqual(expect.arrayContaining([5, 2, 4]));
            });

            it('should handle when a filter removes all `insert` and `update` items', () => {
                const changeSet: ObjectsDelta<Item> = {
                    insert: [item2, item4], // Both inactive
                    update: [],
                    remove_keys: [],
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterActive, changeSet, pk);

                expect(result.insert).toEqual([]);
                expect(result.update).toEqual([]);
                expect(result.remove_keys).toEqual(expect.arrayContaining([2, 4]));
            });
        });

        describe('Referential equality', () => {
            it('should return the original ObjectsDelta object if no changes are made', () => {
                const changeSet: ObjectsDelta<Item> = {
                    insert: [item1, item3], // All active
                    update: [item5], // All active
                    remove_keys: [],
                    created_at: Date.now()
                };
                const result = constrainDeltaToFilter(filterActive, changeSet, pk);
                expect(result).toBe(changeSet);
            });

            it('should handle should return original `update` array if only `insert` is changed', () => {
                const originalUpdated = [item3];
                const changeSet: ObjectsDelta<Item> = {
                    insert: [item1, item2], // item2 will be removed
                    update: originalUpdated,
                    remove_keys: [],
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterActive, changeSet, pk);

                expect(result.insert).toEqual([item1]); // New array
                expect(result.insert).not.toBe(changeSet.insert);
                expect(result.update).toBe(originalUpdated); // Same array reference
            });

            it('should handle should return original `insert` array if only `update` is changed', () => {
                const originalAdded = [item1];
                const changeSet: ObjectsDelta<Item> = {
                    insert: originalAdded,
                    update: [item3, item4], // item4 will be removed
                    remove_keys: [],
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterActive, changeSet, pk);

                expect(result.update).toEqual([item3]); // New array
                expect(result.update).not.toBe(changeSet.update);
                expect(result.insert).toBe(originalAdded); // Same array reference
            });
        });

        describe('De-duplication of removed items', () => {
            it('should handle should not add a duplicate if a filtered item was already in the removed list', () => {
                // item2 is in `insert` but also already in `removed`/`remove_keys`.
                // The filter will fail it, moving it to the removed set. The function must not create a duplicate.
                const changeSet: ObjectsDelta<Item> = {
                    insert: [item1, item2], // item2 is inactive
                    update: [],
                    remove_keys: [item2.id],
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterActive, changeSet, pk);

                expect(result.insert).toEqual([item1]);

                // The set will handle de-duplication.
                expect(result.remove_keys).toHaveLength(1);
                expect(result.remove_keys![0]).toBe(2);

            });
        });

        describe('Edge Cases', () => {
            it('should handle should handle an empty ObjectsDelta correctly', () => {
                const changeSet: ObjectsDelta<Item> = {
                    insert: [],
                    update: [],
                    remove_keys: [],
                    created_at: Date.now()
                };
                const result = constrainDeltaToFilter(filterCategoryA, changeSet, pk);
                expect(result).toBe(changeSet); // No changes, should return the same object
                expect(result).toEqual(changeSet);
            });

            it('should handle should handle a ObjectsDelta with only removed items', () => {
                const changeSet: ObjectsDelta<Item> = {
                    insert: [],
                    update: [],
                    remove_keys: [item1.id],
                    created_at: Date.now()
                };
                const result = constrainDeltaToFilter(filterCategoryA, changeSet, pk);
                expect(result).toEqual(changeSet);
            });

            it('should handle should handle a complex filter correctly', () => {
                const changeSet: ObjectsDelta<Item> = {
                    insert: [item1, item3], // item1 (val 10) fails, item3 (val 30) passes
                    update: [item2, item4], // item2 (val 20) fails, item4 (val 40) passes
                    remove_keys: [],
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterValueGt25, changeSet, pk);

                expect(result.insert).toEqual([item3]);
                expect(result.update).toEqual([item4]);

                expect(result.remove_keys).toEqual(expect.arrayContaining([1, 2]));

            });
        });
    })

    describe('using ObjectsDeltaApplicable', () => {
        it('should filter `upsert` items and move non-matching to remove_keys', () => {
            const delta: ObjectsDeltaApplicable<Item> = {
                upsert: [item1, item2, item3, item4], // active, inactive, active, inactive
                created_at: Date.now()
            };

            const result = constrainDeltaToFilter(filterActive, delta, pk);

            expect(result.upsert).toEqual([item1, item3]);
            expect(result.remove_keys).toEqual(expect.arrayContaining([2, 4]));
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
        });

        it('should perform a basic filtering operation like ObjectsDelta', () => {
            const delta: ObjectsDeltaApplicable<Item> = {
                insert: [item1, item2], // item2 is inactive
                update: [item3, item4], // item4 is inactive
                remove_keys: [item5.id],
                created_at: Date.now()
            };

            const result = constrainDeltaToFilter(filterActive, delta, pk);

            expect(result.insert).toEqual([item1]);
            expect(result.update).toEqual([item3]);
            expect(result.remove_keys).toHaveLength(3);
            expect(result.remove_keys).toEqual(expect.arrayContaining([5, 2, 4]));
        });

        it('should handle partially defined deltas without adding missing properties', () => {
            const delta: ObjectsDeltaApplicable<Item> = {
                update: [item3, item4], // item4 is inactive
                created_at: Date.now()
            };

            const result = constrainDeltaToFilter(filterActive, delta, pk);

            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('upsert');
            expect(result.update).toEqual([item3]);
            expect(result.remove_keys).toEqual([4]);
        });
        
        it('should add remove_keys property if items are filtered, even if not present initially', () => {
            const delta: ObjectsDeltaApplicable<Item> = {
                insert: [item1, item2], // item2 is inactive
                created_at: Date.now()
            };

            const result = constrainDeltaToFilter(filterActive, delta, pk);

            expect(result.insert).toEqual([item1]);
            expect(result.remove_keys).toEqual([2]);
            expect(delta).not.toHaveProperty('remove_keys'); 
        });


        describe('Referential equality for ObjectsDeltaApplicable', () => {
            it('should return the original object if no changes are made', () => {
                const delta: ObjectsDeltaApplicable<Item> = {
                    insert: [item1],
                    update: [item3],
                    upsert: [item5],
                    remove_keys: [],
                    created_at: Date.now()
                };
                const result = constrainDeltaToFilter(filterActive, delta, pk);
                expect(result).toBe(delta);
            });

            it('should maintain referential equality for unchanged properties', () => {
                const originalUpsert = [item5];
                const delta: ObjectsDeltaApplicable<Item> = {
                    insert: [item1, item2], // item2 is inactive and will be removed
                    update: [],
                    upsert: originalUpsert,
                    created_at: Date.now()
                };

                const result = constrainDeltaToFilter(filterActive, delta, pk);

                expect(result.insert).toEqual([item1]);
                expect(result.insert).not.toBe(delta.insert);
                expect(result.update).toBe(delta.update);
                expect(result.upsert).toBe(originalUpsert);
            });
        });

        it('should not add properties to the output that were not on the input', () => {
            const delta: ObjectsDeltaApplicable<Item> = {
                // `insert` is intentionally omitted
                update: [item3, item4], // item4 will be removed
                created_at: Date.now()
            };

            const result = constrainDeltaToFilter(filterActive, delta, pk);

            expect(result).not.toHaveProperty('insert');
            expect(result.update).toEqual([item3]);
            expect(result.remove_keys).toEqual([4]);
        });

        it('should correctly filter a delta with only an upsert property', () => {
            const delta: ObjectsDeltaApplicable<Item> = {
                upsert: [item1, item2, item3],
                created_at: Date.now()
            };
            
            const result = constrainDeltaToFilter(filterActive, delta, pk);
            
            expect(result.upsert).toEqual([item1, item3]);
            expect(result.remove_keys).toEqual([2]);
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
        });
    });
});