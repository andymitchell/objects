import { FlatSchema, flatDdl, NestedSchema, nestedDdl, type Nested } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { assertWriteArrayScope } from "../helpers.ts";

/**
 * §14: result & outcome contract.
 *
 * Structural guarantees a caller can rely on regardless of backend: every outcome's `action_uuid` is one
 * that was submitted (no synthetic array_scope uuids leak); an empty batch is a clean success; the whole
 * `WriteResult` stays JSON-serialisable even when the rejected action carried a non-JSON value; and a
 * fully-successful batch yields exactly one outcome per input action.
 */
export function registerResultContract(ctx: SectionCtx): void {
    const { test, expect, createAdapter, implName } = ctx;

    describe('14. Result & outcome contract', () => {

        // T-14.1
        test('every outcome action_uuid is one that was submitted', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const submitted = ['u-a', 'u-b', 'u-c'];
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'old' }, { id: '2' }],
                writeActions: [
                    makeAction('u-a', { type: 'create', data: { id: '3' } }),
                    makeAction('u-b', { type: 'update', data: { text: 'new' }, where: { id: '1' } }),
                    makeAction('u-c', { type: 'delete', where: { id: '2' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                const submittedSet = new Set(submitted);
                for (const outcome of r.result.actions) {
                    expect(submittedSet.has(outcome.action_uuid)).toBe(true);
                }
            }, implName);
        });

        // T-14.2
        test('a failing array_scope batch surfaces no synthetic scope uuids', async () => {
            const adapter = createAdapter(NestedSchema, nestedDdl);
            const submitted = [
                makeAction<Nested>('sub-1', assertWriteArrayScope<Nested, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: { type: 'create', data: { cid: 'c1', items: [] } }, // duplicate cid → fails
                    where: { id: '1' },
                })),
                makeAction<Nested>('sub-2', { type: 'create', data: { id: '2' } }), // blocked
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
                expect(r.result.actions.some(o => o.action_uuid === 'sub-1children')).toBe(false);
            }, implName);
        });

        // T-14.3
        test('an empty batch is a clean success with no changes and no error', async () => {
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
                expect(r.finalItems).toEqual([{ id: '1' }]);
                expect(r.result.error).toBeUndefined();
            }, implName);
        });

        // T-14.4
        test('the result JSON round-trips even when the rejected action carried a non-JSON value', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [makeAction('a1', { type: 'create', data: { id: '1', count: NaN } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(() => JSON.stringify(r.result)).not.toThrow();
                const round = JSON.parse(JSON.stringify(r.result));
                expect(round.actions[0].action_uuid).toBe('a1');
                expect(round.actions[0].ok).toBe(false);
                expect(round.actions[0].errors[0].type).toBe('invalid_data_value');
            }, implName);
        });

        // T-14.5
        test('the result serialises on a schema failure that attached a tested_item', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                // @ts-ignore wilfully assigning a string to a number field
                writeActions: [makeAction('a1', { type: 'update', data: { count: 'not-a-number' }, where: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(() => JSON.stringify(r.result)).not.toThrow();
                const round = JSON.parse(JSON.stringify(r.result));
                expect(round.actions[0].action_uuid).toBe('a1');
                expect(round.actions[0].errors[0].type).toBe('schema');
            }, implName);
        });

        // T-14.6
        test('a fully-successful batch yields exactly one outcome per input action', async () => {
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
                expect(r.result.actions).toHaveLength(3);
            }, implName);
        });
    });
}
