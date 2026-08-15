import { z } from "zod";
import type { WriteAction } from "../types.ts";
import type { DDL } from "../../ddl/types.ts";
import {
    FlatSchema, flatDdl, type Flat,
    NestedObjSchema, nestedObjDdl, type NestedObj,
    NestedSchema, nestedDdl, type Nested,
} from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx, type WriteTestAdapterResult } from "./harness.ts";
import { getWriteErrors, getWriteFailures } from "../helpers.ts";

/**
 * §21: clearing and removing a property.
 *
 * `set_property_undefined` empties a property while leaving its key in place; `delete_property` takes the
 * key away. They are the only two ways a write action can say either thing, because an action travels as
 * JSON and JSON has no `undefined` — a value of `undefined` inside `update.data` would simply vanish in
 * transit, so it is refused outright and these verbs carry the intention instead.
 *
 * Both verbs alter properties that already exist and never build structure: an absent key, or a path whose
 * parent object is missing, is a quiet success that writes nothing. A path is judged against the schema
 * before anything is touched, so a property the schema cannot leave empty (or cannot do without) is a
 * refusal, not a partial write.
 *
 * The two verbs part company only in memory. `Object.keys` and `in` see the difference; deep equality,
 * `$exists`, and JSON persistence of the ITEM do not — across any JSON boundary a cleared property is
 * indistinguishable from a removed one. An implementation whose storage is itself JSON therefore cannot
 * represent the cleared state at all, which is why the two verbs are gated by separate capability flags.
 */
export function registerPropertyUndefinedDelete(ctx: SectionCtx): void {
    const { describe, expect, createAdapter, implName, itIfSupported } = ctx;
    const itClears = itIfSupported('setPropertyUndefined');
    const itRemoves = itIfSupported('deleteProperty');

    // A deliberately-unwritable path is not type-valid; cast at the single sanctioned boundary.
    const propertyPayload = <T extends Record<string, any>>(p: unknown): WriteAction<T>['payload'] => p as WriteAction<T>['payload'];

    /** A required non-key field beside a removable one, so a refusal is about the FIELD rather than about being the key. */
    const CardSchema = z.object({
        id: z.string(),
        title: z.string(),
        note: z.string().optional(),
    }).strict();
    type Card = z.infer<typeof CardSchema>;
    const cardDdl: DDL<Card> = {
        version: 1,
        lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
    };

    /**
     * Assert the batch was refused as `invalid_property_path` at `path`, unrecoverably, leaving the world
     * untouched. Pass `reason` only where the schema decides it unambiguously.
     */
    const expectPathRefused = <T extends Record<string, any>>(
        r: WriteTestAdapterResult<T>,
        path: string,
        reason: 'unknown_path' | 'not_optional' | 'not_undefinable' | 'object_array_property' | undefined,
        world: T[],
    ): void => expectOrAcknowledgeUnsupported(r, (r) => {
        expect(r.result.ok).toBe(false);
        const err = getWriteErrors(r.result)[0];
        expect(err?.type).toBe('invalid_property_path');
        if (err && err.type === 'invalid_property_path') {
            expect(err.path).toBe(path);
            if (reason) expect(err.reason).toBe(reason);
        }
        expect(getWriteFailures(r.result)[0]?.unrecoverable).toBe(true);
        expect(r.finalItems).toEqual(world);
    }, implName);

    describe('21. Clearing and removing a property', () => {

        describe('21.1 What each verb does to a matched item', () => {

            const flatSeed = (): Flat[] => [{ id: '1', text: 'hi', count: 2 }];

            // T-21.1
            itClears('clearing a valued property keeps its key, now holding nothing', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('a1', { type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const written = r.finalItems[0]!;
                    expect('text' in written).toBe(true);
                    expect(written.text).toBe(undefined);
                    expect(written.count).toBe(2); // its siblings are left as they were
                }, implName);
            });

            // T-21.2 — the key-removal contract: an implementation must be able to take a key away entirely.
            itRemoves('removing a valued property takes its key away', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('a1', { type: 'delete_property', path: 'text', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const written = r.finalItems[0]!;
                    // `in` rather than a value comparison: deep equality reads a present-but-empty key as absent.
                    expect('text' in written).toBe(false);
                    expect(written).toEqual({ id: '1', count: 2 });
                }, implName);
            });

            // T-21.3
            itRemoves('only the items the where matches are written to', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'one' }, { id: '2', text: 'two' }],
                    writeActions: [makeAction<Flat>('a1', { type: 'delete_property', path: 'text', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect('text' in r.finalItems.find(x => x.id === '1')!).toBe(false);
                    expect(r.finalItems.find(x => x.id === '2')!.text).toBe('two');
                }, implName);
            });

            // T-21.4
            itClears('a property the item does not carry is not conjured into existence', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 2 }],
                    writeActions: [makeAction<Flat>('a1', { type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect('text' in r.finalItems[0]!).toBe(false);
                    expect(r.finalItems[0]).toEqual({ id: '1', count: 2 });
                }, implName);
            });

            // T-21.5
            itRemoves('removing a property the item does not carry is a quiet success', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', count: 2 }],
                    writeActions: [makeAction<Flat>('a1', { type: 'delete_property', path: 'text', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems[0]).toEqual({ id: '1', count: 2 });
                }, implName);
            });

            // T-21.6 — a scalar array is an ordinary value; only an array of OBJECTS is off limits (T-21.19).
            itRemoves('a property holding a scalar array can be removed like any other', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', tags: ['a', 'b'] }],
                    writeActions: [makeAction<Flat>('a1', { type: 'delete_property', path: 'tags', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect('tags' in r.finalItems[0]!).toBe(false);
                    expect(r.finalItems[0]).toEqual({ id: '1' });
                }, implName);
            });
        });

        describe('21.2 Where the path can point', () => {

            const nestedSeed = (): NestedObj[] => [{ id: '1', meta: { a: 'x', b: 'y' } }];

            // T-21.7 — the key-removal contract, nested.
            itRemoves('a nested path removes one field and leaves its siblings alone', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: nestedSeed(),
                    writeActions: [makeAction<NestedObj>('a1', { type: 'delete_property', path: 'meta.a', where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const meta = r.finalItems[0]!.meta!;
                    expect('a' in meta).toBe(false);
                    expect(meta).toEqual({ b: 'y' });
                }, implName);
            });

            // T-21.8
            itClears('a nested path clears one field and leaves its siblings alone', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: nestedSeed(),
                    writeActions: [makeAction<NestedObj>('a1', { type: 'set_property_undefined', path: 'meta.a', where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const meta = r.finalItems[0]!.meta!;
                    expect('a' in meta).toBe(true);
                    expect(meta.a).toBe(undefined);
                    expect(meta.b).toBe('y');
                }, implName);
            });

            // T-21.9
            itRemoves('a path whose parent object is absent succeeds while writing nothing', async () => {
                const adapter = createAdapter(NestedObjSchema, nestedObjDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }],
                    writeActions: [makeAction<NestedObj>('a1', { type: 'delete_property', path: 'meta.a', where: { id: '1' } })],
                    schema: NestedObjSchema,
                    ddl: nestedObjDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect('meta' in r.finalItems[0]!).toBe(false); // the parent is not materialised on the way past
                }, implName);
            });

            // T-21.10
            itRemoves('a path inside an array scope reaches the elements the nested where names', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', children: [{ cid: 'c1', label: 'keep-me?', items: [] }, { cid: 'c2', label: 'untouched', items: [] }] }],
                    writeActions: [makeAction<Nested>('a1', propertyPayload<Nested>({
                        type: 'array_scope', scope: 'children', where: { id: '1' },
                        action: { type: 'delete_property', path: 'label', where: { cid: 'c1' } },
                    }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    const children = r.finalItems[0]!.children!;
                    expect('label' in children.find(c => c.cid === 'c1')!).toBe(false);
                    expect(children.find(c => c.cid === 'c2')!.label).toBe('untouched');
                }, implName);
            });
        });

        describe('21.3 Surviving the journey to storage and back', () => {

            const flatSeed = (): Flat[] => [{ id: '1', text: 'hi', count: 2 }];

            // T-21.11
            itRemoves('a removal means the same thing after a trip through JSON', async () => {
                const action = makeAction<Flat>('a1', { type: 'delete_property', path: 'text', where: { id: '1' } });
                const roundTripped: WriteAction<Flat> = JSON.parse(JSON.stringify(action));

                const direct = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [action], schema: FlatSchema, ddl: flatDdl,
                });
                const viaJson = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [roundTripped], schema: FlatSchema, ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(viaJson, (viaJson) => {
                    // Stated outright, so the two runs cannot agree by both leaving the item alone.
                    expect(viaJson.result.ok).toBe(true);
                    expect('text' in viaJson.finalItems[0]!).toBe(false);
                    expect(viaJson.finalItems[0]).toEqual({ id: '1', count: 2 });

                    expectOrAcknowledgeUnsupported(direct, (direct) => {
                        expect(Object.keys(viaJson.finalItems[0]!).sort()).toEqual(Object.keys(direct.finalItems[0]!).sort());
                    }, implName);
                }, implName);
            });

            // T-21.12
            itClears('a clearing means the same thing after a trip through JSON', async () => {
                const action = makeAction<Flat>('a1', { type: 'set_property_undefined', path: 'text', where: { id: '1' } });
                const roundTripped: WriteAction<Flat> = JSON.parse(JSON.stringify(action));

                const direct = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [action], schema: FlatSchema, ddl: flatDdl,
                });
                const viaJson = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [roundTripped], schema: FlatSchema, ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(viaJson, (viaJson) => {
                    expect(viaJson.result.ok).toBe(true);
                    expect('text' in viaJson.finalItems[0]!).toBe(true);
                    expect(viaJson.finalItems[0]!.text).toBe(undefined);

                    expectOrAcknowledgeUnsupported(direct, (direct) => {
                        expect(Object.keys(viaJson.finalItems[0]!).sort()).toEqual(Object.keys(direct.finalItems[0]!).sort());
                    }, implName);
                }, implName);
            });

            // T-21.13
            itRemoves('removing twice leaves the same item as removing once', async () => {
                const remove = (uuid: string): WriteAction<Flat> =>
                    makeAction<Flat>(uuid, { type: 'delete_property', path: 'text', where: { id: '1' } });

                const once = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [remove('a1')], schema: FlatSchema, ddl: flatDdl,
                });
                const twice = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [remove('a1'), remove('a2')], schema: FlatSchema, ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(twice, (twice) => {
                    expect(twice.result.ok).toBe(true);
                    expect('text' in twice.finalItems[0]!).toBe(false);
                    expect(twice.finalItems[0]).toEqual({ id: '1', count: 2 });

                    expectOrAcknowledgeUnsupported(once, (once) => {
                        expect(Object.keys(twice.finalItems[0]!).sort()).toEqual(Object.keys(once.finalItems[0]!).sort());
                    }, implName);
                }, implName);
            });

            // T-21.14
            itClears('clearing twice leaves the same item as clearing once', async () => {
                const clear = (uuid: string): WriteAction<Flat> =>
                    makeAction<Flat>(uuid, { type: 'set_property_undefined', path: 'text', where: { id: '1' } });

                const once = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [clear('a1')], schema: FlatSchema, ddl: flatDdl,
                });
                const twice = await createAdapter(FlatSchema, flatDdl).apply({
                    initialItems: flatSeed(), writeActions: [clear('a1'), clear('a2')], schema: FlatSchema, ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(twice, (twice) => {
                    expect(twice.result.ok).toBe(true);
                    expect('text' in twice.finalItems[0]!).toBe(true);
                    expect(twice.finalItems[0]!.text).toBe(undefined);

                    expectOrAcknowledgeUnsupported(once, (once) => {
                        expect(Object.keys(twice.finalItems[0]!).sort()).toEqual(Object.keys(once.finalItems[0]!).sort());
                    }, implName);
                }, implName);
            });

            // T-21.15 — the boundary contract: past a JSON boundary the cleared state is the removed state.
            itClears('an item that has been through JSON no longer carries the cleared key at all', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: flatSeed(),
                    writeActions: [makeAction<Flat>('a1', { type: 'set_property_undefined', path: 'text', where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect('text' in r.finalItems[0]!).toBe(true); // in memory the key is still there
                    const persisted = JSON.parse(JSON.stringify(r.finalItems[0]!));
                    expect('text' in persisted).toBe(false);
                    expect(persisted).toEqual({ id: '1', count: 2 });
                }, implName);
            });
        });

        describe('21.4 Paths that are refused before anything is written', () => {

            const cardSeed = (): Card[] => [{ id: '1', title: 'a card', note: 'n' }];

            // T-21.16
            itRemoves('a path the schema does not declare is unknown_path', async () => {
                const adapter = createAdapter(CardSchema, cardDdl);
                const r = await adapter.apply({
                    initialItems: cardSeed(),
                    writeActions: [makeAction<Card>('a1', propertyPayload<Card>({ type: 'delete_property', path: 'nonexistent', where: { id: '1' } }))],
                    schema: CardSchema,
                    ddl: cardDdl,
                });
                expectPathRefused(r, 'nonexistent', 'unknown_path', cardSeed());
            });

            // T-21.17
            itRemoves('a property the schema requires cannot be removed', async () => {
                const adapter = createAdapter(CardSchema, cardDdl);
                const r = await adapter.apply({
                    initialItems: cardSeed(),
                    writeActions: [makeAction<Card>('a1', propertyPayload<Card>({ type: 'delete_property', path: 'title', where: { id: '1' } }))],
                    schema: CardSchema,
                    ddl: cardDdl,
                });
                expectPathRefused(r, 'title', 'not_optional', cardSeed());
            });

            // T-21.18
            itClears('a property the schema requires a value for cannot be cleared', async () => {
                const adapter = createAdapter(CardSchema, cardDdl);
                const r = await adapter.apply({
                    initialItems: cardSeed(),
                    writeActions: [makeAction<Card>('a1', propertyPayload<Card>({ type: 'set_property_undefined', path: 'title', where: { id: '1' } }))],
                    schema: CardSchema,
                    ddl: cardDdl,
                });
                expectPathRefused(r, 'title', 'not_undefinable', cardSeed());
            });

            // T-21.19 — a whole array of objects is no more removable than it is replaceable by an update.
            itRemoves('a property holding an array of objects cannot be removed', async () => {
                const adapter = createAdapter(NestedSchema, nestedDdl);
                const world = (): Nested[] => [{ id: '1', children: [{ cid: 'c1', items: [] }] }];
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction<Nested>('a1', propertyPayload<Nested>({ type: 'delete_property', path: 'children', where: { id: '1' } }))],
                    schema: NestedSchema,
                    ddl: nestedDdl,
                });
                expectPathRefused(r, 'children', 'object_array_property', world());
            });

            // T-21.20 — the reason is left open: a schema that requires the key refuses it as an ordinary
            // required field, while one that would allow its absence is refused for being the key itself.
            itRemoves('the primary key cannot be removed', async () => {
                const adapter = createAdapter(CardSchema, cardDdl);
                const r = await adapter.apply({
                    initialItems: cardSeed(),
                    writeActions: [makeAction<Card>('a1', propertyPayload<Card>({ type: 'delete_property', path: 'id', where: { id: '1' } }))],
                    schema: CardSchema,
                    ddl: cardDdl,
                });
                expectPathRefused(r, 'id', undefined, cardSeed());
            });

            // T-21.21
            itRemoves('the result JSON round-trips when the path was refused', async () => {
                const adapter = createAdapter(CardSchema, cardDdl);
                const r = await adapter.apply({
                    initialItems: cardSeed(),
                    writeActions: [makeAction<Card>('a1', propertyPayload<Card>({ type: 'delete_property', path: 'nonexistent', where: { id: '1' } }))],
                    schema: CardSchema,
                    ddl: cardDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(() => JSON.stringify(r.result)).not.toThrow();
                    const round = JSON.parse(JSON.stringify(r.result));
                    expect(round.actions[0].action_uuid).toBe('a1');
                    expect(round.actions[0].ok).toBe(false);
                    expect(round.actions[0].errors[0].type).toBe('invalid_property_path');
                    expect(round.actions[0].errors[0].reason).toBe('unknown_path');
                    expect(round.actions[0].errors[0].path).toBe('nonexistent');
                }, implName);
            });
        });
    });
}
