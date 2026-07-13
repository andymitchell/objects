import type { WriteAction } from "../types.ts";
import type { WhereFilterDefinition } from "../../where-filter/index.ts";
import {
    FlatSchema, flatDdl, type Flat,
    NestedSchema, nestedDdl, type Nested,
    FlatWithSubItemsSchema, flatWithSubItemsDdl, type FlatWithSubItems,
} from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx, type WriteTestAdapterResult } from "./harness.ts";
import { getWriteErrors, getWriteFailures } from "../helpers.ts";

/**
 * §9: portable invalid_filter rejection.
 *
 * A write's `where` (and a pull's `items_where`) is held to the same standard as the written data: it must
 * reference real fields, carry type-correct, JSON-serialisable operands, and be structurally sound — even
 * for operands the bare schema walk would wave through ($ne/$lt broaden), because the engine runs the where
 * gate in `requireSerialisableJsonSubset` mode. An invalid filter is caught BEFORE any mutation (unrecoverable,
 * state untouched) and never throws, even when the operand would make the matcher throw at match time.
 *
 * The ENTIRE section is gated on `invalidWhereCorpus` (default OFF) so the validate-where-sync consumer —
 * which throws on any invalid_filter — skips it. Ported from writeToItemsArray.invalid-filter.test.ts to
 * the adapter surface, with `age`→`count` for FlatSchema.
 */
export function registerInvalidFilter(ctx: SectionCtx): void {
    const { describe, expect, createAdapter, implName, itIfSupported } = ctx;
    const itCorpus = itIfSupported('invalidWhereCorpus');

    // Deliberately-invalid wheres/payloads are not type-valid; cast at the single sanctioned boundary.
    const asWhere = <T extends Record<string, any>>(w: unknown): WhereFilterDefinition<T> => w as WhereFilterDefinition<T>;
    const scopePayload = <T extends Record<string, any>>(p: unknown): WriteAction<T>['payload'] => p as WriteAction<T>['payload'];

    /** Assert the batch was rejected with `invalid_filter` (reason + where_path), unrecoverably, leaving state as `checkFinal` expects. */
    const expectInvalidFilter = <T extends Record<string, any>>(
        r: WriteTestAdapterResult<T>,
        reason: 'unknown_field' | 'type_mismatch' | 'non_finite' | 'malformed',
        wherePath: string | null | undefined,
        checkFinal: (finalItems: T[]) => void,
    ): void => expectOrAcknowledgeUnsupported(r, (r) => {
        expect(r.result.ok).toBe(false);
        const err = getWriteErrors(r.result)[0];
        expect(err?.type).toBe('invalid_filter');
        if (err && err.type === 'invalid_filter') {
            expect(err.reason).toBe(reason);
            if (wherePath === null) expect(err.where_path).toBeUndefined();
            else if (wherePath !== undefined) expect(err.where_path).toBe(wherePath);
        }
        expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
        checkFinal(r.finalItems);
    }, implName);

    const flatSeed = (): Flat[] => [{ id: '1', text: 'a' }];

    describe('9. Invalid filter (where) rejection', () => {

        describe('9.1 top-level where', () => {

            // T-9.1
            itCorpus('an update with an unknown-field where is unknown_field, mutating nothing', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ ghost: 1 }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'ghost', (f) => expect(f).toEqual([{ id: '1', text: 'a' }]));
            });

            // T-9.2
            itCorpus('a delete with an unknown-field where is unknown_field, leaving the row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('u', { type: 'delete', where: asWhere<Flat>({ ghost: 1 }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'ghost', (f) => expect(f).toEqual([{ id: '1', text: 'a' }]));
            });

            // T-9.7
            itCorpus('a type-contradicting where is type_mismatch', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ count: 'old' }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'type_mismatch', 'count', () => { /* only reason/path asserted */ });
            });

            // T-9.10 / T-9.11
            itCorpus('a numeric field pinned to Infinity is non_finite, mutating nothing', async () => {
                const rows = (): Flat[] => [{ id: '1', text: 'a', count: 5 }];
                const upd = createAdapter(FlatSchema, flatDdl);
                const rUpd = await upd.apply({
                    initialItems: rows(),
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ count: { $gte: Infinity } }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(rUpd, 'non_finite', 'count', (f) => expect(f).toEqual([{ id: '1', text: 'a', count: 5 }]));

                const del = createAdapter(FlatSchema, flatDdl);
                const rDel = await del.apply({
                    initialItems: rows(),
                    writeActions: [makeAction<Flat>('u', { type: 'delete', where: asWhere<Flat>({ count: { $lte: -Infinity } }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(rDel, 'non_finite', 'count', (f) => expect(f).toEqual([{ id: '1', text: 'a', count: 5 }]));
            });

            // T-9.13
            itCorpus('a null where is malformed with no field path', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>(null) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'malformed', null, (f) => expect(f).toEqual([{ id: '1', text: 'a' }]));
            });

            // T-15.13 (relocated) — a field set to undefined is malformed in a write context
            itCorpus('a field set to undefined is malformed (write gate is stricter than the bare validator)', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ count: undefined }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'malformed', 'count', (f) => expect(f).toEqual([{ id: '1', text: 'a' }]));
            });

            // T-9.14
            itCorpus('an uncompilable $regex where is malformed and never throws', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const action = makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ id: { $regex: '[' } }) });
                await expect(adapter.apply({ initialItems: flatSeed(), writeActions: [action], schema: FlatSchema, ddl: flatDdl })).resolves.toBeDefined();
                const r = await adapter.apply({ initialItems: flatSeed(), writeActions: [action], schema: FlatSchema, ddl: flatDdl });
                expectInvalidFilter(r, 'malformed', undefined, (f) => expect(f).toEqual([{ id: '1', text: 'a' }]));
            });

            // T-9.15
            itCorpus('a wrong-type range operand is malformed', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'a', count: 5 }],
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ count: { $gt: undefined } }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, () => { /* reason only */ });
            });

            // T-9.19
            itCorpus('a throwing $or arm mutates nothing even though the other arm matched a row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'a' }, { id: '2', text: 'b' }],
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ $or: [{ id: '1' }, { text: { $regex: '[' } }] }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, (f) => {
                    expect(f).toEqual([{ id: '1', text: 'a' }, { id: '2', text: 'b' }]);
                });
                expectOrAcknowledgeUnsupported(r, (r) => expect(r.changes.update).toHaveLength(0), implName);
            });

            // T-9.20
            itCorpus('a malformed where on an EMPTY list is still caught statically', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [],
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ id: { $regex: '[' } }) })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, (f) => expect(f).toEqual([]));
            });

            // atomic rollback
            itCorpus('an invalid where rolls back the whole atomic batch', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [
                        makeAction<Flat>('a', { type: 'create', data: { id: '2', text: 'b' } }),
                        makeAction<Flat>('b', { type: 'update', data: { text: 'z' }, where: asWhere<Flat>({ ghost: 1 }) }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(r.finalItems).toEqual([{ id: '1', text: 'a' }]);
                }, implName);
            });
        });

        describe('9.3 nested array_scope where', () => {

            const seedNested = (): Nested[] => [{ id: '1', children: [{ cid: 'c1', items: [{ iid: 'i1', value: 0 }] }] }];

            // T-9.21
            itCorpus('a nested unknown-field where is unknown_field with a scoped path', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: { ghost: 1 } } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'children.ghost', (f) => expect(f).toEqual(seedNested()));
            });

            // T-9.22
            itCorpus('a nested invalid where is caught even when the outer where matches no parent', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: 'nonexistent' }, action: { type: 'update', data: { label: 'x' }, where: { ghost: 1 } } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'children.ghost', () => { /* path only */ });
            });

            // T-9.23
            itCorpus('a nested invalid where is caught even when the scoped array is empty', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [] }],
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: { ghost: 1 } } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'children.ghost', () => { /* path only */ });
            });

            // T-9.24
            itCorpus('a two-level scope surfaces the full scope-chain path', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({
                        type: 'array_scope', scope: 'children', where: { id: '1' },
                        action: { type: 'array_scope', scope: 'items', where: { cid: 'c1' }, action: { type: 'update', data: { value: 1 }, where: { ghost: 1 } } },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'children.items.ghost', () => { /* path only */ });
            });

            // T-9.25
            itCorpus('a nested null where is malformed', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: null } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, (f) => expect(f).toEqual(seedNested()));
            });

            // T-9.26
            itCorpus('a bigint under $ne nested in a scope where is malformed at its deep path', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: { cid: { $ne: 5n } } } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'malformed', 'children.cid.$ne', (f) => expect(f).toEqual(seedNested()));
            });

            // T-9.27
            itCorpus('a Date carrier nested in a scope where is malformed at its deep path', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: { cid: new Date() } } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'malformed', 'children.cid', (f) => expect(f).toEqual(seedNested()));
            });

            // T-9.28
            itCorpus('a nested runtime-throwing $regex surfaces as invalid_filter, not a silent ok', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const items: Nested[] = [{ id: '1', children: [{ cid: 'c1', label: 'foo', items: [] }] }];
                const r = await adapter.apply({
                    initialItems: items,
                    writeActions: [makeAction<Nested>('u', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: { label: { $regex: '[' } } } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, (f) => expect(f).toEqual(items));
            });

            // blocks following
            itCorpus('an invalid nested where blocks the following action', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: seedNested(),
                    writeActions: [
                        makeAction<Nested>('a1', scopePayload<Nested>({ type: 'array_scope', scope: 'children', where: { id: '1' }, action: { type: 'update', data: { label: 'x' }, where: { ghost: 1 } } })),
                        makeAction<Nested>('a2', { type: 'create', data: { id: '2' } }),
                    ],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(false);
                    expect(getWriteFailures(r.result).find(f => f.action_uuid === 'a2')?.blocked_by_action_uuid).toBe('a1');
                }, implName);
            });
        });

        describe('9.4 pull.items_where', () => {

            const subSeed = (): FlatWithSubItems[] => [{ id: '1', sub_items: [{ sid: 's1', val: 1 }] }];
            const tagSeed = (): FlatWithSubItems[] => [{ id: '1', tags: ['a', 'b'] }];

            // T-9.29
            itCorpus('an object items_where with an unknown field is unknown_field, scoped to the array', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: subSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'sub_items', items_where: { ghost: 1 }, where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'unknown_field', 'sub_items.ghost', (f) => expect(f[0]!.sub_items).toEqual([{ sid: 's1', val: 1 }]));
            });

            // T-9.30
            itCorpus('an object items_where contradicting a field type is type_mismatch', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: subSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'sub_items', items_where: { val: 'x' }, where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'type_mismatch', 'sub_items.val', () => { /* path only */ });
            });

            // T-9.31
            itCorpus('an object items_where with a structurally-invalid logic arm is malformed', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: subSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'sub_items', items_where: { $or: [null] }, where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, (f) => expect(f[0]!.sub_items).toEqual([{ sid: 's1', val: 1 }]));
            });

            // T-9.32
            itCorpus('an object items_where whose operand throws at match time is malformed, not thrown', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: subSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'sub_items', items_where: { val: { $gt: undefined } }, where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, (f) => expect(f[0]!.sub_items).toEqual([{ sid: 's1', val: 1 }]));
            });

            // T-9.34
            itCorpus('an object items_where is flagged even when the parent where matches no rows', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: subSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'sub_items', items_where: { sid: { $regex: '[' } }, where: { id: 'nonexistent' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'malformed', undefined, () => { /* reason only */ });
            });

            // T-9.33
            itCorpus('a satisfiable non-finite bound in an object items_where is non_finite at its deep path', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: subSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'sub_items', items_where: { val: { $lt: Infinity } }, where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'non_finite', 'sub_items.val.$lt', (f) => expect(f[0]!.sub_items).toEqual([{ sid: 's1', val: 1 }]));
            });

            // T-9.35
            itCorpus('a bigint scalar value-list member is malformed at items_where.0', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: tagSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'tags', items_where: [5n], where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'malformed', 'items_where.0', (f) => expect(f[0]!.tags).toEqual(['a', 'b']));
            });

            // T-9.36
            itCorpus('a Date scalar value-list member is malformed at items_where.0', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: tagSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'tags', items_where: [new Date()], where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'malformed', 'items_where.0', (f) => expect(f[0]!.tags).toEqual(['a', 'b']));
            });

            // T-9.37
            itCorpus('a non-finite scalar value-list member is non_finite at items_where.0 (guards a silent [Infinity]→[null])', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: tagSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'tags', items_where: [Infinity], where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'non_finite', 'items_where.0', (f) => expect(f[0]!.tags).toEqual(['a', 'b']));
            });

            // T-9.38
            itCorpus('a nested non-JSON inside a value-list member object is malformed at its deep path', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: tagSeed(),
                    writeActions: [makeAction<FlatWithSubItems>('u', scopePayload<FlatWithSubItems>({ type: 'pull', path: 'tags', items_where: [{ x: 5n }], where: { id: '1' } }))],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectInvalidFilter(r, 'malformed', 'items_where.0.x', (f) => expect(f[0]!.tags).toEqual(['a', 'b']));
            });
        });

        describe('9.5 negative controls (still gated)', () => {

            // T-9.39
            itCorpus('a valid where applies normally', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('u', { type: 'update', data: { text: 'z' }, where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: '1', text: 'z' }]);
                }, implName);
            });

            // T-9.40
            itCorpus('a scalar value-list items_where is not treated as a where (no false reject)', async () => {
                const adapter = createAdapter(FlatWithSubItemsSchema, flatWithSubItemsDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction<FlatWithSubItems>('u', { type: 'pull', path: 'tags', items_where: ['a'], where: { id: '1' } })],
                    schema: FlatWithSubItemsSchema,
                    ddl: flatWithSubItemsDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]!.tags).toEqual(['b']);
                }, implName);
            });
        });
    });
}
