import matchJavascriptObjectReference from "../../matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../../types.ts";
import { mulberry32, mixSeed, genRow } from "../fuzz-internals.ts";
import { evaluateWithMingo } from "./oracle.ts";
import { genMongoFilter } from "./generator.ts";

/**
 * Calibration for the secondary oracle.
 *
 * These tests pin the premise every other part of the mingo harness rests on: that mingo really does speak
 * MongoDB, and that it really does contradict this package exactly where `MONGO-DIVERGENCES.md` says we
 * diverge. A divergence entry that mingo does NOT contradict is either mis-documented or already fixed — in
 * both cases the register is lying, and the ignore-list built from it would mask a live bug.
 */
describe('mingo secondary oracle', () => {

    type Row = Record<string, unknown>;
    const both = (row: Row, filter: WhereFilterDefinition<Row>): { ours: boolean, mongo: boolean } => ({
        ours: matchJavascriptObjectReference(row, filter),
        mongo: evaluateWithMingo(row, filter),
    });

    describe('agrees with us on the uncontroversial core', () => {

        test('a scalar equality matches the same document', () => {
            const { ours, mongo } = both({ name: 'ann' }, { name: { $eq: 'ann' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('a range bound excludes the same document', () => {
            const { ours, mongo } = both({ age: 3 }, { age: { $gt: 5 } });
            expect(ours).toBe(false);
            expect(mongo).toBe(false);
        });

        test('a multi-operator payload is a conjunction on both', () => {
            const { ours, mongo } = both({ age: 7 }, { age: { $gt: 5, $lt: 10 } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('a bare scalar on an array field matches by containment on both', () => {
            const { ours, mongo } = both({ tags: ['a', 'b'] }, { tags: 'a' });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('$size counts the array on both', () => {
            const { ours, mongo } = both({ tags: ['a', 'b'] }, { tags: { $size: 2 } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('$elemMatch with value operators finds the same element on both', () => {
            const { ours, mongo } = both({ scores: [1, 9] }, { scores: { $elemMatch: { $gt: 5, $lt: 20 } } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });
    });

    /**
     * Each case below is the reason its divergence entry exists. `mongo` is what MongoDB answers; `ours` is
     * what this package answers. If one of these ever starts agreeing, delete the divergence entry — do not
     * "fix" the test.
     */
    describe('contradicts us exactly where the divergence register says it should', () => {

        test('#2 — an empty $all matches everything here, and nothing in MongoDB', () => {
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $all: [] } });
            expect(ours).toBe(true);
            expect(mongo).toBe(false);
        });

        test('#13 — a comparison operator on an array field is not element-wise here', () => {
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $eq: 'a' } });
            expect(ours).toBe(false);
            expect(mongo).toBe(true);
        });

        test('#13 — the same holds for a range bound on an array field', () => {
            const { ours, mongo } = both({ scores: [9] }, { scores: { $gt: 5 } });
            expect(ours).toBe(false);
            expect(mongo).toBe(true);
        });

        test('#15 — $exists inside a scalar $elemMatch body describes no element here', () => {
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $elemMatch: { $exists: true } } });
            expect(ours).toBe(false);
            expect(mongo).toBe(true);
        });

        test('#15 — mixing $exists with a scalar predicate still matches nothing here', () => {
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $elemMatch: { $exists: true, $eq: 'a' } } });
            expect(ours).toBe(false);
            expect(mongo).toBe(true);
        });
    });

    /**
     * Bugs the oracle found, each independently confirmed against a real `mongod` 8.2.6 before being believed.
     *
     * They are pinned as they behave TODAY, so the fix — when it is scheduled — arrives with a test that already
     * describes the wrong answer and must be inverted. Both are recorded in `PENDING_BUGS`; neither is an
     * accepted divergence, and neither should be moved to `MONGO-DIVERGENCES.md`.
     */
    describe('found real Mongo-conformance bugs (pinned as they behave today, awaiting a fix)', () => {

        test('BUG-A — $type null wrongly matches a MISSING field, where MongoDB requires the field to exist', () => {
            // mongod 8.2.6: `{age:{$type:"null"}}` matches only a document whose `age` EXISTS and is null.
            // (`{age:null}` — plain equality — DOES match a missing field. $type does not. They differ.)
            const { ours, mongo } = both({ name: 'ann' }, { age: { $type: 'null' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(false);
        });

        test('BUG-A — a field that exists and holds null matches on both, so only absence is wrong', () => {
            const { ours, mongo } = both({ age: null }, { age: { $type: 'null' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('BUG-B — $ne on a path through an array means "some element differs" here, "no element matches" in MongoDB', () => {
            // mongod 8.2.6: this document is EXCLUDED — one element has k === 'b'.
            const { ours, mongo } = both({ items: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] }, { 'items.k': { $ne: 'b' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(false);
        });

        test('BUG-B — $elemMatch with an inner $ne IS "some element differs", and both agree on it', () => {
            // The query BUG-B accidentally implements. That MongoDB spells it differently is the whole point.
            const { ours, mongo } = both({ items: [{ k: 'a' }, { k: 'b' }] }, { items: { $elemMatch: { k: { $ne: 'b' } } } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });
    });

    /**
     * An oracle is only as good as its own conformance, and mingo is not perfectly conformant. Where it shares a
     * misunderstanding with us — or invents one of its own — it cannot be trusted, so the blind spots are pinned
     * here rather than left to be rediscovered. See `MINGO_QUIRKS`.
     */
    describe('is itself blind where it shares our misunderstanding', () => {

        test('#1 — mingo does not traverse arrays for $type either, so it cannot witness the divergence', () => {
            // The MongoDB manual: "For documents where field is an array, $type returns documents in which at
            // least one array element matches a type passed to $type." MongoDB answers true; both of us answer
            // false. The divergence is real and stands on the manual — this oracle simply cannot see it.
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $type: 'string' } });
            expect(ours).toBe(false);
            expect(mongo).toBe(false);
        });

        test('$type array is the one reading mingo shares with MongoDB', () => {
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $type: 'array' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        /**
         * The most dangerous kind of oracle failure: mingo is confidently WRONG, and we are right. Taking its
         * word here would mean "fixing" behaviour that already matches MongoDB. Such paths are excluded from the
         * generator; these pins are why.
         */
        test('mingo mis-evaluates a path crossing two arrays, where this package agrees with MongoDB', () => {
            const row = { groups: [{ subtags: ['b', 'd'] }, { subtags: [] }, { subtags: ['c', 'a'] }] };

            // mongod 8.2.6 resolves `groups.subtags` to the SET of individual subtags arrays and matches if any
            // one satisfies the predicate — so all three of these are TRUE in real MongoDB. mingo says false.
            for (const filter of [
                { 'groups.subtags': { $size: 0 } },
                { 'groups.subtags': { $size: 2 } },
                { 'groups.subtags': { $all: ['d'] } },
            ]) {
                const { ours, mongo } = both(row, filter);
                expect(ours).toBe(true);
                expect(mongo).toBe(false);
            }
        });

        test('a doubly-nested path is never generated, so mingo is never asked what it cannot answer', () => {
            // The generator's exclusion is the mitigation; if it ever regresses, the oracle would start reporting
            // mingo's defect as our bug. This pins the exclusion at its source.
            const rows = Array.from({ length: 500 }, (_, i) => i);
            const seen = rows.map(i => JSON.stringify(genMongoFilter(mulberry32(mixSeed(1234, 14, i)), genRow(mulberry32(mixSeed(99, 1, i))))));
            expect(seen.some(f => f.includes('groups.subtags'))).toBe(false);
        });
    });
});
