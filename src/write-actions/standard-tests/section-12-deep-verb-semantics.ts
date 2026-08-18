import {
    FlatSchema, flatDdl, type Flat,
    FlatWithSubItemsSchema, flatWithSubItemsDdl, type FlatWithSubItems,
    NestedSchema, nestedDdl, type Nested,
    NestedObjSchema, nestedObjDdl, type NestedObj,
    DeepSetSchema, deepSetDdl,
    NullableFieldsSchema, nullableFieldsDdl, type NullableFields,
    MatchSchema, matchDdl, type Match,
    NumericPkSchema, numericPkDdl,
} from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, resolveCapability, type SectionCtx } from "./harness.ts";
import { assertWriteArrayScope, getWriteErrors, getWriteFailures, getWriteSuccesses } from "../helpers.ts";

/**
 * §12: deep verb semantics.
 *
 * The fine-grained mutation rules every implementation must reproduce identically: an explicit `undefined`
 * in written data is refused while `null` is kept; merge deep-merges objects but replaces arrays wholesale,
 * whereas assign replaces wholesale; add_to_set's deep-equal treats `undefined`≡missing but `null`≠`undefined` and is
 * array-order-sensitive; pull never initialises a missing field; a row's primary key is never writable,
 * whether an update names it in `data` or a path verb aims at it; and several pinned quirks (dirty-on-
 * no-change for update/array_scope, no-op short-circuit for push/inc/add_to_set, falsy-PK-as-missing).
 */
export function registerDeepVerbSemantics(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName, itIfSupported } = ctx;

    // Engine-report observability pins (12.12): a value-diff-reconstructing adapter cannot observe a no-op
    // dirty mark, so those pins register as a visible skip there.
    const itEngineReport = resolveCapability(ctx.capabilities, 'reconstructsOutcomes') ? ctx.test.skip : ctx.test;

    describe('12. Deep verb semantics', () => {

        describe('12.1 an explicit undefined is rejected, null is kept', () => {

            /** Assert the whole batch was rejected as `invalid_data_value`/`malformed` at `dataPath`, unrecoverably, leaving state as `checkFinal` expects. */
            const expectUndefinedRejected = <T extends Record<string, any>>(
                r: Awaited<ReturnType<ReturnType<typeof createAdapter<T>>['apply']>>,
                dataPath: string,
                checkFinal: (finalItems: T[]) => void,
                skipNote?: string,
            ): void => expectOrAcknowledgeUnsupported(r, (r) => {
                expect(r.result.ok).toBe(false);
                const err = getWriteErrors(r.result)[0];
                expect(err?.type).toBe('invalid_data_value');
                if (err && err.type === 'invalid_data_value') {
                    expect(err.reason).toBe('malformed');
                    expect(err.data_path).toBe(dataPath);
                }
                expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
                checkFinal(r.finalItems);
            }, implName, skipNote);

            // T-12.1
            test('a top-level undefined under merge is rejected, and the field keeps its value', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', note: 'x' }],
                    // The field's own type admits `undefined`, so this compiles — the runtime value gate is what refuses it
                    writeActions: [makeAction<NestedObj>('a1', { type: 'update', data: { note: undefined }, where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectUndefinedRejected(r, 'note', (f) => {
                    expect(f[0]).toEqual({ id: '1', note: 'x' });
                    expect('note' in f[0]!).toBe(true);
                });
            });

            // T-12.2
            test('a nested undefined under merge is rejected at its full path, leaving the whole object alone', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', meta: { a: 'x', b: 'y' } }],
                    writeActions: [makeAction('a1', { type: 'update', data: { meta: { a: undefined } }, where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectUndefinedRejected(r, 'meta.a', (f) => expect(f[0]!.meta).toEqual({ a: 'x', b: 'y' }));
            });

            // T-12.3 (assign)
            itIfSupported('assignMethod')('the rejection does not depend on the update method — assign is refused the same way', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', meta: { a: 'seed' } }],
                    writeActions: [makeAction('a1', { type: 'update', data: { meta: { b: undefined, a: 'x' } }, where: { id: '1' }, method: 'assign' })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                // `a: 'x'` would have landed had the action run at all, so the seed value proves nothing was applied.
                expectUndefinedRejected(r, 'meta.b', (f) => expect(f[0]!.meta).toEqual({ a: 'seed' }), 'assign update method');
            });

            // T-12.4
            test('null is kept at the top level (not treated as a delete)', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', note: 'x' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { note: null }, where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.note).toBe(null);
                    expect('note' in r.finalItems[0]!).toBe(true);
                }, implName);
            });

            // T-12.5
            test('null is kept nested', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', meta: { a: 'x' } }],
                    writeActions: [makeAction('a1', { type: 'update', data: { meta: { a: null } }, where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.meta!.a).toBe(null);
                }, implName);
            });
        });

        describe('12.2 assign vs merge divergence', () => {

            // T-12.6
            test('merge deep-merges a nested object, preserving unmentioned siblings', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', meta: { a: 'old', b: 'keep' } }],
                    writeActions: [makeAction('a1', { type: 'update', data: { meta: { a: 'new' } }, where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.meta).toEqual({ a: 'new', b: 'keep' });
                }, implName);
            });

            // T-12.7 (assign)
            itIfSupported('assignMethod')('assign replaces a nested object wholesale, losing unmentioned siblings', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', meta: { a: 'old', b: 'keep' } }],
                    writeActions: [makeAction('a1', { type: 'update', data: { meta: { a: 'new' } }, where: { id: '1' }, method: 'assign' })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.meta).toEqual({ a: 'new' });
                }, implName, 'assign update method');
            });
        });

        describe('12.3 arrays & primary keys under update', () => {

            // T-12.8 (scalarArrayUpdate)
            itIfSupported('scalarArrayUpdate')('merge replaces a scalar array wholesale rather than concatenating', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b', 'c'] }],
                    writeActions: [makeAction('a1', { type: 'update', data: { tags: ['z'] }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['z']);
                }, implName, 'scalar array update');
            });

            // T-12.9
            test('setting the primary key to its own value succeeds (not an altered key)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'a' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: '1', text: 'b' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]).toEqual({ id: '1', text: 'b' });
                    expect(getWriteErrors(r.result).some(e => e.type === 'update_altered_key')).toBe(false);
                }, implName);
            });

            // T-12.35
            test('setting the primary key to a falsy value is an altered key, not a crash', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'a' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: '' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteErrors(r.result)[0]?.type).toBe('update_altered_key');
                    expect(r.finalItems).toEqual([{ id: '1', text: 'a' }]);
                }, implName);
            });

            // T-12.36 — the same falsy value is judged differently on create (T-12.34): there the payload IS the
            // item and carries no usable locator, so it is `missing_key`; here the row already has a key, and
            // naming any other value in `data` is an attempted change to it.
            test('a falsy numeric primary key on update is an altered key, not a missing key', async () => {
                const adapter = createAdapter(NumericPkSchema, numericPkDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 5, text: 'ok' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { id: 0 }, where: { id: 5 } })],
                    schema: NumericPkSchema,
                    ddl: numericPkDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteErrors(r.result)[0]?.type).toBe('update_altered_key');
                    expect(r.finalItems).toEqual([{ id: 5, text: 'ok' }]);
                }, implName);
            });
        });

        describe('12.5 add_to_set deep_equals nuances', () => {

            // T-12.10
            test('deep_equals treats undefined as equal to a missing key, so the item is not added', async () => {
                const adapter = createAdapter(DeepSetSchema, deepSetDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', entries: [{ k: 'a' }] }],
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'entries', items: [{ k: 'a', n: undefined }], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: DeepSetSchema,
                    ddl: deepSetDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.entries).toHaveLength(1);
                }, implName);
            });

            // T-12.11
            test('deep_equals treats null as distinct from undefined, so the item is added', async () => {
                const adapter = createAdapter(DeepSetSchema, deepSetDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', entries: [{ k: 'a', n: null }] }],
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'entries', items: [{ k: 'a', n: undefined }], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: DeepSetSchema,
                    ddl: deepSetDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.entries).toHaveLength(2);
                }, implName);
            });

            // T-12.12
            test('deep_equals is array-order-sensitive, so a reordered nested array is added', async () => {
                const adapter = createAdapter(DeepSetSchema, deepSetDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', entries: [{ k: 'a', seq: [1, 2] }] }],
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'entries', items: [{ k: 'a', seq: [2, 1] }], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: DeepSetSchema,
                    ddl: deepSetDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.entries).toHaveLength(2);
                }, implName);
            });

            // T-12.13: no test — NaN≡NaN dedupe is unreachable at the adapter surface because the value gate
            // rejects NaN items first (see §10 T-10.10). Documented here so the gap is intentional, not missed.
        });

        describe('12.6 add_to_set pk-mode', () => {

            // T-12.14
            test('pk-mode dedupes within the incoming batch, first occurrence winning', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [] }],
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'sub_items', items: [{ sid: 's1', val: 1 }, { sid: 's1', val: 2 }], unique_by: 'pk', where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.sub_items).toHaveLength(1);
                    expect(r.finalItems[0]!.sub_items![0]!.val).toBe(1);
                }, implName);
            });

            // T-12.15
            test('pk-mode on a scalar array is a recoverable custom error, leaving the array untouched', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    // A string has no key to be unique by, so the payload type does not offer `pk` here. The
                    // suppression writes the action anyway, standing in for an untyped caller — the engine has
                    // to rule on the pairing whether or not a type screened it out first, and it must do so
                    // recoverably, leaving the array as it was.
                    // @ts-expect-error: 'pk' is not offered on a scalar array
                    writeActions: [makeAction<Flat>('a1', { type: 'add_to_set', path: 'tags', items: ['b'], unique_by: 'pk', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                    expect(getWriteFailures(r.result)[0]?.unrecoverable).not.toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a']);
                }, implName);
            });

            // T-12.16
            test('pk-mode with an item missing its pk field is a custom error, leaving the array untouched', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }],
                    // @ts-expect-error: item is missing its pk field — asserting the engine rejects it
                    writeActions: [makeAction<FlatWithSubItems>('a1', { type: 'add_to_set', path: 'sub_items', items: [{ val: 5 }], unique_by: 'pk', where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                    expect(r.finalItems[0]!.sub_items).toEqual([{ sid: 's1', val: 1 }]);
                }, implName);
            });
        });

        describe('12.7 array/number verbs on a null field are custom errors', () => {

            // T-12.17
            test('add_to_set on a null array field is a custom error', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: null }],
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'tags', items: ['x'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                    expect(r.finalItems[0]!.tags).toBe(null);
                }, implName);
            });

            // T-12.18
            test('push on a null array field is a custom error', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: null }],
                    writeActions: [makeAction('a1', { type: 'push', path: 'tags', items: ['x'], where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                    expect(r.finalItems[0]!.tags).toBe(null);
                }, implName);
            });

            // T-12.19
            test('pull on a null array field is a custom error', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: null }],
                    writeActions: [makeAction('a1', { type: 'pull', path: 'tags', items_where: ['x'], where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                    expect(r.finalItems[0]!.tags).toBe(null);
                }, implName);
            });

            // T-12.20
            test('inc on a null number field is a custom error', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', n: null }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'n', amount: 1, where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                    expect(r.finalItems[0]!.n).toBe(null);
                }, implName);
            });
        });

        describe('12.8 inc on a non-numeric current value is a custom error', () => {

            // T-12.21 — NaN field (a valid number, no cast). Contrast T-10.12: a NaN AMOUNT is invalid_data_value.
            test('inc on a NaN-valued field is a custom error', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', n: NaN }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'n', amount: 5, where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                }, implName);
            });

            // T-12.22 — the ONE justified cast in the suite: simulates a CORRUPT stored value (a string where a
            // number is declared). No legitimate write could produce this, so the seed must bypass the type.
            test('inc on a string-valued field is a custom error', async () => {
                const adapter = createAdapter(NullableFieldsSchema, nullableFieldsDdl);
                const corrupt = { id: '1', n: 'x' } as unknown as NullableFields;
                const r = await adapter.apply({
                    initialItems: [corrupt],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'n', amount: 1, where: { id: '1' } })],
                    schema: NullableFieldsSchema,
                    ddl: nullableFieldsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result)[0]?.errors[0]?.type).toBe('custom');
                }, implName);
            });
        });

        describe('12.9 pull no-op subtleties', () => {

            // T-12.23
            test('pull on an undefined field does not initialise it (asymmetry with push/add_to_set)', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction('a1', { type: 'pull', path: 'sub_items', items_where: { sid: 'x' }, where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect('sub_items' in r.finalItems[0]!).toBe(false);
                }, implName);
            });

            // T-12.24
            test('an object items_where on a scalar array matches nothing and is a no-op', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    // @ts-expect-error: feeding an object where a scalar value-list is expected — asserting it is a harmless no-op
                    writeActions: [makeAction<Match>('a1', { type: 'pull', path: 'tags', items_where: { foo: 'bar' }, where: { id: '1' } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['a', 'b']);
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });
        });

        describe('12.10 array_scope wraps verbs it never natively wraps', () => {

            // T-12.25
            test('array_scope wraps add_to_set (deep_equals) in a nested array', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 1 }] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'add_to_set', path: 'items', items: [{ iid: 'i2', value: 2 }], unique_by: 'deep_equals', where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const items = r.finalItems[0]!.children![0]!.items;
                    expect(items).toHaveLength(2);
                    expect(items.some(i => i.iid === 'i2')).toBe(true);
                }, implName);
            });

            // T-12.26
            test('array_scope wraps add_to_set (pk-mode) — an existing pk is skipped, not replaced', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 1 }] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'add_to_set', path: 'items', items: [{ iid: 'i1', value: 99 }], unique_by: 'pk', where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const items = r.finalItems[0]!.children![0]!.items;
                    expect(items).toHaveLength(1);
                    expect(items[0]!.value).toBe(1);
                }, implName);
            });

            // T-12.27
            test('array_scope wraps pull in a nested array', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 1 }, { iid: 'i2', value: 2 }] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'pull', path: 'items', items_where: { iid: 'i1' }, where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const items = r.finalItems[0]!.children![0]!.items;
                    expect(items).toHaveLength(1);
                    expect(items[0]!.iid).toBe('i2');
                }, implName);
            });

            // T-12.28 (assign)
            itIfSupported('assignMethod')('array_scope wraps an assign-method update', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', label: 'old', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'update', data: { label: 'new' }, where: { cid: 'c1' }, method: 'assign' },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children![0]!.label).toBe('new');
                    expect(r.finalItems[0]!.children![0]!.cid).toBe('c1');
                }, implName, 'assign update method');
            });
        });

        describe('12.11 two-level spread scope', () => {

            // T-12.29
            test('a two-level spread scope updates the leaf of every matching parent', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', name: 'target', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 1 }] }] },
                        { id: '2', name: 'target', children: [{ cid: 'c2', items: [{ iid: 'i2', value: 2 }] }] },
                    ],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children.items'>({
                        type: 'array_scope',
                        scope: 'children.items',
                        action: { type: 'update', data: { value: 99 }, where: {} },
                        where: { name: 'target' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.children![0]!.items[0]!.value).toBe(99);
                    expect(r.finalItems[1]!.children![0]!.items[0]!.value).toBe(99);
                }, implName);
            });
        });

        describe('12.12 pinned quirks (value-observable)', () => {

            // T-12.30 [PIN] — update has no no-op short-circuit
            itEngineReport('update marks a matched row dirty even when the written value is identical', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'same' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'same' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.changes.update).toHaveLength(1);
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });

            // T-12.31 [PIN] — array_scope always dirties matched parents
            itEngineReport('array_scope marks a matched parent dirty even when the sub-action is a no-op', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', assertWriteArrayScope<Nested, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: { type: 'pull', path: 'items', items_where: { iid: 'nonexistent' }, where: { cid: 'c1' } },
                        where: { id: '1' },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.changes.update).toHaveLength(1);
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });

            // T-12.32 [PIN] — push/inc/add_to_set genuine no-ops short-circuit
            test('genuine no-ops on push/inc/add_to_set leave changed === false', async () => {
                const push = createAdapter(FlatSchema, flatDdl);
                const rPush = await push.apply({
                    initialItems: [{ id: '1', tags: ['a'] }],
                    writeActions: [makeAction('a1', { type: 'push', path: 'tags', items: [], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(rPush, (r) => expect(r.changes.changed).toBe(false), implName);

                const inc = createAdapter(FlatSchema, flatDdl);
                const rInc = await inc.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'count', amount: 0, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(rInc, (r) => expect(r.changes.changed).toBe(false), implName);

                const ats = createAdapter(FlatSchema, flatDdl);
                const rAts = await ats.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'tags', items: ['a', 'b'], unique_by: 'deep_equals', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(rAts, (r) => expect(r.changes.changed).toBe(false), implName);
            });

            // T-12.33 [PIN] — affected_items report matched rows, not just changed rows
            itEngineReport('a matched-but-unchanged row is still reported in affected_items', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 10 }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'count', amount: 0, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const success = getWriteSuccesses(r.result)[0];
                    expect(success?.affected_items?.some(ai => ai.item_pk === '1')).toBe(true);
                }, implName);
            });

            // T-12.34 [PIN + documented surprise] — a falsy PK (0) on create is treated as missing_key.
            // NEVER seed a falsy PK via initialItems (safeKeyValue throws building the existing-id set).
            test('a falsy numeric primary key on create is rejected as a missing key', async () => {
                const adapter = createAdapter(NumericPkSchema, numericPkDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: 5, text: 'ok' } }),
                        makeAction('a2', { type: 'create', data: { id: 0, text: 'zero' } }),
                    ],
                    schema: NumericPkSchema,
                    ddl: numericPkDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result).find(f => f.action_uuid === 'a2')?.errors[0]?.type).toBe('missing_key');
                    expect(r.finalItems).toHaveLength(1);
                    expect(r.finalItems[0]!.id).toBe(5);
                }, implName);
            });
        });

        describe('12.13 primary-key integrity under path verbs', () => {

            // T-12.37
            test('a path verb naming the primary key is refused before any item is matched', async () => {
                const adapter = createAdapter(NumericPkSchema, numericPkDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 5, text: 'ok' }],
                    writeActions: [makeAction('a1', { type: 'inc', path: 'id', amount: 1, where: { id: 999 } })],
                    schema: NumericPkSchema,
                    ddl: numericPkDdl,
                });
                // The key locates the row for the rest of the batch and for the caller after it, so aiming a
                // verb at it is a fault in the action itself — answered whether or not the where reaches a row.
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    const err = getWriteErrors(r.result)[0];
                    expect(err?.type).toBe('invalid_property_path');
                    if (err && err.type === 'invalid_property_path') expect(err.reason).toBe('primary_key');
                    expect(r.finalItems).toEqual([{ id: 5, text: 'ok' }]);
                }, implName);
            });
        });
    });
}
