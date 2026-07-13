import { FlatSchema, flatDdl, type Flat, NestedSchema, nestedDdl, type Nested } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { assertWriteArrayScope } from "../helpers.ts";

/** §2: WriteResult / WriteOutcome / WriteChanges shape guarantees. */
export function registerResultShape(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    describe('2. Result Shape', () => {

        describe('2.1 WriteResult structure', () => {

            test('result.ok is true on full success', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName);
            });

            test('result.ok is false when any action fails', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })], // duplicate PK
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                }, implName);
            });

            test('result.actions length matches input actions length', async () => {
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
                    expect(r.result.actions).toHaveLength(3);
                }, implName);
            });

            test('empty actions array: ok:true, no changes, changes.changed === false', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.result.actions).toHaveLength(0);
                    expect(r.changes.changed).toBe(false);
                    expect(r.finalItems).toHaveLength(1);
                }, implName);
            });
        });

        describe('2.2 WriteOutcome (per-action)', () => {

            test('successful action: ok:true, action uuid matches, affected_items present', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('uuid-42', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const outcome = r.result.actions[0]!;
                    expect(outcome.ok).toBe(true);
                    expect(outcome.action_uuid).toBe('uuid-42');
                    if (outcome.ok) {
                        expect(outcome.affected_items).toBeDefined();
                    }
                }, implName);
            });

            test('affected_items contains correct PKs for each verb', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                // Create
                const r1 = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: 'new1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r1, (r) => {
                    const outcome = r.result.actions[0]!;
                    if (outcome.ok) {
                        expect(outcome.affected_items?.some(ai => ai.item_pk === 'new1')).toBe(true);
                    }
                }, implName);

                // Update
                const r2 = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'new' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r2, (r) => {
                    const outcome = r.result.actions[0]!;
                    if (outcome.ok) {
                        expect(outcome.affected_items?.some(ai => ai.item_pk === '1')).toBe(true);
                    }
                }, implName);

                // Delete
                const r3 = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'delete', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r3, (r) => {
                    const outcome = r.result.actions[0]!;
                    if (outcome.ok) {
                        expect(outcome.affected_items?.some(ai => ai.item_pk === '1')).toBe(true);
                    }
                }, implName);
            });

            test('action uuid from input is preserved in outcome', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const action = makeAction<Flat>('preserve-uuid', { type: 'create', data: { id: '1' } });
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [action],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const outcome = r.result.actions[0]!;
                    expect(outcome.action_uuid).toBe('preserve-uuid');
                }, implName);
            });

            test('every outcome action_uuid is a submitted action uuid (no synthetic array_scope uuid leaks)', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                // A failing array_scope (duplicate nested PK) folds its recursion's synthetic `uuid+scope`
                // failures under the parent action; a blocked sibling follows. Neither may surface a synthetic uuid.
                const submitted = [
                    makeAction<Nested>('sub-1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'create', data: { cid: 'c1', items: [] } },
                        where: { id: '1' },
                    })),
                    makeAction<Nested>('sub-2', { type: 'create', data: { id: '2' } }),
                ];
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: submitted,
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const submittedUuids = new Set(submitted.map(a => a.uuid));
                    for (const outcome of r.result.actions) {
                        expect(submittedUuids.has(outcome.action_uuid)).toBe(true);
                    }
                    // The array_scope failure is reported under its own submitted uuid, never a synthetic `sub-1children`.
                    expect(r.result.actions.some(o => o.action_uuid === 'sub-1')).toBe(true);
                }, implName);
            });
        });

        describe('2.3 WriteChanges', () => {

            test('changes.changed is true when mutations occurred', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });

            test('changes.changed is false when no mutations occurred', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'x' }, where: { id: 'nonexistent' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });

            test('changes.insert/update/remove_keys are correct for mixed-verb batches', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }, { id: '2' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '3' } }),
                        makeAction('a2', { type: 'update', data: { text: 'new' }, where: { id: '1' } }),
                        makeAction('a3', { type: 'delete', where: { id: '2' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.changes.insert).toHaveLength(1);
                    expect(r.changes.insert[0]!.id).toBe('3');
                    expect(r.changes.update).toHaveLength(1);
                    expect(r.changes.update[0]!.id).toBe('1');
                    expect(r.changes.remove_keys).toHaveLength(1);
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });
        });
    });
}
