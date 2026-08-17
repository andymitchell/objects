import { z } from "zod";
import { test, describe, expect } from 'vitest';
import { assertWriteArrayScope, getWriteFailures } from "../helpers.ts";
import type { WriteAction } from "../types.ts";
import type { DDL } from "../../ddl/types.ts";
import { produce } from "immer";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { standardTests, type AdapterFactory } from "../standardTests.ts";
import { applyDelta } from "../../objects-delta/apply-delta/applyDelta.ts";
import { makePrimaryKeyGetter } from "../../utils/getKeyValue.ts";

// ═══════════════════════════════════════════════════════════════════
// Shared fixtures for implementation-specific tests
// ═══════════════════════════════════════════════════════════════════

const ObjSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    owner: z.string().optional(),
    arr_items: z.array(z.string()).optional(),
    children: z.array(
        z.object({
            cid: z.string(),
            name: z.string().optional(),
            children: z.array(
                z.object({
                    ccid: z.string(),
                }).strict()
            ),
        }).strict()
    ).optional(),
}).strict();

type Obj = z.infer<typeof ObjSchema>;

const ddl: DDL<Obj> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'children': { primary_key: 'cid' },
        'children.children': { primary_key: 'ccid' },
    },
};

const obj1: Obj = { id: '1' };
const obj2: Obj = { id: '2' };

// ═══════════════════════════════════════════════════════════════════
// Adapter factory for standardTests
// ═══════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod v3/v4 generic variance mismatch
const createAdapter: AdapterFactory = <T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>) => ({
    apply: async ({ initialItems, writeActions, options, schema: configSchema, ddl: configDdl }) => {
        const items = structuredClone(initialItems);
        const result = writeToItemsArray(writeActions, items, configSchema, configDdl, {
            atomic: options?.atomic,
            attempt_recover_duplicate_create: options?.attempt_recover_duplicate_create,
        });
        return {
            result,
            changes: result.changes,
            finalItems: result.changes.final_items,
        };
    }
});

// ═══════════════════════════════════════════════════════════════════
// Standard tests
// ═══════════════════════════════════════════════════════════════════

describe('writeToItemsArray', () => {

    describe('standard tests', () => {
        // This honest reference adapter produces invalid_filter outcomes (rather than throwing), so it opts
        // into the deliberately-invalid where corpus (§9 + fuzz P10 where-variant). The validate-where-sync
        // consumer must NOT set this — it throws on any invalid_filter.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest global vs import type mismatch
        standardTests({ test: test as any, expect: expect as any, createAdapter, implementationName: 'writeToItemsArray', capabilities: { invalidWhereCorpus: true }, pinReferenceDefects: true });
    });

    // ═══════════════════════════════════════════════════════════════
    // Implementation-specific tests
    // ═══════════════════════════════════════════════════════════════

    describe('implementation-specific', () => {

        // ───────────────────────────────────────────────────────────
        // 1. Execution Modes
        // ───────────────────────────────────────────────────────────

        describe('1. Execution Modes', () => {

            describe('1.1 Immutable mode (default)', () => {

                test('returns new array reference', () => {
                    const items = [structuredClone(obj1)];
                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '2' } } }],
                        items, ObjSchema, ddl,
                    );
                    expect(result.changes.final_items).not.toBe(items);
                });

                test('original items array is unmodified', () => {
                    const items = [structuredClone(obj1)];
                    const originalLength = items.length;
                    writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '2' } } }],
                        items, ObjSchema, ddl,
                    );
                    expect(items.length).toBe(originalLength);
                });

                test('unchanged items keep same reference', () => {
                    const item1 = structuredClone(obj1);
                    const item2 = structuredClone(obj2);
                    const items = [item1, item2];
                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'new' }, where: { id: '2' } } }],
                        items, ObjSchema, ddl,
                    );
                    expect(result.changes.final_items[0]).toBe(item1); // unchanged
                });

                test('changed items get new reference', () => {
                    const item1 = structuredClone(obj1);
                    const items = [item1];
                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'new' }, where: { id: '1' } } }],
                        items, ObjSchema, ddl,
                    );
                    expect(result.changes.final_items[0]).not.toBe(item1);
                    expect(result.changes.final_items[0]!.text).toBe('new');
                });
            });

            describe('1.2 Mutable mode (mutate: true)', () => {

                test('returns same array reference', () => {
                    const items = [structuredClone(obj1)];
                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '2' } } }],
                        items, ObjSchema, ddl, { mutate: true },
                    );
                    expect(result.changes.final_items).toBe(items);
                });

                test('items are mutated in-place', () => {
                    const item1 = structuredClone(obj1);
                    const items = [item1];
                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'new' }, where: { id: '1' } } }],
                        items, ObjSchema, ddl, { mutate: true },
                    );
                    expect(result.changes.final_items[0]).toBe(item1);
                    expect(item1.text).toBe('new');
                });
            });

            describe('1.3 Immer compatibility (mutate: true inside produce)', () => {

                test('works inside immer produce', () => {
                    const items: Obj[] = [structuredClone(obj1)];
                    const finalItems = produce(items, draft => {
                        writeToItemsArray(
                            [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'immer' }, where: { id: '1' } } }],
                            draft as Obj[], ObjSchema, ddl, { mutate: true },
                        );
                    });
                    expect(finalItems[0]!.text).toBe('immer');
                    expect(finalItems).not.toBe(items); // immer returns new reference
                });

                test('throws if mutate:false with Immer draft', () => {
                    const items: Obj[] = [structuredClone(obj1)];
                    expect(() => produce(items, draft => {
                        writeToItemsArray(
                            [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '2' } } }],
                            draft as Obj[], ObjSchema, ddl, { mutate: false },
                        );
                    })).toThrow('When using Immer drafts you need to use mutate.');
                });
            });
        });

        // ───────────────────────────────────────────────────────────
        // 2. Referential Stability
        // ───────────────────────────────────────────────────────────

        describe('2. Referential Stability (React-friendly shallow comparison)', () => {

            test('mixed success/fail non-atomic: only affected items get new references', () => {
                const item1 = structuredClone(obj1);
                const item2 = structuredClone(obj2);
                const items = [item1, item2];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'changed' }, where: { id: '2' } } },
                        { type: 'write', ts: 0, uuid: '1', payload: { type: 'create', data: { id: '3' } } },
                    ],
                    items, ObjSchema, ddl,
                );
                expect(result.ok).toBe(true);
                expect(result.changes.final_items[0]).toBe(item1); // unchanged
                expect(result.changes.final_items[1]).not.toBe(item2); // changed
            });

            test('no-op batch: all references preserved', () => {
                const item1 = structuredClone(obj1);
                const items = [item1];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'x' }, where: { id: 'nonexistent' } } }],
                    items, ObjSchema, ddl,
                );
                expect(result.changes.final_items).toBe(items);
                expect(result.changes.final_items[0]).toBe(item1);
            });

            test('atomic rollback: original array reference preserved', () => {
                const item1 = structuredClone(obj1);
                const items = [item1];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '2' } } },
                        // @ts-expect-error: wilfully breaking schema
                        { type: 'write', ts: 0, uuid: '1', payload: { type: 'update', data: { none_key: 'bad' }, where: { id: '1' } } },
                    ],
                    items, ObjSchema, ddl, { atomic: true },
                );
                expect(result.ok).toBe(false);
                expect(result.changes.final_items).toBe(items);
                expect(result.changes.final_items[0]).toBe(item1);
            });

            test('atomic rollback on array_scope: original references preserved', () => {
                const originalItems: Obj[] = [{ id: '1', children: [{ cid: 'c1', children: [] }] }];
                const obj1Ref = originalItems[0];
                const result = writeToItemsArray(
                    [
                        {
                            type: 'write', ts: 0, uuid: '0', payload: assertWriteArrayScope<Obj, 'children'>({
                                type: 'array_scope', scope: 'children',
                                action: { type: 'update', data: { name: 'Bob' }, where: { cid: 'c1' } },
                                where: { id: '1' },
                            })
                        },
                        // @ts-expect-error: wilfully breaking schema
                        { type: 'write', ts: 0, uuid: '1', payload: { type: 'update', data: { none_key: 'bad' }, where: { id: '1' } } },
                    ],
                    originalItems, ObjSchema, ddl, { atomic: true },
                );
                expect(result.ok).toBe(false);
                expect(result.changes.final_items).toBe(originalItems);
                expect(result.changes.final_items[0]).toBe(obj1Ref);
            });

            test('Immer produces correct referential stability after produce', () => {
                const items: Obj[] = [{ id: '1' }, { id: '2' }];
                const finalItems = produce(items, draft => {
                    writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'changed' }, where: { id: '2' } } }],
                        draft as Obj[], ObjSchema, ddl, { mutate: true },
                    );
                });
                // Immer gives new top-level reference
                expect(finalItems).not.toBe(items);
                // Unchanged item keeps identity (Immer optimisation)
                expect(finalItems[0]).toBe(items[0]);
                // Changed item gets new reference
                expect(finalItems[1]).not.toBe(items[1]);
                expect(finalItems[1]!.text).toBe('changed');
            });
        });

        // ───────────────────────────────────────────────────────────
        // 3. WriteToItemsArrayResult extras
        // ───────────────────────────────────────────────────────────

        describe('3. WriteToItemsArrayResult extras', () => {

            test('changes.final_items present and correct', () => {
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '1', text: 'hello' } } },
                    ],
                    [], ObjSchema, ddl,
                );
                expect(result.changes.final_items).toBeDefined();
                expect(result.changes.final_items).toHaveLength(1);
                expect(result.changes.final_items[0]!.text).toBe('hello');
            });

            test('changes.created_at is a timestamp', () => {
                const before = Date.now();
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: '1' } } }],
                    [], ObjSchema, ddl,
                );
                const after = Date.now();
                expect(result.changes.created_at).toBeGreaterThanOrEqual(before);
                expect(result.changes.created_at).toBeLessThanOrEqual(after);
            });
        });

        // ───────────────────────────────────────────────────────────
        // 4. WriteStrategy mutation contract
        // ───────────────────────────────────────────────────────────

        describe('4. WriteStrategy mutation contract', () => {

            test('update_handler mutates target in-place (mutable mode)', () => {
                const item: Obj = { id: '1', text: 'original' };
                const items: Obj[] = [item];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'changed' }, where: { id: '1' } } }],
                    items, ObjSchema, ddl, { mutate: true },
                );
                // In mutable mode, the original object should be mutated in-place
                expect(item.text).toBe('changed');
                expect(result.changes.final_items[0]).toBe(item);
            });

            test('update_handler mutates cloned target (immutable mode)', () => {
                const item: Obj = { id: '1', text: 'original' };
                const items: Obj[] = [item];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'changed' }, where: { id: '1' } } }],
                    items, ObjSchema, ddl,
                );
                // Original untouched — mutation happened on a clone
                expect(item.text).toBe('original');
                // The clone was mutated and is now in final_items
                expect(result.changes.final_items[0]!.text).toBe('changed');
                expect(result.changes.final_items[0]).not.toBe(item);
            });
        });

        // ───────────────────────────────────────────────────────────
        // 5. Regression: Immer-specific edge cases
        // ───────────────────────────────────────────────────────────

        // ───────────────────────────────────────────────────────────
        // 5b. Mutation-specific referential & immutability checks
        // ───────────────────────────────────────────────────────────

        describe('5b. Mutation referential stability & immutability', () => {

            test('push: original array not mutated (immutable mode)', () => {
                const item: Obj = { id: '1', arr_items: ['a', 'b'] };
                const originalArrRef = item.arr_items;
                const items = [item];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'push', path: 'arr_items', items: ['c'], where: { id: '1' } } }],
                    items, ObjSchema, ddl,
                );
                expect(result.ok).toBe(true);
                // Original item's array should be untouched
                expect(item.arr_items).toBe(originalArrRef);
                expect(item.arr_items).toEqual(['a', 'b']);
                // Result should have the new array
                expect(result.changes.final_items[0]!.arr_items).toEqual(['a', 'b', 'c']);
            });

            test('push with empty items: referential stability (no change)', () => {
                const item: Obj = { id: '1', arr_items: ['a'] };
                const items = [item];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'push', path: 'arr_items', items: [], where: { id: '1' } } }],
                    items, ObjSchema, ddl,
                );
                expect(result.ok).toBe(true);
                // Since nothing changed, the item reference should be preserved
                expect(result.changes.final_items[0]).toBe(item);
            });

            test('inc: original item not mutated (immutable mode)', () => {
                const ObjWithCountSchema = z.object({
                    id: z.string(),
                    count: z.number().optional(),
                }).strict();
                type ObjWithCount = z.infer<typeof ObjWithCountSchema>;
                const ddlCount: DDL<ObjWithCount> = {
                    version: 1,
                    lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
                };

                const item: ObjWithCount = { id: '1', count: 10 };
                const items = [item];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'inc', path: 'count', amount: 5, where: { id: '1' } } }],
                    items, ObjWithCountSchema, ddlCount,
                );
                expect(result.ok).toBe(true);
                expect(item.count).toBe(10); // untouched
                expect(result.changes.final_items[0]!.count).toBe(15);
            });

            test('Immer compatibility: push inside produce', () => {
                const items: Obj[] = [{ id: '1', arr_items: ['a'] }];
                const finalItems = produce(items, draft => {
                    writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'push', path: 'arr_items', items: ['b'], where: { id: '1' } } }],
                        draft as Obj[], ObjSchema, ddl, { mutate: true },
                    );
                });
                expect(finalItems[0]!.arr_items).toEqual(['a', 'b']);
                expect(finalItems).not.toBe(items);
            });
        });

        describe('5. Immer-specific edge cases', () => {

            test('Immer flags objects even if no material change', () => {
                const originalItems = [{ id: 1, text: 'Bob' }, { id: 2, text: '' }];
                const finalItems = produce(originalItems, () => {
                    // no-op
                });
                expect(finalItems).toBe(originalItems);

                const flaggedItems = produce(originalItems, draft => {
                    draft[1]!.text = 'Alice';
                    draft[1]!.text = ''; // Restore
                });
                expect(flaggedItems).not.toBe(originalItems);
            });

            test('atomic + Immer: rollback restores original references', () => {
                const items: Obj[] = [{ id: '1', children: [{ cid: 'c1', children: [] }] }];
                const finalItems = produce(items, draft => {
                    const result = writeToItemsArray(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: assertWriteArrayScope<Obj, 'children'>({
                                    type: 'array_scope', scope: 'children',
                                    action: { type: 'update', data: { name: 'Bob' }, where: { cid: 'c1' } },
                                    where: { id: '1' },
                                })
                            },
                            {
                                type: 'write', ts: 0, uuid: '1', payload: {
                                    type: 'array_scope', scope: 'children',
                                    action: {
                                        type: 'create',
                                        // @ts-expect-error: probing the runtime's response to a scoped create carrying a field the element schema does not declare
                                        data: { bad_key: 'fail' },
                                    },
                                    where: { id: '1' },
                                }
                            },
                        ],
                        draft as Obj[], ObjSchema, ddl, { atomic: true, mutate: true },
                    );
                    expect(result.ok).toBe(false);
                });
                // Immer should not have changed anything since atomic rolled back
                expect(finalItems[0]!.children![0]!.name).toBeUndefined();
            });
        });

        // ───────────────────────────────────────────────────────────
        // 6. Same-batch delete + recreate reconciliation
        // ───────────────────────────────────────────────────────────

        // A batch reports its NET effect on the original items: a primary key appears in at most one of
        // insert / update / remove_keys, `insert` only ever holds keys absent from the original items, and
        // `remove_keys` only ever holds keys present in them. Deleting and re-creating a pre-existing key in
        // one batch is therefore a whole-row replacement (an update), and creating then deleting a brand-new
        // key nets to nothing at all.

        describe('6. Same-batch delete + recreate reconciliation', () => {

            const pkOf = makePrimaryKeyGetter<Obj>('id');
            const idsOf = (items: Obj[]): string[] => items.map(x => x.id);

            test('delete then recreate a pre-existing key yields one clean row, reported as an update', () => {
                const items: Obj[] = [{ id: 'c', text: 'orig', owner: 'ann' }, { id: 'd', text: 'dee' }];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'delete', where: { id: 'c' } } },
                        { type: 'write', ts: 1, uuid: '1', payload: { type: 'create', data: { id: 'c', text: 'new' } } },
                    ],
                    items, ObjSchema, ddl,
                );

                expect(result.ok).toBe(true);
                // One row per key, holding exactly the re-created data — no field of the deleted row survives.
                expect(idsOf(result.changes.final_items)).toEqual(['c', 'd']);
                expect(result.changes.final_items[0]).toEqual({ id: 'c', text: 'new' });

                expect(idsOf(result.changes.update)).toEqual(['c']);
                expect(result.changes.insert).toEqual([]);
                expect(result.changes.remove_keys).toEqual([]);
                expect(result.changes.changed).toBe(true);
            });

            test('delete then recreate then mutate the same key leaves no stale fields', () => {
                const items: Obj[] = [{ id: '1', text: 'orig', owner: 'ann', arr_items: ['old'] }];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'delete', where: { id: '1' } } },
                        { type: 'write', ts: 1, uuid: '1', payload: { type: 'create', data: { id: '1', text: 'new' } } },
                        { type: 'write', ts: 2, uuid: '2', payload: { type: 'update', data: { owner: 'bob' }, where: { id: '1' } } },
                    ],
                    items, ObjSchema, ddl,
                );

                expect(result.ok).toBe(true);
                expect(result.changes.final_items).toEqual([{ id: '1', text: 'new', owner: 'bob' }]);

                expect(idsOf(result.changes.update)).toEqual(['1']);
                expect(result.changes.insert).toEqual([]);
                expect(result.changes.remove_keys).toEqual([]);
            });

            test('create then delete a brand-new key reports no insert and no removal', () => {
                const items: Obj[] = [{ id: 'keep', text: 'kept' }];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'create', data: { id: 'x', text: 'ephemeral' } } },
                        { type: 'write', ts: 1, uuid: '1', payload: { type: 'delete', where: { id: 'x' } } },
                    ],
                    items, ObjSchema, ddl,
                );

                expect(result.ok).toBe(true);
                // 'x' never existed in the original items, so removing it is not a change the caller can apply.
                expect(result.changes.remove_keys).toEqual([]);
                expect(result.changes.insert).toEqual([]);
                expect(result.changes.update).toEqual([]);
                expect(result.changes.changed).toBe(false);
                expect(idsOf(result.changes.final_items)).toEqual(['keep']);
            });

            test('delete then recreate then delete a pre-existing key nets to a removal', () => {
                const items: Obj[] = [{ id: '1', text: 'orig' }, { id: '2', text: 'two' }];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'delete', where: { id: '1' } } },
                        { type: 'write', ts: 1, uuid: '1', payload: { type: 'create', data: { id: '1', text: 'new' } } },
                        { type: 'write', ts: 2, uuid: '2', payload: { type: 'delete', where: { id: '1' } } },
                    ],
                    items, ObjSchema, ddl,
                );

                expect(result.ok).toBe(true);
                expect(result.changes.remove_keys).toEqual(['1']);
                expect(result.changes.insert).toEqual([]);
                expect(result.changes.update).toEqual([]);
                expect(idsOf(result.changes.final_items)).toEqual(['2']);
            });

            test('the change lists are key-disjoint, so replaying them onto the original items rebuilds final_items', () => {
                const items: Obj[] = [{ id: 'c', text: 'orig', owner: 'ann' }, { id: 'd', text: 'dee' }];
                const result = writeToItemsArray(
                    [
                        { type: 'write', ts: 0, uuid: '0', payload: { type: 'delete', where: { id: 'c' } } },
                        { type: 'write', ts: 1, uuid: '1', payload: { type: 'create', data: { id: 'c', text: 'new' } } },
                    ],
                    items, ObjSchema, ddl,
                );
                const { insert, update, remove_keys, final_items } = result.changes;

                const appearances = [...insert.map(x => pkOf(x)), ...update.map(x => pkOf(x)), ...remove_keys];
                expect(appearances).toEqual([...new Set(appearances)]);

                // A caller replaying the delta gets the same world the engine reports.
                expect(applyDelta(items, result.changes, pkOf)).toEqual(final_items);
            });
        });

        // ───────────────────────────────────────────────────────────
        // 7. Clearing and removing a property
        // ───────────────────────────────────────────────────────────
        // `set_property_undefined` leaves the key in place holding `undefined`; `delete_property` takes the
        // key away. Only an in-memory key-set test (`Object.hasOwn`, `Object.keys`) separates the two —
        // `toEqual`, `$exists` and JSON all read the states as the same thing — so every assertion about
        // presence here is written against the key set deliberately.

        describe('7. Clearing and removing a property', () => {

            /** Build a property-verb action; the payload is cast because some paths here are deliberately illegal. */
            const write = (payload: unknown, uuid = '0'): WriteAction<Obj> =>
                ({ type: 'write', ts: 0, uuid, payload: payload as WriteAction<Obj>['payload'] });

            describe('7.1 What each verb does to the item', () => {

                test('clearing a valued property keeps its key and leaves it holding undefined', () => {
                    const result = writeToItemsArray(
                        [write({ type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'hi', owner: 'ann' }], ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(true);
                    const written = result.changes.final_items[0]!;
                    expect(Object.hasOwn(written, 'text')).toBe(true);
                    expect(written.text).toBe(undefined);
                    expect(Object.keys(written)).toEqual(['id', 'text', 'owner']);
                });

                test('removing a valued property takes its key away', () => {
                    const result = writeToItemsArray(
                        [write({ type: 'delete_property', path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'hi', owner: 'ann' }], ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(true);
                    const written = result.changes.final_items[0]!;
                    expect(Object.hasOwn(written, 'text')).toBe(false);
                    expect(Object.keys(written)).toEqual(['id', 'owner']);
                });

                test('removing reaches a property that clearing has already emptied', () => {
                    const result = writeToItemsArray(
                        [
                            write({ type: 'set_property_undefined', path: 'text', where: { id: '1' } }, '0'),
                            write({ type: 'delete_property', path: 'text', where: { id: '1' } }, '1'),
                        ],
                        [{ id: '1', text: 'hi' }], ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(true);
                    expect(Object.keys(result.changes.final_items[0]!)).toEqual(['id']);
                });

                test('only the items the where matches are written to', () => {
                    const result = writeToItemsArray(
                        [write({ type: 'delete_property', path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'one' }, { id: '2', text: 'two' }], ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(true);
                    expect(Object.keys(result.changes.final_items[0]!)).toEqual(['id']);
                    expect(result.changes.final_items[1]).toEqual({ id: '2', text: 'two' });
                });

                test('a property the item does not carry is left alone by both verbs', () => {
                    for (const type of ['set_property_undefined', 'delete_property'] as const) {
                        const item: Obj = { id: '1', owner: 'ann' };
                        const items = [item];
                        const result = writeToItemsArray(
                            [write({ type, path: 'text', where: { id: '1' } })],
                            items, ObjSchema, ddl,
                        );
                        expect(result.ok).toBe(true);
                        expect(result.changes.changed).toBe(false);
                        // Nothing changed, so the item is handed back as it came in.
                        expect(result.changes.final_items[0]).toBe(item);
                        expect(Object.keys(item)).toEqual(['id', 'owner']);
                    }
                });

                test('clearing a property that is already empty is not a change, while removing it is', () => {
                    const seed = (): Obj[] => [{ id: '1', text: undefined }];

                    const cleared = writeToItemsArray(
                        [write({ type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                        seed(), ObjSchema, ddl,
                    );
                    expect(cleared.changes.changed).toBe(false);
                    expect(Object.keys(cleared.changes.final_items[0]!)).toEqual(['id', 'text']);

                    const removed = writeToItemsArray(
                        [write({ type: 'delete_property', path: 'text', where: { id: '1' } })],
                        seed(), ObjSchema, ddl,
                    );
                    expect(removed.changes.changed).toBe(true);
                    expect(Object.keys(removed.changes.final_items[0]!)).toEqual(['id']);
                });

                test.each([
                    ['set_property_undefined', ['id', 'text']],
                    ['delete_property', ['id']],
                ] as const)('applying %s twice leaves the same item as applying it once', (type, expectedKeys) => {
                    const once = writeToItemsArray(
                        [write({ type, path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'hi' }], ObjSchema, ddl,
                    );
                    const twice = writeToItemsArray(
                        [
                            write({ type, path: 'text', where: { id: '1' } }, '0'),
                            write({ type, path: 'text', where: { id: '1' } }, '1'),
                        ],
                        [{ id: '1', text: 'hi' }], ObjSchema, ddl,
                    );
                    expect(twice.ok).toBe(true);
                    // Stated outright, so the two runs cannot agree by both leaving the item alone.
                    expect(Object.keys(twice.changes.final_items[0]!)).toEqual(expectedKeys);
                    expect(twice.changes.final_items[0]!.text).toBe(undefined);

                    expect(Object.keys(twice.changes.final_items[0]!)).toEqual(Object.keys(once.changes.final_items[0]!));
                    expect(twice.changes.final_items[0]).toEqual(once.changes.final_items[0]);
                });
            });

            describe('7.2 Where the path can point', () => {

                const NestedSchema = z.object({
                    id: z.string(),
                    meta: z.object({ badge: z.string().optional(), rank: z.number() }).strict().optional(),
                    bag: z.record(z.string(), z.string().optional()),
                    'score.raw': z.number().optional(),
                }).strict();
                type Nested = z.infer<typeof NestedSchema>;
                const nestedDdl: DDL<Nested> = {
                    version: 1,
                    lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
                };
                const nestedSeed = (): Nested[] => [{ id: '1', meta: { badge: 'gold', rank: 2 }, bag: { k: 'v' }, 'score.raw': 9 }];
                const nestedWrite = (payload: unknown, uuid = '0'): WriteAction<Nested> =>
                    ({ type: 'write', ts: 0, uuid, payload: payload as WriteAction<Nested>['payload'] });

                test('a path reaching into a nested object writes there and leaves its siblings alone', () => {
                    const result = writeToItemsArray(
                        [nestedWrite({ type: 'delete_property', path: 'meta.badge', where: { id: '1' } })],
                        nestedSeed(), NestedSchema, nestedDdl,
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]!.meta).toEqual({ rank: 2 });
                });

                test('a nested write leaves the caller\'s item and the objects inside it alone', () => {
                    const meta = { badge: 'gold', rank: 2 };
                    const item: Nested = { id: '1', meta, bag: { k: 'v' } };
                    const items = [item];

                    const result = writeToItemsArray(
                        [nestedWrite({ type: 'delete_property', path: 'meta.badge', where: { id: '1' } })],
                        items, NestedSchema, nestedDdl,
                    );

                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]!.meta).toEqual({ rank: 2 });
                    // The write lands in the item being returned, never in the one the caller still holds.
                    expect(item.meta).toBe(meta);
                    expect(Object.keys(meta)).toEqual(['badge', 'rank']);
                });

                test('a path into a record container reaches one entry of it', () => {
                    const result = writeToItemsArray(
                        [nestedWrite({ type: 'delete_property', path: 'bag.k', where: { id: '1' } })],
                        nestedSeed(), NestedSchema, nestedDdl,
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]!.bag).toEqual({});
                });

                test('an escaped dot names one key holding a literal dot, not two segments', () => {
                    const result = writeToItemsArray(
                        [nestedWrite({ type: 'delete_property', path: 'score\\.raw', where: { id: '1' } })],
                        nestedSeed(), NestedSchema, nestedDdl,
                    );
                    expect(result.ok).toBe(true);
                    expect(Object.hasOwn(result.changes.final_items[0]!, 'score.raw')).toBe(false);
                    expect(result.changes.final_items[0]!.meta).toEqual({ badge: 'gold', rank: 2 });
                });

                test('a path whose parent object is absent succeeds while writing nothing', () => {
                    const item: Nested = { id: '1', bag: {} };
                    const items = [item];
                    const result = writeToItemsArray(
                        [nestedWrite({ type: 'delete_property', path: 'meta.badge', where: { id: '1' } })],
                        items, NestedSchema, nestedDdl,
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.changed).toBe(false);
                    expect(result.changes.final_items).toBe(items);
                    expect(result.changes.final_items[0]).toBe(item);
                });

                test('a path inside an array scope writes to the elements the nested where names', () => {
                    const items: Obj[] = [{ id: '1', children: [{ cid: 'c1', name: 'one', children: [] }, { cid: 'c2', name: 'two', children: [] }] }];
                    const result = writeToItemsArray(
                        [{
                            type: 'write', ts: 0, uuid: '0', payload: assertWriteArrayScope<Obj, 'children'>({
                                type: 'array_scope', scope: 'children',
                                action: { type: 'delete_property', path: 'name', where: { cid: 'c1' } },
                                where: { id: '1' },
                            })
                        }],
                        items, ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(true);
                    const children = result.changes.final_items[0]!.children!;
                    expect(Object.keys(children[0]!)).toEqual(['cid', 'children']);
                    expect(children[1]).toEqual({ cid: 'c2', name: 'two', children: [] });
                });
            });

            describe('7.3 Surviving the journey to storage and back', () => {

                test.each([
                    ['set_property_undefined', ['id', 'text']],
                    ['delete_property', ['id']],
                ] as const)('a %s action that has been through JSON writes exactly what the original would have', (type, expectedKeys) => {
                    const action = write({ type, path: 'text', where: { id: '1' } });
                    const shipped = JSON.parse(JSON.stringify(action)) as typeof action;

                    const direct = writeToItemsArray([action], [{ id: '1', text: 'hi' }], ObjSchema, ddl);
                    const viaJson = writeToItemsArray([shipped], [{ id: '1', text: 'hi' }], ObjSchema, ddl);

                    // Stated outright rather than only compared, so the two sides cannot agree by both doing nothing.
                    expect(viaJson.ok).toBe(true);
                    expect(viaJson.changes.changed).toBe(true);
                    expect(Object.keys(viaJson.changes.final_items[0]!)).toEqual(expectedKeys);

                    expect(viaJson.ok).toBe(direct.ok);
                    expect(viaJson.changes.changed).toBe(direct.changes.changed);
                    expect(Object.keys(viaJson.changes.final_items[0]!)).toEqual(Object.keys(direct.changes.final_items[0]!));
                });

                test('an item that has been through JSON cannot tell a cleared property from a removed one', () => {
                    const cleared = writeToItemsArray(
                        [write({ type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'hi' }], ObjSchema, ddl,
                    );
                    const removed = writeToItemsArray(
                        [write({ type: 'delete_property', path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'hi' }], ObjSchema, ddl,
                    );

                    // In memory the two outcomes differ...
                    expect(Object.keys(cleared.changes.final_items[0]!)).toEqual(['id', 'text']);
                    expect(Object.keys(removed.changes.final_items[0]!)).toEqual(['id']);
                    // ...but the key holding `undefined` has no JSON representation, so persisting the item
                    // collapses one outcome into the other.
                    expect(JSON.stringify(cleared.changes.final_items[0])).toBe(JSON.stringify(removed.changes.final_items[0]));
                });

                test('a cleared property survives cloning as a key that is present and empty', () => {
                    const cleared = writeToItemsArray(
                        [write({ type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                        [{ id: '1', text: 'hi' }], ObjSchema, ddl,
                    );
                    const cloned = structuredClone(cleared.changes.final_items[0]!);
                    expect(Object.hasOwn(cloned, 'text')).toBe(true);
                    expect(cloned.text).toBe(undefined);
                });

                test('the schema accepts an item whose optional property is present and empty', () => {
                    // The engine validates a written item with the schema's own parse and stores the item it
                    // was given, so clearing a property is only sound while the schema reads that state back
                    // as valid.
                    expect(ObjSchema.safeParse({ id: '1', text: undefined }).success).toBe(true);
                    expect(ObjSchema.safeParse({ id: '1' }).success).toBe(true);
                });

                test('an exists filter reads a cleared property and a removed one alike, so neither is findable by it', () => {
                    const seed = (): Obj[] => [{ id: '1', text: 'hi' }];
                    for (const type of ['set_property_undefined', 'delete_property'] as const) {
                        const result = writeToItemsArray(
                            [
                                write({ type, path: 'text', where: { id: '1' } }, '0'),
                                write({ type: 'update', data: { owner: 'found by exists' }, where: { text: { $exists: false } } }, '1'),
                            ],
                            seed(), ObjSchema, ddl,
                        );
                        expect(result.ok).toBe(true);
                        expect(result.changes.final_items[0]!.owner).toBe('found by exists');
                    }
                });
            });

            describe('7.4 Leaving the caller\'s items alone', () => {

                test('the supplied item is untouched, key set included, when writing immutably', () => {
                    const item: Obj = { id: '1', text: 'hi', owner: 'ann' };
                    const items = [item];
                    const result = writeToItemsArray(
                        [write({ type: 'delete_property', path: 'text', where: { id: '1' } })],
                        items, ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]).not.toBe(item);
                    expect(Object.keys(item)).toEqual(['id', 'text', 'owner']);
                    expect(item.text).toBe('hi');
                });

                test('clearing immutably does not leave an empty key on the supplied item', () => {
                    const item: Obj = { id: '1', owner: 'ann' };
                    const items = [item];
                    writeToItemsArray(
                        [write({ type: 'set_property_undefined', path: 'owner', where: { id: '1' } })],
                        items, ObjSchema, ddl,
                    );
                    expect(item.owner).toBe('ann');
                    expect(Object.keys(item)).toEqual(['id', 'owner']);
                });

                test('the supplied item is written in place when mutating', () => {
                    const item: Obj = { id: '1', text: 'hi' };
                    const items = [item];
                    const result = writeToItemsArray(
                        [write({ type: 'delete_property', path: 'text', where: { id: '1' } })],
                        items, ObjSchema, ddl, { mutate: true },
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]).toBe(item);
                    expect(Object.keys(item)).toEqual(['id']);
                });

                test('rolling back an atomic batch restores a removed key and a cleared value', () => {
                    // The same two writes without the failing action, to show they do land — otherwise the
                    // rollback assertions below would hold just as well if nothing had been written at all.
                    const wouldRemoveFrom: Obj = { id: '1', text: 'hi' };
                    const wouldClearIn: Obj = { id: '2', owner: 'ann' };
                    writeToItemsArray(
                        [
                            write({ type: 'delete_property', path: 'text', where: { id: '1' } }, '0'),
                            write({ type: 'set_property_undefined', path: 'owner', where: { id: '2' } }, '1'),
                        ],
                        [wouldRemoveFrom, wouldClearIn], ObjSchema, ddl, { mutate: true, atomic: true },
                    );
                    expect(Object.keys(wouldRemoveFrom)).toEqual(['id']);
                    expect(wouldClearIn.owner).toBe(undefined);

                    const removedFrom: Obj = { id: '1', text: 'hi' };
                    const clearedIn: Obj = { id: '2', owner: 'ann' };
                    const items = [removedFrom, clearedIn];
                    const result = writeToItemsArray(
                        [
                            write({ type: 'delete_property', path: 'text', where: { id: '1' } }, '0'),
                            write({ type: 'set_property_undefined', path: 'owner', where: { id: '2' } }, '1'),
                            // @ts-expect-error: wilfully breaking schema, to fail the batch after both writes land
                            { type: 'write', ts: 0, uuid: '2', payload: { type: 'update', data: { none_key: 'bad' }, where: { id: '1' } } },
                        ],
                        items, ObjSchema, ddl, { mutate: true, atomic: true },
                    );
                    expect(result.ok).toBe(false);
                    expect(result.changes.final_items).toBe(items);
                    expect(Object.keys(removedFrom)).toEqual(['id', 'text']);
                    expect(removedFrom.text).toBe('hi');
                    expect(Object.keys(clearedIn)).toEqual(['id', 'owner']);
                    expect(clearedIn.owner).toBe('ann');
                });
            });

            describe('7.5 Paths the engine refuses whatever the schema says', () => {

                // A schema is free to declare the primary key optional; the engine is not, because it locates
                // every item by that key. A DDL cannot name an optional key in TypeScript either, so this
                // fixture stands in for how the combination is actually reached — a DDL and schema assembled
                // at runtime, beyond the reach of the declared types.
                const LooseKeySchema = z.object({ id: z.string().optional(), label: z.string().optional() }).strict();
                type LooseKey = z.infer<typeof LooseKeySchema>;
                const looseKeyDdl: DDL<LooseKey> = {
                    version: 1,
                    // @ts-expect-error a primary key must be a required string or number, which is why the engine's own guard is the backstop
                    lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
                };
                const looseWrite = (payload: unknown, uuid = '0'): WriteAction<LooseKey> =>
                    ({ type: 'write', ts: 0, uuid, payload: payload as WriteAction<LooseKey>['payload'] });

                test.each(['set_property_undefined', 'delete_property'] as const)(
                    '%s of the primary key is refused even though the schema permits it', (type) => {
                        const item: LooseKey = { id: '1', label: 'x' };
                        const items = [item];
                        const result = writeToItemsArray(
                            [looseWrite({ type, path: 'id', where: { id: '1' } })],
                            items, LooseKeySchema, looseKeyDdl,
                        );
                        expect(result.ok).toBe(false);
                        const failure = getWriteFailures(result)[0]!;
                        expect(failure.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'id', reason: 'primary_key' });
                        expect(failure.unrecoverable).toBe(true);
                        expect(result.changes.final_items[0]).toBe(item);
                    });

                test('a primary-key path is refused against an empty collection', () => {
                    const result = writeToItemsArray(
                        [looseWrite({ type: 'delete_property', path: 'id', where: {} })],
                        [], LooseKeySchema, looseKeyDdl,
                    );
                    expect(result.ok).toBe(false);
                    expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'id', reason: 'primary_key' });
                });

                test('a primary-key path is refused even when the where matches nothing', () => {
                    const result = writeToItemsArray(
                        [looseWrite({ type: 'delete_property', path: 'id', where: { id: 'no-such-row' } })],
                        [{ id: '1' }], LooseKeySchema, looseKeyDdl,
                    );
                    expect(result.ok).toBe(false);
                    expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'id', reason: 'primary_key' });
                });

                test('a scoped element is judged against its own list\'s key, reported by its full path', () => {
                    const ScopedSchema = z.object({
                        id: z.string(),
                        rows: z.array(z.object({ rid: z.string().optional(), hint: z.string().optional() }).strict()),
                    }).strict();
                    type Scoped = z.infer<typeof ScopedSchema>;
                    const scopedDdl: DDL<Scoped> = {
                        version: 1,
                        lists: {
                            '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
                            // @ts-expect-error as above: an optional key is unnameable in a DDL, so the engine guards it
                            'rows': { primary_key: 'rid' },
                        },
                    };
                    const items: Scoped[] = [{ id: '1', rows: [{ rid: 'r1', hint: 'h' }] }];

                    const result = writeToItemsArray(
                        [{
                            type: 'write', ts: 0, uuid: '0', payload: assertWriteArrayScope<Scoped, 'rows'>({
                                type: 'array_scope', scope: 'rows',
                                action: { type: 'delete_property', path: 'rid', where: { rid: 'r1' } },
                                where: { id: '1' },
                            })
                        }],
                        items, ScopedSchema, scopedDdl,
                    );

                    expect(result.ok).toBe(false);
                    expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'rows.rid', reason: 'primary_key' });
                    expect(result.changes.final_items[0]).toBe(items[0]);
                });

                test('a schema that admits the primary key as an open key still cannot have it removed', () => {
                    // An open schema declares undeclared keys as removable, so nothing but the DDL knows that
                    // this particular key is the one the engine identifies items by.
                    const OpenSchema = z.object({ label: z.string().optional() }).catchall(z.string());
                    type Open = z.infer<typeof OpenSchema>;
                    const openDdl: DDL<Open> = {
                        version: 1,
                        lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
                    };
                    const items: Open[] = [{ id: '1', label: 'x' }];

                    const result = writeToItemsArray<Open>(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'delete_property', path: 'id', where: { id: '1' } } }],
                        items, OpenSchema, openDdl,
                    );
                    expect(result.ok).toBe(false);
                    expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'id', reason: 'primary_key' });
                    expect(result.changes.final_items[0]).toBe(items[0]);
                });

                test('a property named like the primary key but held inside another object is ordinary', () => {
                    const NestedIdSchema = z.object({
                        id: z.string(),
                        meta: z.object({ id: z.string().optional() }).strict(),
                    }).strict();
                    type NestedId = z.infer<typeof NestedIdSchema>;
                    const nestedIdDdl: DDL<NestedId> = {
                        version: 1,
                        lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
                    };

                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'delete_property', path: 'meta.id', where: { id: '1' } } }],
                        [{ id: '1', meta: { id: 'inner' } }], NestedIdSchema, nestedIdDdl,
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]).toEqual({ id: '1', meta: {} });
                });
            });
        });

        // ───────────────────────────────────────────────────────────
        // 8. Items that carry no primary key
        // ───────────────────────────────────────────────────────────
        // Every item is located by its primary key, so an item without one cannot be written to. The batch is
        // reported as failed rather than throwing, so a caller that already handles write failures handles
        // this too.

        describe('8. Items that carry no primary key', () => {

            const anyAction = (uuid = '0'): WriteAction<Obj> =>
                ({ type: 'write', ts: 0, uuid, payload: { type: 'update', data: { text: 'written' }, where: {} } });

            test('a batch over items missing a key fails as a value instead of throwing', () => {
                const items = [{ id: '1' }, {}] as Obj[];
                expect(() => writeToItemsArray([anyAction()], items, ObjSchema, ddl)).not.toThrow();

                const result = writeToItemsArray([anyAction()], items, ObjSchema, ddl);
                expect(result.ok).toBe(false);
                const failure = getWriteFailures(result)[0]!;
                expect(failure.errors[0]).toMatchObject({ type: 'missing_key', primary_key: 'id' });
                expect(failure.unrecoverable).toBe(true);
            });

            test('nothing is written when an item is missing a key', () => {
                const keyed: Obj = { id: '1' };
                const items = [keyed, {} as Obj];
                const result = writeToItemsArray([anyAction()], items, ObjSchema, ddl, { mutate: true });

                expect(result.ok).toBe(false);
                expect(result.changes.changed).toBe(false);
                expect(result.changes.final_items).toBe(items);
                expect(keyed).toEqual({ id: '1' });
            });

            test('every action in the batch is accounted for, the later ones as blocked', () => {
                const items = [{} as Obj];
                const result = writeToItemsArray([anyAction('a1'), anyAction('a2')], items, ObjSchema, ddl);

                expect(result.actions.map(a => a.action_uuid)).toEqual(['a1', 'a2']);
                expect(getWriteFailures(result).find(f => f.action_uuid === 'a2')?.blocked_by_action_uuid).toBe('a1');
            });

            test.each([
                ['an absent key', {}],
                ['an empty-string key', { id: '' }],
                ['a zero key', { id: 0 }],
            ])('%s counts as no key at all', (_label, item) => {
                // Zero and the empty string are deliberately treated as missing: an empty string is how a
                // missing key is reported onward, so these values cannot be told apart from absence downstream.
                const result = writeToItemsArray([anyAction()], [item as unknown as Obj], ObjSchema, ddl);
                expect(result.ok).toBe(false);
                expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'missing_key', primary_key: 'id' });
            });

            test('an item carrying a key is written to as usual', () => {
                const result = writeToItemsArray([anyAction()], [{ id: '1' }], ObjSchema, ddl);
                expect(result.ok).toBe(true);
                expect(result.changes.final_items[0]).toEqual({ id: '1', text: 'written' });
            });
        });

        describe('9. An explicit undefined in written data', () => {

            /** Build an action whose payload carries a value the payload types do not admit, so the runtime gate is what answers. */
            const write = (payload: unknown, uuid = '0'): WriteAction<Obj> =>
                ({ type: 'write', ts: 0, uuid, payload: payload as WriteAction<Obj>['payload'] });

            describe('9.1 The two verbs that write data', () => {

                test('an update carrying it is rejected at the field it named, and the item is untouched', () => {
                    const items: Obj[] = [{ id: '1', text: 'hi', owner: 'ann' }];
                    const result = writeToItemsArray(
                        [write({ type: 'update', data: { text: undefined }, where: { id: '1' } })],
                        items, ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(false);
                    const failure = getWriteFailures(result)[0]!;
                    expect(failure.errors[0]).toMatchObject({ type: 'invalid_data_value', reason: 'malformed', data_path: 'text' });
                    expect(failure.unrecoverable).toBe(true);
                    expect(result.changes.final_items[0]).toEqual({ id: '1', text: 'hi', owner: 'ann' });
                    expect(result.changes.final_items[0]).toBe(items[0]);
                });

                test('a create carrying it is rejected at the field it named, and nothing is created', () => {
                    const result = writeToItemsArray(
                        [write({ type: 'create', data: { id: '2', text: undefined } })],
                        [{ id: '1' }], ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(false);
                    expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_data_value', reason: 'malformed', data_path: 'text' });
                    expect(result.changes.final_items).toEqual([{ id: '1' }]);
                });

                test('the failure names the remedy for its verb, without repeating any of the data', () => {
                    const updateResult = writeToItemsArray(
                        [write({ type: 'update', data: { text: undefined, owner: 'ann' }, where: { id: '1' } })],
                        [{ id: '1' }], ObjSchema, ddl,
                    );
                    const updateError = getWriteFailures(updateResult)[0]!.errors[0]!;
                    expect(updateError.type === 'invalid_data_value' && updateError.message).toContain('set_property_undefined');
                    expect(updateError.type === 'invalid_data_value' && updateError.message).toContain('delete_property');
                    expect(JSON.stringify(updateError)).not.toContain('ann');

                    const createResult = writeToItemsArray(
                        [write({ type: 'create', data: { id: '2', text: undefined, owner: 'ann' } })],
                        [], ObjSchema, ddl,
                    );
                    const createError = getWriteFailures(createResult)[0]!.errors[0]!;
                    expect(createError.type === 'invalid_data_value' && createError.message).toContain('omit the key');
                    expect(JSON.stringify(createError)).not.toContain('ann');
                });

                test('a nested undefined is caught too, at its full path', () => {
                    const result = writeToItemsArray(
                        [write({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { name: undefined }, where: { cid: 'c1' } } })],
                        [{ id: '1', children: [{ cid: 'c1', name: 'first', children: [] }] }], ObjSchema, ddl,
                    );
                    expect(result.ok).toBe(false);
                    expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_data_value', reason: 'malformed', data_path: 'name' });
                });
            });

            describe('9.2 Why it is refused rather than interpreted', () => {

                test('the same action loses the key in transit, so the two spellings would ask for different things', () => {
                    const action = write({ type: 'update', data: { text: undefined, owner: 'ann' }, where: { id: '1' } });
                    const seed = (): Obj[] => [{ id: '1', text: 'hi' }];

                    // As written, the action is refused outright.
                    const asWritten = writeToItemsArray([action], seed(), ObjSchema, ddl);
                    expect(asWritten.ok).toBe(false);

                    // After a JSON round trip the key is simply gone, and what survives is an ordinary partial
                    // update that succeeds and leaves `text` exactly as it was.
                    const roundTripped: WriteAction<Obj> = JSON.parse(JSON.stringify(action));
                    const afterTransit = writeToItemsArray([roundTripped], seed(), ObjSchema, ddl);
                    expect(afterTransit.ok).toBe(true);
                    const written = afterTransit.changes.final_items[0]!;
                    expect(written).toEqual({ id: '1', text: 'hi', owner: 'ann' });
                    expect(Object.hasOwn(written, 'text')).toBe(true);
                });

                test('the intentions it was reaching for each have a verb that survives the same journey', () => {
                    const seed = (): Obj[] => [{ id: '1', text: 'hi' }];

                    const clear = write({ type: 'set_property_undefined', path: 'text', where: { id: '1' } });
                    const cleared = writeToItemsArray([JSON.parse(JSON.stringify(clear))], seed(), ObjSchema, ddl);
                    expect(cleared.ok).toBe(true);
                    expect(Object.keys(cleared.changes.final_items[0]!)).toEqual(['id', 'text']);
                    expect(cleared.changes.final_items[0]!.text).toBe(undefined);

                    const remove = write({ type: 'delete_property', path: 'text', where: { id: '1' } });
                    const removed = writeToItemsArray([JSON.parse(JSON.stringify(remove))], seed(), ObjSchema, ddl);
                    expect(removed.ok).toBe(true);
                    expect(Object.keys(removed.changes.final_items[0]!)).toEqual(['id']);
                });

                test('null is an ordinary value, stored as given', () => {
                    const NullableSchema = z.object({ id: z.string(), note: z.string().nullable().optional() }).strict();
                    type Nullable = z.infer<typeof NullableSchema>;
                    const nullableDdl: DDL<Nullable> = {
                        version: 1,
                        lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
                    };
                    const result = writeToItemsArray<Nullable>(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { note: null }, where: { id: '1' } } }],
                        [{ id: '1', note: 'hi' }], NullableSchema, nullableDdl,
                    );
                    expect(result.ok).toBe(true);
                    expect(result.changes.final_items[0]!.note).toBe(null);
                    expect(Object.hasOwn(result.changes.final_items[0]!, 'note')).toBe(true);
                });
            });
        });
    });
});
