import { RecordDeepSchema, type RecordDeep } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §26. Paths through a record (`z.record`).
 *
 * A record's keys are arbitrary runtime strings, so they can never appear in a schema-derived path map.
 * That makes every record path a test of two things at once.
 *
 * **Resolution.** `Record<string, X>` makes any key an `X`, so a path may descend through a record and
 * keep going — `data.<key>.value` is a string, `data.<key>.n` a number. A resolver that stops at the
 * first dynamic key reports the path as unknown, and an unknown path is not merely unmatched: it feeds
 * the missing-field polarity table, so `$ne` on it reports "a missing field differs from any value" and
 * matches every row. A resolvable path misreported as missing is therefore a silent WRONG MATCH, not a
 * silent miss.
 *
 * **Safety.** A record key is untrusted input — it can hold a quote, a comment marker, or a JSON-path
 * metacharacter. Every emitted path segment must be quoted, so a hostile key is inert data: it matches
 * the row that literally holds that key and no other.
 */
export function registerRecordPaths(ctx: SectionCtx): void {
    const { test, expect, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    const rec = (row: RecordDeep, filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition<RecordDeep>, RecordDeepSchema);
    const withData = (data: RecordDeep['data']): RecordDeep => ({ id: 'x', flat: {}, data });
    const withFlat = (flat: RecordDeep['flat']): RecordDeep => ({ id: 'x', flat, data: {} });

    describe('26. Paths through a record', () => {

        describe('26.1 a path descends through a record key into its value type', () => {
            test('a scalar leaf beneath a record key compares by equality', async () => {
                expect(await rec(withData({ foo: { value: 'v' } }), { 'data.foo.value': 'v' })).toBe(true);
                expect(await rec(withData({ foo: { value: 'w' } }), { 'data.foo.value': 'v' })).toBe(false);
            });

            test('a numeric leaf beneath a record key compares numerically, not as text', async () => {
                // '9' > '5' as text and 9 > 5 numerically, but 10 > 5 only numerically — the leaf's own
                // type, not the record's, decides the comparison.
                expect(await rec(withData({ foo: { value: 'v', n: 10 } }), { 'data.foo.n': { $gt: 5 } })).toBe(true);
                expect(await rec(withData({ foo: { value: 'v', n: 1 } }), { 'data.foo.n': { $gt: 5 } })).toBe(false);
            });

            test('a record key absent from the row does not match', async () => {
                expect(await rec(withData({ other: { value: 'v' } }), { 'data.foo.value': 'v' })).toBe(false);
            });

            test('a single-level record value compares by equality', async () => {
                expect(await rec(withFlat({ k: 'v' }), { 'flat.k': 'v' })).toBe(true);
                expect(await rec(withFlat({ k: 'w' }), { 'flat.k': 'v' })).toBe(false);
            });
        });

        describe('26.2 a resolvable record path is never treated as a missing field', () => {
            test('$exists:true on a present record value is true', async () => {
                expect(await rec(withData({ foo: { value: 'v' } }), { 'data.foo': { $exists: true } })).toBe(true);
            });

            test('$exists:true on an absent record key is false', async () => {
                expect(await rec(withData({}), { 'data.foo': { $exists: true } })).toBe(false);
            });

            test('$exists:false on an absent record key is true', async () => {
                expect(await rec(withData({}), { 'data.foo': { $exists: false } })).toBe(true);
            });

            test('$ne against the value actually stored at a record path does not match', async () => {
                // The silent-wrong-match pin. Reporting `data.foo.value` as an unknown path makes `$ne`
                // constant-true, so this row — whose value IS 'v' — would be returned by a filter asking
                // for rows whose value is NOT 'v'.
                expect(await rec(withData({ foo: { value: 'v' } }), { 'data.foo.value': { $ne: 'v' } })).toBe(false);
            });

            test('$ne against a different value at a record path matches', async () => {
                expect(await rec(withData({ foo: { value: 'w' } }), { 'data.foo.value': { $ne: 'v' } })).toBe(true);
            });

            test('$type on a record leaf reports the leaf type', async () => {
                expect(await rec(withData({ foo: { value: 'v' } }), { 'data.foo.value': { $type: 'string' } })).toBe(true);
                expect(await rec(withData({ foo: { value: 'v' } }), { 'data.foo.value': { $type: 'number' } })).toBe(false);
            });
        });

        describe('26.3 a record key is data, never syntax', () => {
            // Each key below would break out of an unquoted SQL string literal or JSON path. The contract
            // is behavioural, so it holds no matter how an engine quotes: the filter matches the row that
            // literally holds the key, and no other, without erroring.
            const hostileKeys = [
                "x' OR TRUE --",      // breaks a single-quoted SQL literal, then comments out the remainder
                'x"];SELECT',         // breaks a SQLite JSON path's bracket-quote form
                "x'); DROP TABLE t;--",
            ];

            for (const key of hostileKeys) {
                test(`a record key \`${key}\` matches only the row that holds it`, async () => {
                    expect(await rec(withFlat({ [key]: 'v' }), { [`flat.${key}`]: 'v' })).toBe(true);
                    expect(await rec(withFlat({ innocent: 'v' }), { [`flat.${key}`]: 'v' })).toBe(false);
                });

                test(`a record key \`${key}\` is inert beneath a deeper path`, async () => {
                    expect(await rec(withData({ [key]: { value: 'v' } }), { [`data.${key}.value`]: 'v' })).toBe(true);
                    expect(await rec(withData({ innocent: { value: 'v' } }), { [`data.${key}.value`]: 'v' })).toBe(false);
                });
            }
        });

        describe('26.4 a record key may contain a literal dot', () => {
            test('a dotted record key is reached through the dot-prop escape', async () => {
                expect(await rec(withData({ 'a.b': { value: 'v' } }), { 'data.a\\.b.value': 'v' })).toBe(true);
                expect(await rec(withData({ 'a.b': { value: 'w' } }), { 'data.a\\.b.value': 'v' })).toBe(false);
            });

            test('an unescaped dotted record key does not resolve to the literal key', async () => {
                expect(await rec(withData({ 'a.b': { value: 'v' } }), { 'data.a.b.value': 'v' })).toBe(false);
            });
        });

        test('26.5 an array inside a record value is refused, never silently unmatched', async () => {
            // Array spreading is driven by the schema path map, which has no node for a dynamic key. The
            // engine must say it cannot express this — an acknowledged skip — rather than return `false`
            // for a row that plainly satisfies the filter. See DECISIONS.md, "Record-value arrays".
            const result = await rec(withData({ foo: { value: 'v', tags: ['t'] } }), { 'data.foo.tags': { $size: 1 } });
            expectOrAcknowledgeUnsupported(result, true, 'an array inside a record value is an acknowledged unsupported path');
        });

    });
}
