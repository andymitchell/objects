import { z } from "zod";
import { test, describe, expect } from 'vitest';
import type { WriteAction, WritePayloadArrayScope } from "../types.ts";
import { assertWriteArrayScope, getWriteFailures, getWriteSuccesses } from "../helpers.ts";
import type { WriteToItemsArrayOptions, WriteToItemsArrayResult, DDL } from "./types.ts";
import { produce, type Draft } from "immer";
import type { IUser } from "../auth/types.ts";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { standardTests, type AdapterFactory } from "../standardTests.ts";

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
        '.': { primary_key: 'id', order_by: { key: 'id' } },
        'children': { primary_key: 'cid', order_by: { key: 'cid' } },
        'children.children': { primary_key: 'ccid', order_by: { key: 'ccid' } },
    },
    permissions: { type: 'none' },
};

const obj1: Obj = { id: '1' };
const obj2: Obj = { id: '2' };

// ═══════════════════════════════════════════════════════════════════
// Adapter factory for standardTests
// ═══════════════════════════════════════════════════════════════════

const createAdapter: AdapterFactory = <T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>) => ({
    apply: async ({ initialItems, writeActions, user, options }) => {
        const items = structuredClone(initialItems);
        const result = writeToItemsArray(writeActions, items, schema, ddl, user, {
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
        standardTests({ test, expect, createAdapter, implementationName: 'writeToItemsArray' });
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
                        items, ObjSchema, ddl, undefined, { mutate: true },
                    );
                    expect(result.changes.final_items).toBe(items);
                });

                test('items are mutated in-place', () => {
                    const item1 = structuredClone(obj1);
                    const items = [item1];
                    const result = writeToItemsArray(
                        [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'new' }, where: { id: '1' } } }],
                        items, ObjSchema, ddl, undefined, { mutate: true },
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
                            draft as Obj[], ObjSchema, ddl, undefined, { mutate: true },
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
                            draft as Obj[], ObjSchema, ddl, undefined, { mutate: false },
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
                        // @ts-ignore wilfully breaking schema
                        { type: 'write', ts: 0, uuid: '1', payload: { type: 'update', data: { none_key: 'bad' }, where: { id: '1' } } },
                    ],
                    items, ObjSchema, ddl, undefined, { atomic: true },
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
                        // @ts-ignore wilfully breaking schema
                        { type: 'write', ts: 0, uuid: '1', payload: { type: 'update', data: { none_key: 'bad' }, where: { id: '1' } } },
                    ],
                    originalItems, ObjSchema, ddl, undefined, { atomic: true },
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
                        draft as Obj[], ObjSchema, ddl, undefined, { mutate: true },
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
                const item = { id: '1', text: 'original' };
                const items = [item];
                const result = writeToItemsArray(
                    [{ type: 'write', ts: 0, uuid: '0', payload: { type: 'update', data: { text: 'changed' }, where: { id: '1' } } }],
                    items, ObjSchema, ddl, undefined, { mutate: true },
                );
                // In mutable mode, the original object should be mutated in-place
                expect(item.text).toBe('changed');
                expect(result.changes.final_items[0]).toBe(item);
            });

            test('update_handler mutates cloned target (immutable mode)', () => {
                const item = { id: '1', text: 'original' };
                const items = [item];
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
                    lists: { '.': { primary_key: 'id', order_by: { key: 'id' } } },
                    permissions: { type: 'none' },
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
                        draft as Obj[], ObjSchema, ddl, undefined, { mutate: true },
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
                                        // @ts-ignore
                                        data: { bad_key: 'fail' },
                                    },
                                    where: { id: '1' },
                                }
                            },
                        ],
                        draft as Obj[], ObjSchema, ddl, undefined, { atomic: true, mutate: true },
                    );
                    expect(result.ok).toBe(false);
                });
                // Immer should not have changed anything since atomic rolled back
                expect(finalItems[0]!.children![0]!.name).toBeUndefined();
            });
        });
    });
});
