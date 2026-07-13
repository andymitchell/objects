import type { WriteAction } from "../types.ts";
import { FlatSchema, flatDdl, type Flat } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";

/** §8: cross-verb regression scenarios — PK re-use, same-batch create+update, large batches. */
export function registerEdgeRegression(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    describe('8. Edge Cases & Regression', () => {

        test('delete → create → delete → create on same PK works', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1', text: 'first' } }),
                    makeAction('a2', { type: 'delete', where: { id: '1' } }),
                    makeAction('a3', { type: 'create', data: { id: '1', text: 'second' } }),
                    makeAction('a4', { type: 'delete', where: { id: '1' } }),
                    makeAction('a5', { type: 'create', data: { id: '1', text: 'final' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(1);
                expect(r.finalItems[0]!.text).toBe('final');
            }, implName);
        });

        test('create + update in same batch targeting same PK: both succeed sequentially', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const r = await adapter.apply({
                initialItems: [],
                writeActions: [
                    makeAction('a1', { type: 'create', data: { id: '1', text: 'initial' } }),
                    makeAction('a2', { type: 'update', data: { text: 'modified' }, where: { id: '1' } }),
                ],
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems[0]!.text).toBe('modified');
            }, implName);
        });

        test('many actions in one batch (10+): all processed correctly', async () => {
            const adapter = createAdapter(FlatSchema, flatDdl);
            const actions: WriteAction<Flat>[] = Array.from({ length: 12 }, (_, i) =>
                makeAction(`a${i}`, { type: 'create', data: { id: `item-${i}` } })
            );
            const r = await adapter.apply({
                initialItems: [],
                writeActions: actions,
                schema: FlatSchema,
                ddl: flatDdl,
            });
            expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(true);
                expect(r.finalItems).toHaveLength(12);
                expect(r.result.actions).toHaveLength(12);
            }, implName);
        });
    });
}
