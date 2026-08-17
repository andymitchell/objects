import { FlatSchema, flatDdl, type Flat } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteFailures, getWriteSuccesses } from "../helpers.ts";

/** §4: first failure halts the batch; later actions are blocked; prior successes stand (non-atomic). */
export function registerHaltBlocking(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    describe('4. Sequential Halt & Blocking', () => {

        test('first failure halts processing of subsequent actions', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1' } }), // fails: duplicate
                    makeAction('a2', { type: 'create', data: { id: '2' } }), // should be blocked
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                expect(r.finalItems.find(x => x.id === '2')).toBeUndefined();
            }, implName);
        });

        test('subsequent actions get ok:false with blocked_by_action_uuid set', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1' }],
                writeActions: [
                    makeAction('fail-uuid', { type: 'create', data: { id: '1' } }), // fails
                    makeAction('blocked-uuid', { type: 'create', data: { id: '2' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                const failures = getWriteFailures(r.result);
                const blocked = failures.find(f => f.action_uuid === 'blocked-uuid');
                expect(blocked).toBeDefined();
                expect(blocked!.blocked_by_action_uuid).toBe('fail-uuid');
            }, implName);
        });

        test('successful actions before the failure are reported as successes (non-atomic)', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1' } }), // succeeds
                    makeAction<Flat>('a2', {
                        type: 'create',
                        // @ts-expect-error: probing the runtime's response to a create with no primary key
                        data: { text: 'no pk' },
                    }), // fails
                    makeAction('a3', { type: 'create', data: { id: '3' } }), // blocked
                ],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { atomic: false },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                const successes = getWriteSuccesses(r.result);
                expect(successes).toHaveLength(1);
                expect(successes[0]!.action_uuid).toBe('a1');
                expect(r.finalItems.find(x => x.id === '1')).toBeDefined();
            }, implName);
        });
    });
}
