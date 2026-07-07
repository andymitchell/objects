import { FlatSchema, flatDdl } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteErrors } from "../helpers.ts";

/** §6: attempt_recover_duplicate_create modes — never / if-convergent / always-update. */
export function registerDuplicateCreate(ctx: SectionCtx): void {
    const { test, expect, createAdapter, implName, itIfSupported } = ctx;

    describe('6. Duplicate Create Recovery', () => {

        describe('6.1 never (default)', () => {

            test('duplicate PK always fails', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'never' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteErrors(r.result)[0]!.type).toBe('create_duplicated_key');
                }, implName);
            });
        });

        describe('6.2 if-convergent', () => {

            itIfSupported('duplicateCreateRecovery')('recovers when create data is subset of existing item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'hello' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'if-convergent' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('hello'); // unchanged
                }, implName, 'if-convergent recovery');
            });

            itIfSupported('duplicateCreateRecovery')('fails when create data contradicts existing item', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'existing' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: 'different' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'if-convergent' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems[0]!.text).toBe('existing');
                }, implName, 'if-convergent contradiction');
            });

            itIfSupported('duplicateCreateRecovery')('recovers when subsequent actions in batch bring items to convergence', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'target' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1', text: 'wrong' } }),
                        makeAction('a2', { type: 'update', data: { text: 'target' }, where: { id: '1' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'if-convergent' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                }, implName, 'if-convergent convergence');
            });
        });

        describe('6.3 always-update', () => {

            itIfSupported('duplicateCreateRecovery')('converts duplicate create to update, succeeds', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'old' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: 'new' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { attempt_recover_duplicate_create: 'always-update' },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.text).toBe('new');
                }, implName, 'always-update recovery');
            });
        });
    });
}
