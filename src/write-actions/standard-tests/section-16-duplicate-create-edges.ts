import { FlatSchema, flatDdl } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteSuccesses, getWriteErrors } from "../helpers.ts";

/**
 * §16: duplicate-create recovery edges.
 *
 * Deeper cases of `attempt_recover_duplicate_create` than §6: `always-update` must MERGE the create's
 * data under the create's own uuid (preserving unmentioned fields); `if-convergent` uses lodash `isMatch`
 * SUBSET semantics (a bare `{id}` converges against a richer row, a contradicting field does not) and can
 * be rescued by a later batch action that brings the row to convergence. Gated on `duplicateCreateRecovery`.
 */
export function registerDuplicateCreateEdges(ctx: SectionCtx): void {
    const { describe, expect, createAdapter, implName, itIfSupported } = ctx;
    const itRecovery = itIfSupported('duplicateCreateRecovery');

    describe('16. Duplicate-create recovery edges', () => {

        // T-16.1
        itRecovery('always-update converts a duplicate create into a merge under the create uuid', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'old', count: 7 }],
                writeActions: [makeAction('c1', { type: 'create', data: { id: '1', text: 'new' } })],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { attempt_recover_duplicate_create: 'always-update' },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]).toEqual({ id: '1', text: 'new', count: 7 });
                expect(getWriteSuccesses(r.result).some(s => s.action_uuid === 'c1')).toBe(true);
            }, implName, 'duplicate-create recovery');
        });

        // T-16.2
        itRecovery('if-convergent treats a bare {id} create as convergent against a richer existing row', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'hello', count: 3 }],
                writeActions: [makeAction('c1', { type: 'create', data: { id: '1' } })],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { attempt_recover_duplicate_create: 'if-convergent' },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]).toEqual({ id: '1', text: 'hello', count: 3 });
            }, implName, 'duplicate-create recovery');
        });

        // T-16.3
        itRecovery('if-convergent rejects a create whose field contradicts the existing row', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'existing' }],
                writeActions: [makeAction('c1', { type: 'create', data: { id: '1', text: 'different' } })],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { attempt_recover_duplicate_create: 'if-convergent' },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                expect(getWriteErrors(r.result)[0]?.type).toBe('create_duplicated_key');
                expect(r.finalItems[0]!.text).toBe('existing');
            }, implName, 'duplicate-create recovery');
        });

        // T-16.4
        itRecovery('if-convergent is rescued when a later batch action brings the row to convergence', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [{ id: '1', text: 'target' }],
                writeActions: [
                    makeAction('c1', { type: 'create', data: { id: '1', text: 'wrong' } }),
                    makeAction('u1', { type: 'update', data: { text: 'target' }, where: { id: '1' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
                options: { attempt_recover_duplicate_create: 'if-convergent' },
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('target');
            }, implName, 'duplicate-create recovery');
        });
    });
}
