import { FlatSchema, flatDdl, type Flat, NestedSchema, nestedDdl, type Nested } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { assertWriteArrayScope, getWriteSuccesses } from "../helpers.ts";

/** §5: atomic vs non-atomic commit semantics, including array_scope rollback. */
export function registerAtomic(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    describe('5. Atomic vs Non-Atomic', () => {

        describe('5.1 Non-atomic (default)', () => {

            test('partial success: earlier successes kept, later blocked', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction<Flat>('a2', {
                            type: 'create',
                            // @ts-expect-error: probing the runtime's response to a create the schema forbids
                            data: { broken: true },
                        }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems.find(x => x.id === '1')).toBeDefined();
                    expect(getWriteSuccesses(r.result)).toHaveLength(1);
                }, implName);
            });

            test('changes reflect only the successful mutations', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'existing' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: 'new' } }),
                        makeAction('a2', { type: 'create', data: { id: 'existing' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.insert).toHaveLength(1);
                    expect(r.changes.insert[0]!.id).toBe('new');
                }, implName);
            });
        });

        describe('5.2 Atomic', () => {

            test('on failure: all actions fail, changes.changed is false', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'existing' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: 'new' } }),
                        makeAction('a2', { type: 'create', data: { id: 'existing' } }), // fails
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.changes.changed).toBe(false);
                    expect(getWriteSuccesses(r.result)).toHaveLength(0);
                }, implName);
            });

            test('finalItems match original items (complete rollback)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const originalItems: Flat[] = [{ id: '1', text: 'keep' }];
                const r = await adapter.apply({
                    initialItems: originalItems,
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '2' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // fails
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems).toHaveLength(1);
                    expect(r.finalItems[0]!.id).toBe('1');
                    expect(r.finalItems[0]!.text).toBe('keep');
                }, implName);
            });

            test('result.ok is false, no successes reported', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction<Flat>('a2', {
                            type: 'create',
                            // @ts-expect-error: probing the runtime's response to a create the schema forbids
                            data: { bad: true },
                        }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteSuccesses(r.result)).toHaveLength(0);
                }, implName);
            });
        });

        describe('5.3 Atomic + array_scope', () => {

            test('failure in nested scope rolls back everything (atomic)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [
                        makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: { type: 'update', data: { label: 'changed' }, where: { cid: 'c1' } },
                            where: { id: '1' },
                        })),
                        makeAction<Nested>('a2', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: {
                                type: 'create',
                                // @ts-ignore
                                data: { bad_key: 'fail' },
                            },
                            where: { id: '1' },
                        })),
                    ],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.changes.changed).toBe(false);
                    // children should be unchanged
                    expect(r.finalItems[0]!.children![0]!.label).toBeUndefined();
                }, implName);
            });

            test('failure in nested scope keeps prior successes (non-atomic)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [
                        makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: { type: 'update', data: { label: 'changed' }, where: { cid: 'c1' } },
                            where: { id: '1' },
                        })),
                        makeAction<Nested>('a2', assertWriteArrayScope<Nested, 'children'>({
                            type: 'array_scope',
                            scope: 'children',
                            action: {
                                type: 'create',
                                // @ts-ignore
                                data: { bad_key: 'fail' },
                            },
                            where: { id: '1' },
                        })),
                    ],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    // First action should have succeeded
                    expect(r.finalItems[0]!.children![0]!.label).toBe('changed');
                }, implName);
            });
        });
    });
}
