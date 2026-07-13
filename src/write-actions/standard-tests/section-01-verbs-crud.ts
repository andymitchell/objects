import { FlatSchema, flatDdl, NestedSchema, nestedDdl, type Nested } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { assertWriteArrayScope, getWriteFailures } from "../helpers.ts";

/** §1.1–§1.4: create / update / delete / array_scope core verbs. */
export function registerVerbsCrud(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName, itIfSupported } = ctx;

    describe('1.1 Create', () => {

        test('creates a new item', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [makeAction('a1', { type: 'create', data: { id: '2', text: 'hello' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(2);
                expect(r.finalItems.find(x => x.id === '2')).toBeDefined();
                expect(r.changes.insert).toHaveLength(1);
                expect(r.changes.insert[0]!.id).toBe('2');
            }, implName);
        });

        test('create with all optional fields populated', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: 'hi', count: 5, tags: ['a', 'b'] } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]).toEqual({ id: '1', text: 'hi', count: 5, tags: ['a', 'b'] });
            }, implName);
        });

        test('create with only required fields (PK)', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.id).toBe('1');
            }, implName);
        });

        test('multiple creates in one batch', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1' } }),
                    makeAction('a2', { type: 'create', data: { id: '2' } }),
                    makeAction('a3', { type: 'create', data: { id: '3' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(3);
            }, implName);
        });
    });

    describe('1.2 Update', () => {

        test('updates matching item', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'old' }],
                writeActions: [makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('new');
                expect(r.changes.update).toHaveLength(1);
            }, implName);
        });

        test('update with where-filter matching multiple items: all updated', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'same' }, { id: '2', text: 'same' }, { id: '3', text: 'other' }],
                writeActions: [makeAction('a1', { type: 'update', data: { text: 'changed' }, where: { text: 'same' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems.filter(x => x.text === 'changed')).toHaveLength(2);
                expect(r.finalItems.find(x => x.id === '3')!.text).toBe('other');
            }, implName);
        });

        test('update with where-filter matching zero items: no changes, still ok', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'keep' }],
                writeActions: [makeAction('a1', { type: 'update', data: { text: 'changed' }, where: { id: 'nonexistent' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('keep');
                expect(r.changes.update).toHaveLength(0);
            }, implName);
        });

        test('partial update merges (default merge method): untouched fields preserved', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'hello', count: 42 }],
                writeActions: [makeAction('a1', { type: 'update', data: { text: 'world' }, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('world');
                expect(r.finalItems[0]!.count).toBe(42);
            }, implName);
        });

        itIfSupported('assignMethod')('update method assign: shallow replacement', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'hello', count: 42 }],
                writeActions: [makeAction('a1', { type: 'update', data: { text: 'world' }, where: { id: '1' }, method: 'assign' })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('world');
                // assign replaces top-level props but doesn't remove untouched ones via Object.assign
                expect(r.finalItems[0]!.count).toBe(42);
            }, implName, 'assign update method');
        });

        itIfSupported('scalarArrayUpdate')('scalar array property can be set via update (full replacement)', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', tags: ['a', 'b'] }],
                writeActions: [makeAction('a1', { type: 'update', data: { tags: ['z'] }, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.tags).toEqual(['z']);
            }, implName, 'scalar array update');
        });
    });

    describe('1.3 Delete', () => {

        test('deletes matching item', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }, { id: '2' }],
                writeActions: [makeAction('a1', { type: 'delete', where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(1);
                expect(r.finalItems[0]!.id).toBe('2');
                expect(r.changes.remove_keys).toHaveLength(1);
            }, implName);
        });

        test('delete with where-filter matching multiple items: all removed', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'rm' }, { id: '2', text: 'rm' }, { id: '3', text: 'keep' }],
                writeActions: [makeAction('a1', { type: 'delete', where: { text: 'rm' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(1);
                expect(r.finalItems[0]!.id).toBe('3');
            }, implName);
        });

        test('delete with where-filter matching zero items: no changes, still ok', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [makeAction('a1', { type: 'delete', where: { id: 'nonexistent' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(1);
                expect(r.changes.remove_keys).toHaveLength(0);
            }, implName);
        });
    });

    describe('1.4 Array Scope', () => {

        test('creates item in nested object-array', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'create', data: { cid: 'c2', items: [] } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children).toHaveLength(2);
                expect(r.finalItems[0]!.children![1]!.cid).toBe('c2');
            }, implName);
        });

        test('updates item in nested object-array', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', label: 'old', items: [] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'update', data: { label: 'new' }, where: { cid: 'c1' } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children![0]!.label).toBe('new');
            }, implName);
        });

        test('deletes item from nested object-array', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }, { cid: 'c2', items: [] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'delete', where: { cid: 'c1' } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children).toHaveLength(1);
                expect(r.finalItems[0]!.children![0]!.cid).toBe('c2');
            }, implName);
        });

        test('deeply nested array_scope (2+ levels: children.items)', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children.items'>({
                    type: 'array_scope',
                    scope: 'children.items',
                    action: { type: 'create', data: { iid: 'i1', value: 99 } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children![0]!.items).toHaveLength(1);
                expect(r.finalItems[0]!.children![0]!.items[0]!.iid).toBe('i1');
                expect(r.finalItems[0]!.children![0]!.items[0]!.value).toBe(99);
            }, implName);
        });

        test('array_scope on empty nested array: no-op, still ok', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'update', data: { label: 'new' }, where: { cid: 'c1' } },
                    where: { id: '1' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children).toHaveLength(0);
            }, implName);
        });

        test('array_scope where-filter matches zero parent items: no-op, still ok', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'create', data: { cid: 'c2', items: [] } },
                    where: { id: 'nonexistent' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children).toHaveLength(1);
            }, implName);
        });

        test('array_scope where-filter matches multiple parent items: sub-action applied to all', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [
                    { id: '1', name: 'target', children: [{ cid: 'c1', items: [] }] },
                    { id: '2', name: 'target', children: [{ cid: 'c2', items: [] }] },
                ],
                writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'create', data: { cid: 'new', items: [] } },
                    where: { name: 'target' },
                }))],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.children).toHaveLength(2);
                expect(r.finalItems[1]!.children).toHaveLength(2);
            }, implName);
        });

        test('constraint violation inside array_scope (duplicate PK in nested array): halts parent execution', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                writeActions: [
                    makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'create', data: { cid: 'c1', items: [] } }, // duplicate PK
                        where: { id: '1' },
                    })),
                    makeAction<Nested>('a2', { type: 'create', data: { id: '2' } }), // should be blocked
                ],
                schema: NestedSchema,
                ddl: nestedDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                const failures = getWriteFailures(r.result);
                expect(failures.length).toBeGreaterThanOrEqual(1);
                // Second action should be blocked
                const blocked = failures.find(f => f.action_uuid === 'a2');
                if (blocked) {
                    expect(blocked.blocked_by_action_uuid).toBe('a1');
                }
            }, implName);
        });
    });
}
