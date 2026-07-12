import { DottedRecordSchema, RecordDeepSchema, type DottedRecord, type RecordDeep } from "./fixtures.ts";
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

        describe('26.6 an inherited property name beneath a record value is not a field', () => {
            // `data`'s value is an object, so `data.<key>.constructor` bracket-reads its shape. `constructor`
            // and `__proto__` are inherited from Object.prototype, not declared fields; an untrusted path
            // naming one must resolve as missing, not crash SQL compilation by reading a non-schema as a Zod
            // schema. The JS matcher already denylists these names, so resolving unknown restores parity.
            for (const inherited of ['constructor', '__proto__']) {
                test(`\`data.foo.${inherited}\` resolves missing: $exists:false is true`, async () => {
                    expect(await rec(withData({ foo: { value: 'v' } }), { [`data.foo.${inherited}`]: { $exists: false } })).toBe(true);
                });
                test(`\`data.foo.${inherited}\` resolves missing: $exists:true is false`, async () => {
                    expect(await rec(withData({ foo: { value: 'v' } }), { [`data.foo.${inherited}`]: { $exists: true } })).toBe(false);
                });
            }
        });

        describe('26.7 a raw dotted path collides with neither a literal-dot record key nor its value', () => {
            // `a.b` is a literal-dot record key on DottedRecordSchema. The raw path `a.b.k.v` reads as nested
            // `a`→`b`→`k`→`v` (missing); only the escape `a\.b.k.v` reaches through the record. Pre-fix the raw
            // path borrowed the record reading and answered from a field the row does not hold that way.
            const row: DottedRecord = { id: 'x', 'a.b': { k: { v: 'w', tags: ['t'] } } };
            const dottedRec = (filter: unknown) => matchJavascriptObject(row, filter as WhereFilterDefinition<DottedRecord>, DottedRecordSchema);

            test('$exists:false on the raw path is true (missing field)', async () => {
                expect(await dottedRec({ 'a.b.k.tags': { $exists: false } })).toBe(true);
            });
            test('$exists:true on the raw path is false (missing field)', async () => {
                expect(await dottedRec({ 'a.b.k.v': { $exists: true } })).toBe(false);
            });
            test('the escape reaches through the record to the leaf (control)', async () => {
                expect(await dottedRec({ 'a\\.b.k.v': 'w' })).toBe(true);
            });
        });

        describe('26.8 an inherited member beyond the denylist is absent, never an Object.prototype leak', () => {
            // 26.6 pins the denylisted pair; this pins the general rule. A record value is a plain object,
            // so `toString`/`valueOf`/`hasOwnProperty` are reachable through its prototype chain — but they
            // are inherited members, not data. Every engine must resolve them as absent, and an own key
            // that merely spells an inherited name must stay readable as the data it is.
            test('a non-denylisted inherited member does not $exist', async () => {
                for (const name of ['toString', 'valueOf', 'hasOwnProperty']) {
                    expect(await rec(withData({ foo: { value: 'v' } }), { [`data.foo.${name}`]: { $exists: true } })).toBe(false);
                }
            });

            test('a record key that spells an inherited name is still data — own keys win', async () => {
                expect(await rec(withData({ toString: { value: 'v' } }), { 'data.toString.value': 'v' })).toBe(true);
                expect(await rec(withData({ innocent: { value: 'v' } }), { 'data.toString.value': 'v' })).toBe(false);
            });
        });

    });
}
