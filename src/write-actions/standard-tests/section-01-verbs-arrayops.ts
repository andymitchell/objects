import {
    FlatSchema, flatDdl, type Flat,
    NestedSchema, nestedDdl, type Nested,
    FlatWithSubItemsSchema, flatWithSubItemsDdl, type FlatWithSubItems,
} from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { assertWriteArrayScope } from "../helpers.ts";

/** §1.5–§1.9: add_to_set / push / pull / inc / cross-cutting mutations. */
export function registerVerbsArrayOps(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    // ─────────────────────────────────────────────────────────
    // 1.5 AddToSet
    // ─────────────────────────────────────────────────────────

    describe('1.5 AddToSet', () => {

        describe('scalar deep_equals', () => {
            test('adds item to existing scalar array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                }, implName);
            });

            test('empty items: no-op', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: [], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a']);
                }, implName);
            });

            test('multiple new items all added', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b', 'c'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b', 'c']);
                }, implName);
            });

            test('some items already present: only new ones added', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b', 'c'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b', 'c']);
                }, implName);
            });

            test('all items already present: no-op', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['a', 'b'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                }, implName);
            });

            test('internal duplicates in items are deduped', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b', 'b'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                }, implName);
            });
        });

        describe('object deep_equals', () => {
            test('key-order independent equality', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ val: 1, sid: 's1' }], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                }, implName);
            });

            test('different objects are added', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's2', val: 2 }], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(2);
                }, implName);
            });
        });

        describe('pk-based', () => {
            test('same PK: item skipped', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's1', val: 999 }], unique_by: 'pk', where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    expect(r.finalItems[0]!.sub_items![0]!.val).toBe(1); // not replaced
                }, implName);
            });

            test('new PK: item added', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's2', val: 2 }], unique_by: 'pk', where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(2);
                }, implName);
            });

            test('pk on scalar array: error', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    // A string has no key to be unique by, so the payload type does not offer `pk` here. The
                    // suppression writes the action anyway, standing in for an untyped caller — the engine has
                    // to rule on the pairing whether or not a type screened it out first.
                    // @ts-expect-error: 'pk' is not offered on a scalar array
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'pk', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                }, implName);
            });
        });

        describe('field validation', () => {
            test('undefined field initialises to empty array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['a'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a']);
                }, implName);
            });

            test('where matches zero items: no-op', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'deep_equals', where: { id: 'nonexistent' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a']);
                }, implName);
            });

            test('where matches multiple items: each gets the add', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'same', tags: ['a'] }, { id: '2', text: 'same', tags: ['b'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['z'], unique_by: 'deep_equals', where: { text: 'same' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems.find(x => x.id === '1')!.tags).toEqual(['a', 'z']);
                    expect(r.finalItems.find(x => x.id === '2')!.tags).toEqual(['b', 'z']);
                }, implName);
            });
        });
    });

    // ─────────────────────────────────────────────────────────
    // 1.6 Push
    // ─────────────────────────────────────────────────────────

    describe('1.6 Push', () => {

        test('push scalars to existing array', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: ['a'] }],
                writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['b', 'c'], where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['a', 'b', 'c']);
            }, implName);
        });

        test('undefined field initialises to empty array then pushes', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['x'], where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['x']);
            }, implName);
        });

        test('empty items: no-op', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: ['a'] }],
                writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: [], where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['a']);
            }, implName);
        });

        test('duplicates appended (no uniqueness check)', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: ['a'] }],
                writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['a', 'a'], where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['a', 'a', 'a']);
            }, implName);
        });

        test('order preserved', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: [] }],
                writeActions: [makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['c', 'b', 'a'], where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['c', 'b', 'a']);
            }, implName);
        });

        test('push objects to array', async () => {
            const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'push', path: 'sub_items', items: [{ sid: 's2', val: 2 }], where: { id: '1' } })],
                schema: FlatWithSubItemsSchema,
                ddl: flatWithSubItemsDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.sub_items).toHaveLength(2);
                expect(r.finalItems[0]!.sub_items![1]!.sid).toBe('s2');
            }, implName);
        });
    });

    // ─────────────────────────────────────────────────────────
    // 1.7 Pull
    // ─────────────────────────────────────────────────────────

    describe('1.7 Pull', () => {

        describe('object array (WhereFilter mode)', () => {
            test('removes elements matching where filter', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }, { sid: 's2', val: 2 }, { sid: 's3', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { val: 1 }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    expect(r.finalItems[0]!.sub_items![0]!.sid).toBe('s2');
                }, implName);
            });

            test('empty array: no-op', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 's1' }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toEqual([]);
                }, implName);
            });

            test('undefined field: no-op', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 's1' }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName);
            });

            test('empty items_where matches all: array emptied', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1' }, { sid: 's2' }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: {}, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toEqual([]);
                }, implName);
            });

            test('no match: no-op', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 'nonexistent' }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                }, implName);
            });

            test('all copies removed (not just first)', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 5 }, { sid: 's2', val: 5 }, { sid: 's3', val: 10 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { val: 5 }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    expect(r.finalItems[0]!.sub_items![0]!.sid).toBe('s3');
                }, implName);
            });

            test('match by PK field', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }, { sid: 's2', val: 2 }] }],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 's1' }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    expect(r.finalItems[0]!.sub_items![0]!.sid).toBe('s2');
                }, implName);
            });
        });

        describe('scalar array (value list mode)', () => {
            test('pull scalar values from array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b', 'c'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['a', 'c'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['b']);
                }, implName);
            });

            test('pull value not present: no-op', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['z'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                }, implName);
            });

            test('pull all values: empty array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['a', 'b'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual([]);
                }, implName);
            });

            test('pull with duplicates in existing array: all copies removed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b', 'a', 'c'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'pull', path: 'tags', items_where: ['a'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['b', 'c']);
                }, implName);
            });
        });
    });

    // ─────────────────────────────────────────────────────────
    // 1.8 Inc
    // ─────────────────────────────────────────────────────────

    describe('1.8 Inc', () => {

        test('increments number', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', count: 10 }],
                writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: 5, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.count).toBe(15);
            }, implName);
        });

        test('undefined field initialises to 0 then adds', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: 7, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.count).toBe(7);
            }, implName);
        });

        test('negative amount: decrement', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', count: 10 }],
                writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: -3, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.count).toBe(7);
            }, implName);
        });

        test('amount 0: no-op', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', count: 10 }],
                writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: 0, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.count).toBe(10);
            }, implName);
        });

        test('NaN amount: error', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', count: 10 }],
                writeActions: [makeAction<Flat>('a1', { type: 'inc', path: 'count', amount: NaN, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
            }, implName);
        });
    });

    // ─────────────────────────────────────────────────────────
    // 1.9 Cross-Cutting Mutations
    // ─────────────────────────────────────────────────────────

    describe('1.9 Cross-Cutting Mutations', () => {

        test('array_scope wrapping push on nested objects', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 1 }] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'push', path: 'items', items: [{ iid: 'i2', value: 2 }], where: { cid: 'c1' } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                const child = r.finalItems[0]!.children![0]!;
                expect(child.items).toHaveLength(2);
                expect(child.items[1]!.iid).toBe('i2');
            }, implName);
        });

        test('array_scope wrapping inc on nested object (dot-path scope)', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 10 }] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children.items'>({
                    type: 'array_scope',
                    scope: 'children.items',
                    action: { type: 'inc', path: 'value', amount: 5, where: { iid: 'i1' } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                const item = r.finalItems[0]!.children![0]!.items[0]!;
                expect(item.value).toBe(15);
            }, implName);
        });

        test('multiple mutations on same item in sequence', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: ['a'], count: 0 }],
                writeActions: [
                    makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['b'], where: { id: '1' } }),
                    makeAction<Flat>('a2', { type: 'inc', path: 'count', amount: 10, where: { id: '1' } }),
                    makeAction<Flat>('a3', { type: 'pull', path: 'tags', items_where: ['a'], where: { id: '1' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['b']);
                expect(r.finalItems[0]!.count).toBe(10);
            }, implName);
        });

        test('atomic: push ok + inc error → both rolled back', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: ['a'], count: 5 }],
                writeActions: [
                    makeAction<Flat>('a1', { type: 'push', path: 'tags', items: ['b'], where: { id: '1' } }),
                    makeAction<Flat>('a2', { type: 'inc', path: 'count', amount: NaN, where: { id: '1' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { atomic: true },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                // In atomic mode, the original items should be unchanged
                expect(r.finalItems[0]!.tags).toEqual(['a']);
                expect(r.finalItems[0]!.count).toBe(5);
            }, implName);
        });
    });
}
