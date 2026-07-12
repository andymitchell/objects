import { FlatSchema, flatDdl, type Flat } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";

/**
 * §13: world integrity & immutability.
 *
 * A write must touch exactly the rows and fields it targets — never corrupt an untouched row, and never
 * mutate the caller's own input arrays/objects (even under atomic rollback). Each single-verb test asserts
 * the ENTIRE post-execution world against a fully-populated expectation, so any stray edit to a bystander
 * row is caught, not just the targeted row.
 */
export function registerWorldIntegrity(ctx: SectionCtx): void {
    const { test, expect, createAdapter, implName, itIfSupported } = ctx;

    // T-13.11 drives a NON-ATOMIC multi-action batch, so it only runs for an impl that can express one.
    const itNonAtomicMulti = itIfSupported('nonAtomicMultiAction');

    const world = (): Flat[] => [
        { id: '1', text: 'one', count: 1, tags: ['a'] },
        { id: '2', text: 'two', count: 2, tags: ['b', 'c'] },
        { id: '3', text: 'three', count: 3, tags: [] },
        { id: '4', text: 'four', count: 4, tags: ['d'] },
        { id: '5', text: 'five', count: 5, tags: ['e', 'f'] },
    ];
    const byId = (a: Flat, b: Flat): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const sorted = (items: Flat[]): Flat[] => [...items].sort(byId);

    describe('13. World integrity & immutability', () => {

        describe('13.1 a single verb touches only its target row/field', () => {

            // T-13.1
            test('update touches only its row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'X' }, where: { id: '3' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const expected = world();
                    expected[2]!.text = 'X';
                    expect(sorted(r.finalItems)).toEqual(expected);
                }, implName);
            });

            // T-13.2
            test('delete removes only its row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'delete', where: { id: '2' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const expected = world().filter(x => x.id !== '2');
                    expect(sorted(r.finalItems)).toEqual(expected);
                }, implName);
            });

            // T-13.3
            test('create appends without disturbing other rows', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'create', data: { id: '6', text: 'six' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const expected = [...world(), { id: '6', text: 'six' }];
                    expect(sorted(r.finalItems)).toEqual(expected);
                }, implName);
            });

            // T-13.4
            test('push extends only its row array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'push', path: 'tags', items: ['z'], where: { id: '1' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const expected = world();
                    expected[0]!.tags = ['a', 'z'];
                    expect(sorted(r.finalItems)).toEqual(expected);
                }, implName);
            });

            // T-13.5
            test('inc changes only its row', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'inc', path: 'count', amount: 10, where: { id: '4' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const expected = world();
                    expected[3]!.count = 14;
                    expect(sorted(r.finalItems)).toEqual(expected);
                }, implName);
            });

            // T-13.6
            test('add_to_set of an already-present item leaves the whole world unchanged', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'add_to_set', path: 'tags', items: ['c'], unique_by: 'deep_equals', where: { id: '2' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(sorted(r.finalItems)).toEqual(world());
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });

            // T-13.7
            test('pull removes only from its row array', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: world(),
                    writeActions: [makeAction('a1', { type: 'pull', path: 'tags', items_where: ['f'], where: { id: '5' } })],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    const expected = world();
                    expected[4]!.tags = ['e'];
                    expect(sorted(r.finalItems)).toEqual(expected);
                }, implName);
            });
        });

        describe('13.2 the caller\'s input is never mutated', () => {

            // T-13.8
            test('apply does not mutate the caller\'s initialItems array or objects', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const initial: Flat[] = [{ id: '1', tags: ['a'] }, { id: '2', count: 0 }];
                const snap = structuredClone(initial);
                await adapter.apply({
                    initialItems: initial,
                    writeActions: [
                        makeAction('a1', { type: 'push', path: 'tags', items: ['z'], where: { id: '1' } }),
                        makeAction('a2', { type: 'inc', path: 'count', amount: 5, where: { id: '2' } }),
                        makeAction('a3', { type: 'create', data: { id: '3' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expect(initial).toEqual(snap);
            });

            // T-13.9
            test('input immutability holds under atomic rollback', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const initial: Flat[] = [{ id: '1', tags: ['a'] }, { id: '2', count: 0 }];
                const snap = structuredClone(initial);
                await adapter.apply({
                    initialItems: initial,
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '3' } }),
                        makeAction('a2', { type: 'create', data: { id: '1' } }), // duplicate → fails
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                    options: { atomic: true },
                });
                expect(initial).toEqual(snap);
            });
        });

        describe('13.3 batch integrity', () => {

            // T-13.10
            test('interleaved verbs across different PKs resolve to the exact expected world', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', text: 'a', count: 1 },
                        { id: '2', tags: ['x'] },
                        { id: '3', text: 'gone' },
                    ],
                    writeActions: [
                        makeAction('a1', { type: 'create', data: { id: '4', text: 'd' } }),
                        makeAction('a2', { type: 'update', data: { text: 'A' }, where: { id: '1' } }),
                        makeAction('a3', { type: 'push', path: 'tags', items: ['y'], where: { id: '2' } }),
                        makeAction('a4', { type: 'delete', where: { id: '3' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.result.actions).toHaveLength(4);
                    expect(sorted(r.finalItems)).toEqual([
                        { id: '1', text: 'A', count: 1 },
                        { id: '2', tags: ['x', 'y'] },
                        { id: '4', text: 'd' },
                    ]);
                }, implName);
            });

            // T-13.11 — a key deleted and re-created within one batch resolves to a SINGLE row holding only the
            // re-created data. The world carries one row per primary key, so no field of the deleted original
            // may survive and the key may not appear twice.
            itNonAtomicMulti('delete then recreate then mutate the same PK leaves no stale fields', async () => {
                const adapter = createAdapter(FlatSchema, flatDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', text: 'orig', count: 9, tags: ['old'] }],
                    writeActions: [
                        makeAction('a1', { type: 'delete', where: { id: '1' } }),
                        makeAction('a2', { type: 'create', data: { id: '1', text: 'new' } }),
                        makeAction('a3', { type: 'update', data: { count: 5 }, where: { id: '1' } }),
                    ],
                    schema: FlatSchema,
                    ddl: flatDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.finalItems).toEqual([{ id: '1', text: 'new', count: 5 }]);
                }, implName);
            });
        });
    });
}
