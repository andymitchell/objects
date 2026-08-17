import { FlatSchema, flatDdl, FlatWithSubItemsSchema, flatWithSubItemsDdl, type Flat, type FlatWithSubItems } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx, type WriteTestAdapterResult } from "./harness.ts";
import { getWriteErrors, getWriteFailures } from "../helpers.ts";

/**
 * §10: invalid_data_value rejection.
 *
 * A written *value* that cannot losslessly round-trip JSON — a non-finite number (`NaN`/`±Infinity`), a
 * non-JSON carrier (`bigint`/`Date`/`Map`/`Set`/`function`), or an explicit `undefined` in a create's or
 * update's data — must be caught BEFORE any mutation, so the whole action is rejected unrecoverably and state
 * is untouched. This is distinct from a Zod `schema` violation: the value gate runs even for values a loose
 * schema would accept.
 *
 * Safe for the validate-where-sync consumer: every `where` here is legitimate; only the *data* is invalid.
 */
export function registerInvalidDataValue(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    /** Assert the batch was rejected with `invalid_data_value` (reason + optional data_path), unrecoverably, and left state as `checkFinal` expects. */
    const expectRejectedUnchanged = <T extends Record<string, any>>(
        r: WriteTestAdapterResult<T>,
        reason: 'non_finite' | 'malformed',
        dataPath: string | undefined,
        checkFinal: (finalItems: T[]) => void,
    ): void => expectOrAcknowledgeUnsupported(r, (r) => {
        expect(r.result.ok).toBe(false);
        const err = getWriteErrors(r.result)[0];
        expect(err?.type).toBe('invalid_data_value');
        if (err && err.type === 'invalid_data_value') {
            expect(err.reason).toBe(reason);
            if (dataPath !== undefined) expect(err.data_path).toBe(dataPath);
        }
        expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
        checkFinal(r.finalItems);
    }, implName);

    describe('10. Invalid data value rejection', () => {

        describe('10.1 create data', () => {

            // T-10.1
            test('NaN in create data is non_finite', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', count: NaN } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'count', (f) => expect(f).toHaveLength(0));
            });

            // T-10.2
            test('+Infinity in create data is non_finite', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', count: Infinity } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'count', (f) => expect(f).toHaveLength(0));
            });

            // T-10.3
            test('-Infinity in create data is non_finite', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', count: -Infinity } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'count', (f) => expect(f).toHaveLength(0));
            });

            // T-10.4
            test('a bigint in create data is malformed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    // @ts-ignore wilfully injecting a bigint (non-JSON) into a number field
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '1', count: 5n } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'malformed', 'count', (f) => expect(f).toHaveLength(0));
            });

            // T-10.5
            test('non-JSON carriers (Date/Map/Set/function) in create data are malformed', async () => {
                const carriers: unknown[] = [new Date(), new Map(), new Set(), () => { /* noop */ }];
                for (const carrier of carriers) {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [],
                        // @ts-ignore wilfully injecting a non-JSON carrier into a string field
                        writeActions: [makeAction('a1', { type: 'create', data: { id: '1', text: carrier } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectRejectedUnchanged(r, 'malformed', 'text', (f) => expect(f).toHaveLength(0));
                }
            });

            // T-10.6
            test('a non-finite value nested in a create sub-array is non_finite with a nested data_path', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'create', data: { id: '1', sub_items: [{ sid: 's1', val: NaN }] } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'sub_items.0.val', (f) => expect(f).toHaveLength(0));
            });
        });

        describe('10.2 update data', () => {

            // T-10.7
            test('NaN in update data is non_finite and leaves the row untouched', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 1 }],
                    writeActions: [makeAction('a1', { type: 'update', data: { count: NaN }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'count', (f) => expect(f).toEqual([{ id: '1', count: 1 }]));
            });

            // T-10.8
            test('a Date in update data is malformed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    // @ts-ignore wilfully injecting a Date (non-JSON) into a string field
                    writeActions: [makeAction('a1', { type: 'update', data: { text: new Date() }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'malformed', 'text', (f) => expect(f).toEqual([{ id: '1' }]));
            });
        });

        describe('10.3 array-append verbs', () => {

            // T-10.9
            test('a non-finite item in a push is non_finite at its index, leaving the array untouched', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    // @ts-ignore wilfully pushing a non-finite number into a string array
                    writeActions: [makeAction('a1', { type: 'push', path: 'tags', items: ['b', Infinity], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'tags.1', (f) => expect(f[0]!.tags).toEqual(['a']));
            });

            // T-10.10
            test('NaN in an add_to_set is non_finite', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    // @ts-ignore wilfully adding a non-finite number into a string array
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'tags', items: [NaN], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'tags.0', (f) => expect(f[0]!.tags).toEqual(['a']));
            });

            // T-10.11
            test('a bigint in an add_to_set is malformed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    // @ts-ignore wilfully adding a bigint (non-JSON) into a string array
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'tags', items: [5n], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'malformed', 'tags.0', (f) => expect(f[0]!.tags).toEqual(['a']));
            });
        });

        describe('10.4 inc amount', () => {

            // T-10.12 (replaces the weak §1.8 "NaN amount: error"). data_path pinned from observed engine output.
            test('a NaN inc amount is invalid_data_value/non_finite and leaves the field untouched', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'count', amount: NaN, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'count', (f) => expect(f[0]!.count).toBe(10));
            });

            // T-10.13
            test('a +Infinity inc amount is non_finite', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'count', amount: Infinity, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'non_finite', 'count', (f) => expect(f[0]!.count).toBe(10));
            });
        });

        describe('10.5 an explicit undefined value', () => {

            // T-10.14
            test('undefined in update data is malformed, and the field it named keeps its value', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'x', count: 5 }],
                    // @ts-expect-error: probing the runtime's response to the `undefined` the payload type refuses
                    writeActions: [makeAction<Flat>('a1', { type: 'update', data: { text: undefined }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectRejectedUnchanged(r, 'malformed', 'text', (f) => {
                    expect(f[0]).toEqual({ id: '1', text: 'x', count: 5 });
                    expect('text' in f[0]!).toBe(true);
                });
            });

            // T-10.15
            test('undefined nested in create data is malformed at its full path, and nothing is created', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'create', data: { id: '1', sub_items: [{ sid: 's1', val: undefined }] } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectRejectedUnchanged(r, 'malformed', 'sub_items.0.val', (f) => expect(f).toHaveLength(0));
            });
        });
    });
}
