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
    // The filter is untyped: the corpus exercises the language the ENGINES accept, which is wider than a
    // schema-derived type — a comparison operator on an array field and a path descending through an array are
    // both accepted by the validity gate, as MongoDB accepts them, but neither is reachable from `WhereFilterDefinition<T>`.
    const both = (row: Row, filter: WhereFilterDefinition): { ours: boolean, mongo: boolean } => ({
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

        test('a comparison operator on an array field reads element-wise on both', () => {
            const { ours, mongo } = both({ tags: ['a'] }, { tags: { $eq: 'a' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('a range bound on an array field reads element-wise on both', () => {
            const { ours, mongo } = both({ scores: [9] }, { scores: { $gt: 5 } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('each bound is applied independently across elements, so $elemMatch asks a stricter question', () => {
            const independent = both({ scores: [1, 5] }, { scores: { $gt: 2, $lt: 4 } });
            expect(independent.ours).toBe(true);
            expect(independent.mongo).toBe(true);

            const elementBound = both({ scores: [1, 5] }, { scores: { $elemMatch: { $gt: 2, $lt: 4 } } });
            expect(elementBound.ours).toBe(false);
            expect(elementBound.mongo).toBe(false);
        });

        test('$ne on an array field is the complement of $eq — no element may equal the operand', () => {
            const holdsIt = both({ tags: ['x'] }, { tags: { $ne: 'x' } });
            expect(holdsIt.ours).toBe(false);
            expect(holdsIt.mongo).toBe(false);

            const lacksIt = both({ tags: ['x'] }, { tags: { $ne: 'z' } });
            expect(lacksIt.ours).toBe(true);
            expect(lacksIt.mongo).toBe(true);
        });

        test('$type null requires the field to exist on both — an absent field has no type', () => {
            const { ours, mongo } = both({ name: 'ann' }, { age: { $type: 'null' } });
            expect(ours).toBe(false);
            expect(mongo).toBe(false);
        });

        test('$type null matches a field that exists and holds null on both', () => {
            const { ours, mongo } = both({ age: null }, { age: { $type: 'null' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('plain equality to null still matches a missing field on both, where $type does not', () => {
            const { ours, mongo } = both({ name: 'ann' }, { age: null });
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
     * The negation laws, which are where a Mongo-conformance mistake does real damage: an engine that reads a
     * negation as "some value differs" rather than "no value matches" returns documents the caller asked to
     * exclude. `$elemMatch` is the construct that DOES ask about one element, and the contrast pins both.
     */
    describe('agrees on how a negation reads a path that descends through an array', () => {

        test('$ne excludes a document when some element DOES equal the operand', () => {
            const { ours, mongo } = both({ items: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] }, { 'items.k': { $ne: 'b' } });
            expect(ours).toBe(false);
            expect(mongo).toBe(false);
        });

        test('$ne matches when no element equals the operand', () => {
            const { ours, mongo } = both({ items: [{ k: 'a' }, { k: 'b' }] }, { 'items.k': { $ne: 'z' } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('$elemMatch with an inner $ne IS "some element differs", and is a different query', () => {
            const { ours, mongo } = both({ items: [{ k: 'a' }, { k: 'b' }] }, { items: { $elemMatch: { k: { $ne: 'b' } } } });
            expect(ours).toBe(true);
            expect(mongo).toBe(true);
        });

        test('negation composes, so negating $ne asks whether some element does equal the operand', () => {
            const { ours, mongo } = both({ items: [{ k: 'a' }, { k: 'b' }] }, { 'items.k': { $not: { $ne: 'b' } } });
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
