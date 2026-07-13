import { ContactSchema, QuoteKeySchema, TagsSchema, type QuoteKey } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §12. Path integrity & injection.
 *
 * `$exists` and `$type` build their SQL accessor from the raw filter-key segments rather than the
 * validating path converter every other operator uses. These pin two guarantees: an unknown path is a
 * clean `false`/skip (never a match), and a quote (or a `DROP TABLE`) embedded in a filter KEY can never
 * break out of the emitted SQL — the worst-case outcome is `false`/skip, never a DB error or a match.
 *
 * A key carrying a quote is not always hostile, though: a schema may legitimately declare `O'Brien`, and
 * such a field must be fully queryable. Safety therefore has to come from quoting every emitted path
 * segment, not from rejecting the keys that look dangerous — a rejection would make the legitimate field
 * unreachable while leaving any un-rejected key just as exposed.
 */
export function registerPathInjection(ctx: SectionCtx): void {
    const { describe, test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('12. Path integrity & injection', () => {

        test('12.1 $exists:false on an unknown path is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.ghost': { $exists: false } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.2 $exists:true on an unknown path is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.ghost': { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.3 $type on an unknown path is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.ghost': { $type: 'string' } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.4 a single-quote in a $exists key stays safe (false, never a DB error)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { "contact.na'me": { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.5 a single-quote in a $type key stays safe', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { "x'y": { $type: 'string' } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.6 a DROP-TABLE-style $exists key stays safe', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { "a'); DROP TABLE t;--": { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.7 $exists:true on a present scalar is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $exists: true } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.8 $exists:true on a missing optional is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.age': { $exists: true } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.9 $type array-branch on an unknown path is false', async () => {
            const result = await matchJavascriptObject({ id: '1', tags: ['a'], nums: [] }, { ghost: { $type: 'array' } } as unknown as WhereFilterDefinition, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.10 a single-quote in a $type array-branch key stays safe', async () => {
            const result = await matchJavascriptObject({ id: '1', tags: ['a'], nums: [] }, { "ta'gs": { $type: 'array' } } as unknown as WhereFilterDefinition, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.11 $exists on an absent spread leaf is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.locations.city': { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.12 $exists on a present spread leaf is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', locations: [{ city: 'NY' }] } }, { 'contact.locations.city': { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.13 $type "string" on a present nested string is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $type: 'string' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.14 $type "number" on a present nested number is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', age: 5 } }, { 'contact.age': { $type: 'number' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.15 a single-quote in a $size key stays safe (false, never a DB error)', async () => {
            const result = await matchJavascriptObject({ id: '1', tags: ['a'], nums: [] }, { "ta'gs": { $size: 1 } } as unknown as WhereFilterDefinition, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        // ── 12.16 A schema-declared key carrying SQL metacharacters is a first-class field ─────────
        //
        // Every operator resolves such a key and compares its value; none emits broken SQL. The row below
        // holds `O'Brien: 'Sean'`, so each filter's verdict is the ordinary one for that operator.
        describe('12.16 a schema-declared key carrying SQL metacharacters is fully queryable', () => {
            const row: QuoteKey = { id: '1', "O'Brien": 'Sean', 'a"b': 'dq', "a.b'c": 'both', "q'tags": ['t'] };
            const quoted = (filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition<QuoteKey>, QuoteKeySchema);

            test('a bare-equality match on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": 'Sean' }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": 'Other' }), false, 'quoted (injection-safe) key');
            });
            test('$eq and $ne on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $eq: 'Sean' } }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $ne: 'Sean' } }), false, 'quoted (injection-safe) key');
            });
            test('$in and $nin on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $in: ['Sean', 'Nuala'] } }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $nin: ['Sean'] } }), false, 'quoted (injection-safe) key');
            });
            test('$not on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $not: { $eq: 'Sean' } } }), false, 'quoted (injection-safe) key');
            });
            test('$exists on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $exists: true } }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $exists: false } }), false, 'quoted (injection-safe) key');
            });
            test('$type on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $type: 'string' } }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $type: 'number' } }), false, 'quoted (injection-safe) key');
            });
            test('$regex on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $regex: 'Sea' } }), true, 'quoted (injection-safe) key');
            });
            test('a range operator on a single-quoted key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $gte: 'Sean' } }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "O'Brien": { $gt: 'Sean' } }), false, 'quoted (injection-safe) key');
            });
            test('$size on a single-quoted array key', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "q'tags": { $size: 1 } }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "q'tags": { $size: 2 } }), false, 'quoted (injection-safe) key');
            });
            test('a double-quoted key resolves (a SQLite JSON-path metacharacter)', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ 'a"b': 'dq' }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ 'a"b': 'other' }), false, 'quoted (injection-safe) key');
            });
            test('a key holding both a literal dot and a quote resolves through the dot-prop escape', async () => {
                expectOrAcknowledgeUnsupported(await quoted({ "a\\.b'c": 'both' }), true, 'quoted (injection-safe) key');
                expectOrAcknowledgeUnsupported(await quoted({ "a\\.b'c": 'other' }), false, 'quoted (injection-safe) key');
            });
        });

    });
}
