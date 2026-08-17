import { MatchSchema, matchDdl, type Match } from "./fixtures.ts";
import { makeAction, expectOrAcknowledgeUnsupported, type SectionCtx } from "./harness.ts";
import type { WhereFilterDefinition } from "../../where-filter/types.ts";

/**
 * §15: where-filter behaviour in a write context.
 *
 * Pins the targeting semantics a write's `where` must honour — the subtle ones that decide whether a row
 * is touched: bare `null` matches null-or-missing; negation operators ($ne/$nin/$not) match a missing
 * field; `{}` / `{$and:[]}` / `{$nor:[]}` match ALL while `{$or:[]}` matches NOTHING; multi-key is an
 * implicit AND; array fields support containment, $elemMatch, and dotted-path spreading. All filters are
 * legitimate (nothing is invalid_filter) — safe for the validate-where-sync consumer.
 */
export function registerWhereBehavioural(ctx: SectionCtx): void {
    const { describe, test, expect, createAdapter, implName } = ctx;

    /**
     * A filter every engine resolves, spelled past the edge of what `WhereFilterDefinition` offers.
     *
     * The type is narrower than the matchers in two places this section exercises: a nullable field is
     * offered without its `null`, and a dotted path into an object array is not offered at all. Both
     * filters are legitimate — the assertions below are what say so — and the cast is confined to the
     * two of them, so a filter that is genuinely malformed still fails to compile.
     */
    const runtimeWhere = (w: Record<string, unknown>): WhereFilterDefinition<Match> => w as WhereFilterDefinition<Match>;

    describe('15. Where-filter behaviour (write targeting)', () => {

        describe('15.1 null & missing semantics', () => {

            // T-15.1
            test('bare null matches rows where the field is null OR missing', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', note: null }, { id: '2' }, { id: '3', note: 'x' }],
                    writeActions: [makeAction<Match>('a1', { type: 'update', data: { text: 'M' }, where: runtimeWhere({ note: null }) })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.find(x => x.id === '1')!.text).toBe('M');
                    expect(r.finalItems.find(x => x.id === '2')!.text).toBe('M');
                    expect(r.finalItems.find(x => x.id === '3')!.text).toBeUndefined();
                }, implName);
            });

            // T-15.2
            test('$ne matches a missing field', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', note: 'x' }, { id: '2' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { note: { $ne: 'x' } } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.find(x => x.id === '1')!.text).toBeUndefined();
                    expect(r.finalItems.find(x => x.id === '2')!.text).toBe('M');
                }, implName);
            });

            // T-15.3
            test('$nin matches a missing field', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', note: 'x' }, { id: '2' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { note: { $nin: ['x'] } } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.find(x => x.id === '1')!.text).toBeUndefined();
                    expect(r.finalItems.find(x => x.id === '2')!.text).toBe('M');
                }, implName);
            });

            // T-15.4
            test('$not of $eq matches a missing field', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1', note: 'x' }, { id: '2' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { note: { $not: { $eq: 'x' } } } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.find(x => x.id === '1')!.text).toBeUndefined();
                    expect(r.finalItems.find(x => x.id === '2')!.text).toBe('M');
                }, implName);
            });

            // T-15.13 relocated to §9 (invalid_filter, gated): the write-time where gate rejects
            // `{field: undefined}` as invalid_filter/malformed — it is NOT the benign no-op the bare
            // validator treats it as, so it is unsafe for the ungated validate-where-sync consumer here.
        });

        describe('15.2 empty logic operators', () => {

            // T-15.5
            test('an empty where matches every row', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }, { id: '2' }, { id: '3' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: {} })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.every(x => x.text === 'M')).toBe(true);
                    expect(r.changes.update).toHaveLength(3);
                }, implName);
            });

            // T-15.6
            test('$or of an empty list matches nothing', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }, { id: '2' }, { id: '3' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { $or: [] } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.result.ok).toBe(true);
                    expect(r.changes.changed).toBe(false);
                }, implName);
            });

            // T-15.7
            test('$and of an empty list matches every row', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }, { id: '2' }, { id: '3' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { $and: [] } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.update).toHaveLength(3);
                }, implName);
            });

            // T-15.8
            test('$nor of an empty list matches every row', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [{ id: '1' }, { id: '2' }, { id: '3' }],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { $nor: [] } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.changes.update).toHaveLength(3);
                }, implName);
            });
        });

        describe('15.3 composition & array fields', () => {

            // T-15.9
            test('multiple keys form an implicit AND', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', text: 'a', n: 1 },
                        { id: '2', text: 'a', n: 2 },
                        { id: '3', text: 'b', n: 1 },
                    ],
                    writeActions: [makeAction('a1', { type: 'update', data: { note: 'HIT' }, where: { text: 'a', n: 1 } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.find(x => x.id === '1')!.note).toBe('HIT');
                    expect(r.finalItems.find(x => x.id === '2')!.note).toBeUndefined();
                    expect(r.finalItems.find(x => x.id === '3')!.note).toBeUndefined();
                }, implName);
            });

            // T-15.10
            test('$elemMatch on an object array targets the right parent row', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', sub_items: [{ sid: 's1', val: 5 }] },
                        { id: '2', sub_items: [{ sid: 's2', val: 9 }] },
                    ],
                    writeActions: [makeAction('a1', { type: 'delete', where: { sub_items: { $elemMatch: { val: 5 } } } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.map(x => x.id)).toEqual(['2']);
                }, implName);
            });

            // T-15.11
            test('a dotted path into an object array spreads and targets the parent row', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', sub_items: [{ sid: 's1', val: 5 }] },
                        { id: '2', sub_items: [{ sid: 's2', val: 9 }] },
                    ],
                    writeActions: [makeAction<Match>('a1', { type: 'delete', where: runtimeWhere({ 'sub_items.val': 5 }) })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.map(x => x.id)).toEqual(['2']);
                }, implName);
            });

            // T-15.12
            test('a scalar matches an array field by containment', async () => {
                const adapter = createAdapter(MatchSchema, matchDdl);
                const r = await adapter.apply({
                    initialItems: [
                        { id: '1', tags: ['a', 'b'] },
                        { id: '2', tags: ['c'] },
                    ],
                    writeActions: [makeAction('a1', { type: 'update', data: { text: 'M' }, where: { tags: 'a' } })],
                    schema: MatchSchema,
                    ddl: matchDdl,
                });
                expectOrAcknowledgeUnsupported(r, (r) => {
                    expect(r.finalItems.find(x => x.id === '1')!.text).toBe('M');
                    expect(r.finalItems.find(x => x.id === '2')!.text).toBeUndefined();
                }, implName);
            });
        });
    });
}
