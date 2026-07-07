import { FlatSchema, flatDdl } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteErrors, getWriteFailures } from "../helpers.ts";

/**
 * §7: idempotency & uuid_conflict.
 *
 * The action `uuid` is the unit of idempotency: submitting two actions under the same uuid, or replaying
 * a prior uuid, must be detected — never silently applied twice or silently collapsed. The in-batch
 * contract is documented in types.ts:171-182 ("within a single batch by this library"); cross-call replay
 * belongs to a store's idempotency ledger and is capability-gated.
 *
 * @remarks The reference executor keys outcomes by uuid, so today it COLLAPSES in-batch duplicates and
 * never emits `uuid_conflict`. The 7.1 tests therefore assert the IDEAL contract and are registered as
 * expected-fail-today; they turn green the day the engine implements in-batch conflict detection.
 */
export function registerIdempotency(ctx: SectionCtx): void {
    const { expect, createAdapter, implName, itIfSupported, expectedFailToday } = ctx;

    describe('7. Idempotency & uuid_conflict', () => {

        describe('7.1 In-batch duplicate uuid', () => {

            // T-7.1 [EF]
            expectedFailToday('two actions sharing a uuid but carrying different payloads is a uuid_conflict, committing nothing', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('dup', { type: 'create', data: { id: '1' } }),
                        makeAction('dup', { type: 'create', data: { id: '2' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const conflict = getWriteErrors(r.result).find(e => e.type === 'uuid_conflict' && e.uuid === 'dup');
                    expect(conflict).toBeDefined();
                    const failure = getWriteFailures(r.result).find(f => f.action_uuid === 'dup');
                    expect(failure?.unrecoverable).toBe(true);
                    expect(r.finalItems).toHaveLength(0);
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });

            // T-7.2 [EF]
            expectedFailToday('two actions sharing a uuid AND a deep-equal payload apply exactly once, as a single outcome', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('dup', { type: 'create', data: { id: '1', text: 'x' } }),
                        makeAction('dup', { type: 'create', data: { id: '1', text: 'x' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.result.actions.filter(o => o.action_uuid === 'dup')).toHaveLength(1);
                    expect(r.finalItems).toEqual([{ id: '1', text: 'x' }]);
                }, implName);
            });

            // T-7.3 [EF]
            expectedFailToday('an atomic batch containing a same-uuid conflict rolls the whole batch back', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '9' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('dup', { type: 'update', data: { text: 'p' }, where: { id: '9' } }),
                        makeAction('dup', { type: 'update', data: { text: 'q' }, where: { id: '9' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const conflict = getWriteErrors(r.result).find(e => e.type === 'uuid_conflict' && e.uuid === 'dup');
                    expect(conflict).toBeDefined();
                    expect(r.finalItems).toEqual([{ id: '9' }]);
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });
        });

        describe('7.2 Cross-call replay (idempotency ledger)', () => {

            // T-7.4 — gated: needs a persistent uuid ledger across apply() calls
            itIfSupported('storeUuidIdempotencyLedger')('replaying an identical action under the same uuid is an idempotent no-op success', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const action = makeAction('r1', { type: 'create', data: { id: '1', text: 'x' } });
                const r1 = await adapter.apply({
                    initialItems: [],
                    writeActions: [action],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r1, (call1) => {
                    // replay is asserted below; needs call1 to have committed
                    expect(call1.result.ok).toBe(true);
                }, implName);
                if (r1 === undefined) return;

                const r2 = await adapter.apply({
                    initialItems: r1.finalItems,
                    writeActions: [action],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r2, (call2) => {
                    expect(call2.result.ok).toBe(true);
                    expect(getWriteErrors(call2.result)).toHaveLength(0);
                    expect(call2.finalItems).toEqual([{ id: '1', text: 'x' }]);
                }, implName);
            });

            // T-7.5 — gated
            itIfSupported('storeUuidIdempotencyLedger')('replaying a DIFFERENT payload under a succeeded uuid is a uuid_conflict, state unchanged', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r1 = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('r1', { type: 'create', data: { id: '1', text: 'x' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                if (r1 === undefined) return;

                const r2 = await adapter.apply({
                    initialItems: r1.finalItems,
                    writeActions: [makeAction('r1', { type: 'create', data: { id: '2', text: 'y' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r2, (call2) => {
                    expect(call2.result.ok).toBe(false);
                    const conflict = getWriteErrors(call2.result).find(e => e.type === 'uuid_conflict' && e.uuid === 'r1');
                    expect(conflict).toBeDefined();
                    const failure = getWriteFailures(call2.result).find(f => f.action_uuid === 'r1');
                    expect(failure?.unrecoverable).toBe(true);
                    expect(call2.finalItems).toEqual(r1.finalItems);
                }, implName);
            });
        });
    });
}
