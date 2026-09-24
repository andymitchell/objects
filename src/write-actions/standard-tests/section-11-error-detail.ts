import { FlatSchema, flatDdl, type Flat, NullableFieldsSchema, nullableFieldsDdl, type NullableFields } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteErrors, getWriteFailures, getWriteSuccesses } from "../helpers.ts";

/**
 * §11: error detail.
 *
 * Pins the diagnostic payload an implementation must expose on failure: the offending row's PK value
 * (`item_pk`), the PK field name (`primary_key`), the recoverability flag (`unrecoverable`), the Zod
 * `issues` on schema faults, and the success/failure asymmetry of `affected_items` (a failure locates the row
 * and, unless `payloadFailureAttachesResolvedItem` is declared off, carries the merged item body; a success
 * carries only the PK). All `where` clauses are legitimate — safe for both consumers.
 */
export function registerErrorDetail(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName, itIfSupported } = ctx;

    /**
     * The one scenario §11.4 judges the failure side on: an update writing a string into a number field of
     * row `{ id: '1' }`. Shared by the locator leaf and the resolved-item leaf so the two cannot drift.
     */
    const applyMistypedUpdate = () => createAdapter(FlatSchema, flatDdl).apply({
        initialItems: [{ id: '1' }],
        // @ts-expect-error: wilfully assigning a string to a number field
        writeActions: [makeAction<Flat>('a1', { type: 'update', data: { count: 'not-a-number' }, where: { id: '1' } })],
        schema: FlatSchema,
        ddl: flatDdl,
    });
    /** The row as it stands after the mistyped update is merged into it — what a failure that resolved the row attaches. */
    const MERGED_ROW = { id: '1', count: 'not-a-number' };

    describe('11. Error detail', () => {

        describe('11.1 PK locators', () => {

            // T-11.1
            test('a duplicate-create error carries the offending row PK value and the PK field name', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const err = getWriteErrors(r.result)[0];
                    expect(err?.type).toBe('create_duplicated_key');
                    expect(err?.item_pk).toBe('1');
                    if (err?.type === 'create_duplicated_key') expect(err.primary_key).toBe('id');
                }, implName);
            });

            // T-11.2
            test('a missing-key error names the PK field even with no row to locate', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    // @ts-expect-error: wilfully omitting the primary key
                    writeActions: [makeAction<Flat>('a1', { type: 'create', data: { text: 'no pk' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const err = getWriteErrors(r.result)[0];
                    expect(err?.type).toBe('missing_key');
                    if (err?.type === 'missing_key') expect(err.primary_key).toBe('id');
                }, implName);
            });

            // T-11.3
            test('an altered-key error carries the original row PK value and the PK field name', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: 'changed' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const err = getWriteErrors(r.result)[0];
                    expect(err?.type).toBe('update_altered_key');
                    expect(err?.item_pk).toBe('1');
                    if (err?.type === 'update_altered_key') expect(err.primary_key).toBe('id');
                }, implName);
            });
        });

        describe('11.2 unrecoverable flag', () => {

            // T-11.4
            test('a schema failure is unrecoverable', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    // @ts-expect-error: probing the runtime's response to a create carrying a field the schema does not declare
                    writeActions: [makeAction<Flat>('a1', { type: 'create', data: { id: '1', unknown_field: 'bad' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
                }, implName);
            });

            // T-11.5
            test('a primary-key failure is unrecoverable', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
                }, implName);
            });

            // T-11.6
            test('a custom failure is flagged unrecoverable', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', n: null }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'n', amount: 1, where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const failure = getWriteFailures(r.result)[0];
                    expect(failure?.errors[0]?.type).toBe('custom');
                    expect(failure?.unrecoverable).toBe(true);
                }, implName);
            });

            // T-11.7
            // The engine holds no verdict on an action that never ran; whether the survivors are re-sent is the caller's decision.
            test('a blocked failure names its blocker and is NOT flagged unrecoverable', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }), // fails: duplicate
                        makeAction('a2', { type: 'create', data: { id: '2' } }), // blocked
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const blocked = getWriteFailures(r.result).find(f => f.action_uuid === 'a2');
                    expect(blocked).toBeDefined();
                    expect(blocked!.blocked_by_action_uuid).toBe('a1');
                    expect(blocked!.errors[0]?.type).toBe('blocked');
                    expect(blocked!.unrecoverable).not.toBe(true);
                }, implName);
            });

            // T-11.12 — the flag is a verdict about the rows the engine was given, not a property of the action.
            test('the same inc that is refused unrecoverably over a null field succeeds over a numeric one', async () => {
                const inc = () => makeAction<NullableFields>('a1', { type: 'inc', path: 'n', amount: 1, where: { id: '1' } });

                const refused = await createAdapter(NullableFieldsSchema, nullableFieldsDdl).apply({
                    initialItems: [{ id: '1', n: null }],
                    writeActions: [inc()],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(refused, (r) => {
                    const failure = getWriteFailures(r.result)[0];
                    expect(failure?.errors[0]?.type).toBe('custom');
                    expect(failure?.unrecoverable).toBe(true);
                }, implName);

                const applied = await createAdapter(NullableFieldsSchema, nullableFieldsDdl).apply({
                    initialItems: [{ id: '1', n: 0 }],
                    writeActions: [inc()],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(applied, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]?.n).toBe(1);
                }, implName);
            });
        });

        describe('11.3 schema issues', () => {

            // T-11.8
            test('a field-type schema failure carries Zod issues pointing at the field', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    // @ts-expect-error: wilfully assigning a string to a number field
                    writeActions: [makeAction<Flat>('a1', { type: 'update', data: { count: 'not-a-number' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const err = getWriteErrors(r.result)[0];
                    expect(err?.type).toBe('schema');
                    if (err?.type === 'schema') {
                        expect(err.issues.length).toBeGreaterThan(0);
                        expect(err.issues.some(i => i.path.join('.') === 'count')).toBe(true);
                    }
                }, implName);
            });

            // T-11.9
            test('a strict-unknown-key schema failure carries Zod issues', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    // @ts-expect-error: probing the runtime's response to an unknown key under a strict schema
                    writeActions: [makeAction<Flat>('a1', { type: 'create', data: { id: '1', unknown_field: 'bad' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const err = getWriteErrors(r.result)[0];
                    expect(err?.type).toBe('schema');
                    if (err?.type === 'schema') expect(err.issues.length).toBeGreaterThan(0);
                }, implName);
            });
        });

        describe('11.4 affected_items asymmetry & result.error', () => {

            // T-11.10
            test('failure affected_items locate the offending row (any item they carry is the merged row); success affected_items carry only the PK', async () => {
                // Failure side — the locator is always owed; an attached item, if any, must be the merged row
                const rFail = await applyMistypedUpdate();
                expectOrAcknowledgeUnsupported(rFail, (r) => {
                    const ai = getWriteFailures(r.result)[0]?.affected_items?.[0];
                    expect(ai?.item_pk).toBe('1');
                    if (ai?.item !== undefined) expect(ai.item).toEqual(MERGED_ROW);
                }, implName);

                // Success side — only the PK is exposed
                const adapter2 = createAdapter(FlatSchema, flatDdl);
                const rOk = await adapter2.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'ok' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(rOk, (r) => {
                    const sai = getWriteSuccesses(r.result)[0]?.affected_items?.[0];
                    expect(sai?.item_pk).toBe('1');
                    expect('item' in sai!).toBe(false);
                }, implName);
            });

            // T-11.13 — an implementation that refuses the value before it reads the row has no merged row to
            // attach; it declares `payloadFailureAttachesResolvedItem: false` and this leaf skips visibly.
            itIfSupported('payloadFailureAttachesResolvedItem')('a failure judged from the submitted payload attaches the resolved post-merge item', async () => {
                const rFail = await applyMistypedUpdate();
                expectOrAcknowledgeUnsupported(rFail, (r) => {
                    const ai = getWriteFailures(r.result)[0]?.affected_items?.[0];
                    expect(ai?.item).toEqual(MERGED_ROW);
                }, implName);
            });

            // T-11.11
            test('result.error is present with a message iff the batch failed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const rOk = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(rOk, (r) => {
                    expect(r.result.error).toBeUndefined();
                }, implName);

                const adapter2 = createAdapter(FlatSchema, flatDdl);
                const rFail = await adapter2.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(rFail, (r) => {
                    expect(typeof r.result.error?.message).toBe('string');
                    expect(r.result.error!.message.length).toBeGreaterThan(0);
                }, implName);
            });
        });
    });
}
