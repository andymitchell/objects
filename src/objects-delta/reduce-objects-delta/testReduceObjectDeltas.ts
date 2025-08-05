// reduceObjectDeltas.test.ts

import { describe, it, expect } from 'vitest';
import type { ObjectsDelta, ObjectsDeltaApplicable } from '../types.ts';
import { type PrimaryKeyValue, type PrimaryKeyGetter, makePrimaryKeyGetter } from '../../utils/getKeyValue.ts';



/**
 * A sample object type for testing.
 */
interface TestObject {
    id: PrimaryKeyValue;
    value: string;
    version: number;
}
const pk: PrimaryKeyGetter<TestObject> = makePrimaryKeyGetter<TestObject>('id');


/**
 * The function signature of the implementation to be tested.
 */
interface ReduceFn {
    <T extends Record<string, any>>(
        deltas: ObjectsDelta<T>[],
        pk: PrimaryKeyGetter<T>
    ): ObjectsDelta<T>;

    <T extends Record<string, any>>(
        deltas: ObjectsDeltaApplicable<T>[],
        pk: PrimaryKeyGetter<T>
    ): ObjectsDeltaApplicable<T>;

    <T extends Record<string, any>>(
        deltas: (ObjectsDelta<T> | ObjectsDeltaApplicable<T>)[],
        pk: PrimaryKeyGetter<T>
    ): ObjectsDelta<T> | ObjectsDeltaApplicable<T>;
}



/**
 * A reusable test suite for any `reduceObjectsDeltas` function.
 * 
 * @param reduceObjectsDeltas The specific implementation of the reduceObjectsDeltas function to be tested.
 */
export function testReduceObjectDeltas(reduceObjectsDeltas: ReduceFn) {
    // --- Test Data ---
    const obj1: TestObject = { id: 1, value: 'A', version: 1 };
    const obj1_updated: TestObject = { id: 1, value: 'A-updated', version: 2 };
    const obj1_final: TestObject = { id: 1, value: 'A-final', version: 3 };
    const obj2: TestObject = { id: 2, value: 'B', version: 1 };
    const obj2_updated: TestObject = { id: 2, value: 'B-updated', version: 2 };
    const obj3: TestObject = { id: 3, value: 'C', version: 1 };


    describe(' Edge Cases and Invalid Inputs', () => {
        it('should return an empty result with a recent timestamp for an empty array', () => {
            const result = reduceObjectsDeltas([], pk);
            expect(result).toHaveProperty('created_at');
            expect(typeof result.created_at).toBe('number');
            expect(result.created_at).toBeGreaterThan(Date.now() - 1000);
            // Check that other properties are not present for an empty applicable delta
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
            expect(result).not.toHaveProperty('remove_keys');
            expect(result).not.toHaveProperty('upsert');
        });

        it('should handle null or undefined input by returning an empty result', () => {
            // @ts-expect-error Testing invalid input
            const nullResult = reduceObjectsDeltas(null, pk);
            expect(nullResult.created_at).toBeGreaterThan(0);

            // @ts-expect-error Testing invalid input
            const undefinedResult = reduceObjectsDeltas(undefined, pk);
            expect(undefinedResult.created_at).toBeGreaterThan(0);
        });

        it('should handle deltas with empty or missing arrays gracefully', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, insert: [], remove_keys: [] },
                { created_at: 200, update: [obj1] },
                { created_at: 300 } // Completely empty delta
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result).toEqual({
                update: [obj1],
                created_at: 300
            });
        });
    });

    describe(' Input and Output Types', () => {
        it('should return a fully-formed ObjectsDelta when input is only ObjectsDelta[]', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { insert: [obj1], update: [], remove_keys: [], created_at: 100 }
            ];
            const result = reduceObjectsDeltas(deltas, pk);

            // Check for ObjectsDelta structure
            expect(result).toHaveProperty('insert');
            expect(result).toHaveProperty('update');
            expect(result).toHaveProperty('remove_keys');
            expect(result).not.toHaveProperty('upsert');
            expect(result).toEqual({
                insert: [obj1],
                update: [],
                remove_keys: [],
                created_at: 100
            });
        });

        it('should return an ObjectsDeltaApplicable when input is only ObjectsDeltaApplicable[]', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { upsert: [obj1], created_at: 100 }
            ];
            const result = reduceObjectsDeltas(deltas, pk);

            // Check for ObjectsDeltaApplicable structure (omits empty fields)
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
            expect(result).not.toHaveProperty('remove_keys');
            expect(result).toHaveProperty('upsert');
            expect(result).toEqual({
                upsert: [obj1],
                created_at: 100
            });
        });

        it('should return an ObjectsDeltaApplicable when input is a mix of types', () => {
            const deltas: (ObjectsDelta<TestObject> | ObjectsDeltaApplicable<TestObject>)[] = [
                { insert: [obj1], update: [], remove_keys: [], created_at: 100 }, // ObjectsDelta
                { remove_keys: [pk(obj1)], created_at: 200 } // ObjectsDeltaApplicable
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result).toEqual({
                remove_keys: [pk(obj1)],
                created_at: 200
            });
            // Should be applicable type, not have empty arrays
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
        });
    });

    describe(' Single Delta Processing and Validation', () => {
        it('should throw an error if a key is in insert and remove_keys in the same delta', () => {
            const delta: ObjectsDelta<TestObject> = {
                created_at: 100,
                insert: [obj1],
                update: [],
                remove_keys: [pk(obj1)]
            };
            expect(() => reduceObjectsDeltas([delta], pk)).toThrow(
                `Unresolvable conflict in delta created at 100: Key ${pk(obj1)} is present in both a modification list (insert/update/upsert) and remove_keys.`
            );
        });

        it('should throw an error if a key is in insert and remove_keys in the same delta, if multiple deltas', () => {
            const delta: ObjectsDelta<TestObject> = {
                created_at: 100,
                insert: [obj1],
                update: [],
                remove_keys: [pk(obj1)]
            };
            const delta2: ObjectsDeltaApplicable<TestObject> = {
                created_at: 100
            };
            expect(() => reduceObjectsDeltas([delta, delta2], pk)).toThrow(
                `Unresolvable conflict in delta created at 100: Key ${pk(obj1)} is present in both a modification list (insert/update/upsert) and remove_keys.`
            );
        });

        it('should throw an error if a key is in update and remove_keys in the same delta', () => {
            const delta: ObjectsDelta<TestObject> = {
                created_at: 100,
                insert: [],
                update: [obj1],
                remove_keys: [pk(obj1)]
            };
            expect(() => reduceObjectsDeltas([delta], pk)).toThrow(/Unresolvable conflict/);
        });

        it('should throw an error if a key is in upsert and remove_keys in the same delta', () => {
            const delta: ObjectsDeltaApplicable<TestObject> = {
                created_at: 100,
                upsert: [obj1],
                remove_keys: [pk(obj1)]
            };
            expect(() => reduceObjectsDeltas([delta], pk)).toThrow(/Unresolvable conflict/);
        });


        it('should return a copy of a single ObjectsDeltaApplicable without normalization', () => {
            const delta: ObjectsDeltaApplicable<TestObject> = {
                created_at: 100,
                insert: [obj1],
                // Missing other fields
            };
            const result = reduceObjectsDeltas([delta], pk);
            expect(result).toEqual({
                created_at: 100,
                insert: [obj1]
            });
            expect(result).not.toHaveProperty('update');
            expect(result).not.toHaveProperty('remove_keys');
        });
    });


    describe(' Chronological Order and Timestamp Sorting', () => {
        it('should apply deltas in ascending order of created_at, regardless of input order', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { created_at: 200, update: [obj1_updated], insert: [], remove_keys: [] },
                { created_at: 100, insert: [obj1], update: [], remove_keys: [] },
                { created_at: 300, remove_keys: [pk(obj1)], insert: [], update: [] },
            ];

            const result = reduceObjectsDeltas(deltas, pk);
            // The final state should be a removal, as it's the last operation chronologically.
            expect(result.remove_keys).toEqual([pk(obj1)]);
            expect(result.insert).toEqual([]);
            expect(result.update).toEqual([]);
            expect(result.created_at).toBe(300);
        });

        it('should correctly sort mixed numeric and composite string timestamps', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: '100##002', update: [obj1_updated] }, // 3rd
                { created_at: 100, insert: [obj1] }, // 1st
                { created_at: '100##001', upsert: [obj1_final] } // This is actually 2nd, the other update will be 3rd
            ];

            const result = reduceObjectsDeltas(deltas, pk);
            // The `update` at '100##002' is the last write, so it should win.
            // insert(100) -> upsert(100##001) -> update(100##002)
            // `upsert` clears insert. then `update` is applied.
            // Final consolidation will not combine upsert and update.
            // This test exposes the potential bug mentioned earlier.
            // Expected "Last Write Wins" behavior:
            expect(result).toEqual({
                upsert: [obj1_updated], // The update should have modified the upsert state
                created_at: '100##002'
            });
        });
    });

    describe(' Core Reduction Logic (Pure ObjectsDelta Inputs)', () => {
        it('Insert -> Update should result in a final insert with the updated object', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { created_at: 100, insert: [obj1], update: [], remove_keys: [] },
                { created_at: 200, update: [obj1_updated], insert: [], remove_keys: [] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.insert).toEqual([obj1_updated]);
            expect(result.remove_keys).toEqual([]);
        });

        it('Insert -> Remove should result in only a remove_key', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { created_at: 100, insert: [obj1], update: [], remove_keys: [] },
                { created_at: 200, remove_keys: [pk(obj1)], insert: [], update: [] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.insert).toEqual([]);
            expect(result.update).toEqual([]);
            expect(result.remove_keys).toEqual([pk(obj1)]);
        });

        it('Remove -> Insert should result in a final insert (resurrection)', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { created_at: 100, remove_keys: [pk(obj1)], insert: [], update: [] },
                { created_at: 200, insert: [obj1_updated], update: [], remove_keys: [] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.insert).toEqual([obj1_updated]);
            expect(result.update).toEqual([]);
            expect(result.remove_keys).toEqual([]);
        });

        it('Update -> Remove should result in a final remove_key', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { created_at: 100, update: [obj1], insert: [], remove_keys: [] },
                { created_at: 200, remove_keys: [pk(obj1)], insert: [], update: [] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.insert).toEqual([]);
            expect(result.update).toEqual([]);
            expect(result.remove_keys).toEqual([pk(obj1)]);
        });

        it('should handle multiple items with mixed operations correctly', () => {
            const deltas: ObjectsDelta<TestObject>[] = [
                { created_at: 100, insert: [obj1, obj2], update: [], remove_keys: [] }, // insert 1, 2
                { created_at: 200, update: [obj1_updated], insert: [], remove_keys: [pk(obj2)] }, // update 1, remove 2
                { created_at: 300, insert: [obj2_updated, obj3], update: [], remove_keys: [] }, // re-insert 2, insert 3
                { created_at: 400, update: [obj1_final], insert: [], remove_keys: [pk(obj3)] }, // update 1, remove 3
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            // obj1: insert -> update -> update => final update
            // obj2: insert -> remove -> insert => final insert
            // obj3: insert -> remove => final remove
            expect(result.insert).toEqual([obj1_final, obj2_updated]);
            expect(result.remove_keys).toEqual([pk(obj3)]);
        });
    });

    describe(' Core Reduction Logic (ObjectsDeltaApplicable and Mixed Inputs)', () => {
        it('Insert -> Update should be consolidated into a single upsert', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, insert: [obj1] },
                { created_at: 200, update: [obj1_updated] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.upsert).toEqual([obj1_updated]);
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
        });

        it('Remove -> Upsert should result in a final upsert (resurrection)', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, remove_keys: [pk(obj1)] },
                { created_at: 200, upsert: [obj1_updated] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.upsert).toEqual([obj1_updated]);
            expect(result).not.toHaveProperty('remove_keys');
        });

        it('Remove -> Update should be a no-op, resulting in just a removal', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, remove_keys: [pk(obj1)] },
                { created_at: 200, update: [obj1_updated] }, // update on removed item is a no-op
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.remove_keys).toEqual([pk(obj1)]);
            expect(result).not.toHaveProperty('update');
        });

        it('Remove -> Insert should result in a final insert', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, remove_keys: [pk(obj1)] },
                { created_at: 200, insert: [obj1_updated] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.insert).toEqual([obj1_updated]);
            expect(result).not.toHaveProperty('remove_keys');
        });

        it('Upsert -> Remove should result in a final removal', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, upsert: [obj1] },
                { created_at: 200, remove_keys: [pk(obj1)] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result.remove_keys).toEqual([pk(obj1)]);
            expect(result).not.toHaveProperty('upsert');
        });

        it('Upsert -> Update should result in a final upsert with the latest data (Last Write Wins)', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, upsert: [obj1] },
                { created_at: 200, update: [obj1_updated] }
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            // This test is based on the "last write wins" principle.
            // An update following an upsert should modify the final state.
            // The current implementation may fail this test and produce both an `upsert` and `update` field.
            expect(result.upsert).toEqual([obj1_updated]);
            expect(result).not.toHaveProperty('update');
            expect(result.created_at).toBe(200);
        });

        it('Update -> Upsert should result in a final upsert with the latest data', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, update: [obj1] },
                { created_at: 200, upsert: [obj1_updated] }
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            // The upsert should correctly overwrite the previous update.
            expect(result.upsert).toEqual([obj1_updated]);
            expect(result).not.toHaveProperty('update');
            expect(result.created_at).toBe(200);
        });

        it('should correctly reduce a complex chain of mixed operations', () => {
             const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, insert: [obj1] }, // 1: insert
                { created_at: 200, insert: [obj2] }, // 2: insert
                { created_at: 300, update: [obj1_updated] }, // 1: insert+update -> upsert
                { created_at: 400, remove_keys: [pk(obj2)] }, // 2: insert -> remove
                { created_at: 500, upsert: [obj3] }, // 3: upsert
                { created_at: 600, upsert: [obj1_final] } // 1: upsert -> upsert
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            // Item 1: insert -> update -> upsert. Final state is upsert(obj1_final)
            // Item 2: insert -> remove. Final state is remove(2)
            // Item 3: upsert. Final state is upsert(obj3)
            expect(result.upsert).toHaveLength(2);
            expect(result.upsert).toEqual(expect.arrayContaining([obj1_final, obj3]));
            expect(result.remove_keys).toEqual([pk(obj2)]);
            expect(result).not.toHaveProperty('insert');
            expect(result).not.toHaveProperty('update');
        });

        it('should omit empty fields from the final ObjectsDeltaApplicable result', () => {
            const deltas: ObjectsDeltaApplicable<TestObject>[] = [
                { created_at: 100, insert: [obj1] },
                { created_at: 200, remove_keys: [pk(obj1)] },
            ];
            const result = reduceObjectsDeltas(deltas, pk);
            expect(result).toEqual({
                remove_keys: [pk(obj1)],
                created_at: 200
            });
            expect(Object.keys(result)).toHaveLength(2); // Only remove_keys and created_at
        });
    });
}
