import { FlatSchema, flatDdl } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import { getWriteFailures, getWriteSuccesses, getWriteErrors } from "../helpers.ts";

/** §3: schema validation, primary-key integrity, and the getWrite* helpers. */
export function registerErrors(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    describe('3. Error Handling', () => {

        describe('3.1 Schema validation', () => {

            test('create violating schema: ok:false, error type schema, unrecoverable:true', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', {
                        type: 'create',
                        // @ts-ignore wilfully breaking schema
                        data: { id: '1', unknown_field: 'bad' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const failures = getWriteFailures(r.result);
                    expect(failures).toHaveLength(1);
                    expect(failures[0]!.errors[0]!.type).toBe('schema');
                    expect(failures[0]!.unrecoverable).toBe(true);
                }, implName);
            });

            test('update producing schema-invalid result: ok:false, error type schema', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', {
                        type: 'update',
                        // @ts-ignore wilfully breaking schema
                        data: { bad_field: 'oops' },
                        where: { id: '1' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const failures = getWriteFailures(r.result);
                    expect(failures[0]!.errors[0]!.type).toBe('schema');
                }, implName);
            });

            test('error includes item_pk and item context', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', {
                        type: 'update',
                        // @ts-ignore wilfully breaking schema
                        data: { bad_field: 'oops' },
                        where: { id: '1' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const failure = getWriteFailures(r.result)[0]!;
                    expect(failure.affected_items).toBeDefined();
                    expect(failure.affected_items!.length).toBeGreaterThanOrEqual(1);
                }, implName);
            });
        });

        describe('3.2 Primary key integrity', () => {

            test('create with duplicate PK: error type create_duplicated_key', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const errors = getWriteErrors(r.result);
                    expect(errors[0]!.type).toBe('create_duplicated_key');
                }, implName);
            });

            test('create missing PK: error type missing_key', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', {
                        type: 'create',
                        // @ts-ignore missing id
                        data: { text: 'no pk' },
                    })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const errors = getWriteErrors(r.result);
                    expect(errors[0]!.type).toBe('missing_key');
                }, implName);
            });

            test('update that changes PK: error type update_altered_key', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: 'changed' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const errors = getWriteErrors(r.result);
                    expect(errors[0]!.type).toBe('update_altered_key');
                }, implName);
            });
        });

        describe('3.3 Helpers', () => {

            test('getWriteFailures returns only failed outcomes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const failures = getWriteFailures(r.result);
                    failures.forEach(f => expect(f.ok).toBe(false));
                }, implName);
            });

            test('getWriteSuccesses returns only successful outcomes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: false },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const successes = getWriteSuccesses(r.result);
                    expect(successes).toHaveLength(1);
                    successes.forEach(s => expect(s.ok).toBe(true));
                }, implName);
            });

            test('getWriteErrors returns flat array of all errors across outcomes', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '1' } }), // duplicate
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const errors = getWriteErrors(r.result);
                    expect(errors.length).toBeGreaterThanOrEqual(1);
                    expect(errors[0]!.type).toBe('create_duplicated_key');
                }, implName);
            });
        });
    });
}
