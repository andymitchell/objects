import { FlatSchema, flatDdl, type Flat } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";

/**
 * §19: primary keys and action uuids that collide with `Object.prototype` member names.
 *
 * `toString`, `constructor`, `valueOf`, `hasOwnProperty` and `__proto__` are ordinary strings. Nothing stops a
 * caller from using one as a row's primary key or as an action's uuid, and the schema admits them like any
 * other string — so an implementation must treat them as inert data.
 *
 * They are dangerous only to an implementation that indexes rows or outcomes in a plain JavaScript object.
 * There, `hash[pk]` inherits a truthy member for a key nobody ever wrote, and `hash['__proto__'] = row`
 * reaches a setter instead of storing anything. Both read as "this key is already present" or "this write
 * succeeded" when neither is true, and the failure is SILENT: a create that reports `ok:true` while the row is
 * missing from the final world, a delete that reports success while the row survives, or an untouched
 * bystander row replaced by an inherited function. Data loss, reported as success.
 *
 * Every assertion here is an ordinary write whose only unusual quality is the key's spelling. An
 * implementation keyed by a `Map`, a null-prototype object, or own-property checks passes without noticing.
 */
export function registerPrototypeNamedKeys(ctx: SectionCtx): void {
    const { test, expect, createAdapter, implName, itIfSupported } = ctx;

    const itNonAtomicMulti = itIfSupported('nonAtomicMultiAction');

    /** Every name a plain `{}` inherits, plus the one that reaches a setter rather than storing. */
    const PROTOTYPE_NAMES = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'] as const;

    const byId = (a: Flat, b: Flat): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const sorted = (items: Flat[]): Flat[] => [...items].sort(byId);

    describe('19. Primary keys and uuids named after Object.prototype members', () => {

        describe('19.1 a row whose primary key is a prototype member name is stored and reported like any other', () => {

            for (const name of PROTOTYPE_NAMES) {
                // T-19.1
                test(`create with primary key "${name}" appears in the final world, reported as an insert`, async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: 'keep', text: 'kept' }],
                        writeActions: [makeAction('a1', { type: 'create', data: { id: name, text: 'new' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        // The whole point: a create reported ok MUST be in the world it reports.
                        expect(sorted(r.finalItems)).toEqual(sorted([{ id: 'keep', text: 'kept' }, { id: name, text: 'new' }]));
                        expect(r.changes.insert.map(x => x.id)).toEqual([name]);
                        expect(r.changes.update).toEqual([]);
                        expect(r.changes.remove_keys).toEqual([]);
                        expect(r.changes.changed).toBe(true);
                    }, implName);
                });
            }

            // T-19.2
            test('update of a row whose primary key is a prototype member name changes exactly that row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'toString', text: 'orig' }, { id: 'other', text: 'o' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'changed' }, where: { id: 'toString' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(sorted(r.finalItems)).toEqual(sorted([{ id: 'toString', text: 'changed' }, { id: 'other', text: 'o' }]));
                    expect(r.changes.update.map(x => x.id)).toEqual(['toString']);
                }, implName);
            });

            // T-19.3
            test('delete of a row whose primary key is a prototype member name removes it', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'toString', text: 'gone' }, { id: 'other', text: 'o' }],
                    writeActions: [makeAction('a1', { type: 'delete', where: { id: 'toString' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: 'other', text: 'o' }]);
                    expect(r.changes.remove_keys).toEqual(['toString']);
                    expect(r.changes.changed).toBe(true);
                }, implName);
            });
        });

        describe('19.2 a bystander row named after a prototype member is never disturbed', () => {

            // T-19.4 — the sharpest case: an implementation reading `updatedHash[pk]` by truthiness corrupts this
            // row while writing to a DIFFERENT one, because the lookup inherits a function it never stored.
            test('writing to one row leaves an untouched prototype-named row byte-for-byte', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const bystanders: Flat[] = PROTOTYPE_NAMES.map(name => ({ id: name, text: 'untouched' }));
                const r = await adapter.apply({
                    initialItems: [...bystanders, { id: 'target', text: 'before' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'after' }, where: { id: 'target' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(sorted(r.finalItems)).toEqual(sorted([...bystanders, { id: 'target', text: 'after' }]));
                }, implName);
            });
        });

        describe('19.3 same-batch reconciliation holds for a prototype-named key', () => {

            // T-19.5
            itNonAtomicMulti('delete then recreate a prototype-named key yields one clean row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'toString', text: 'orig', count: 9 }],
                    writeActions: [
                        makeAction('a1', { type: 'delete', where: { id: 'toString' } }),
                        makeAction('a2', { type: 'create', data: { id: 'toString', text: 'new' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: 'toString', text: 'new' }]);
                }, implName);
            });

            // T-19.6
            itNonAtomicMulti('create then delete a prototype-named key leaves the world as it was', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: 'keep', text: 'kept' }],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: 'toString', text: 'ephemeral' } }),
                        makeAction('a2', { type: 'delete', where: { id: 'toString' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: 'keep', text: 'kept' }]);
                    expect(r.changes.remove_keys).toEqual([]);
                    expect(r.changes.insert).toEqual([]);
                }, implName);
            });
        });

        describe('19.4 an action uuid named after a prototype member is reported like any other', () => {

            for (const name of PROTOTYPE_NAMES) {
                // T-19.7 — outcomes indexed by uuid in a plain object hit the same inherited-member trap, losing
                // the outcome for an action that really did succeed.
                test(`an action whose uuid is "${name}" gets its own outcome`, async () => {
                    const adapter = createAdapter(FlatSchema, flatDdl);
                    const r = await adapter.apply({
                        initialItems: [{ id: '1', text: 'a' }],
                        writeActions: [makeAction(name, { type: 'update', data: { text: 'b' }, where: { id: '1' } })],
                        schema: FlatSchema,
                        ddl: flatDdl,
                    });
                    expectOrAcknowledgeUnsupported(r, (r) => {
                        expect(r.result.ok).toBe(true);
                        expect(r.result.actions.map(o => o.action_uuid)).toEqual([name]);
                        expect(r.finalItems).toEqual([{ id: '1', text: 'b' }]);
                    }, implName);
                });
            }
        });
    });
}
