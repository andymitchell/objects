import { KNOWN_DIVERGENCES, PENDING_BUGS } from "./knownDivergences.ts";
import { isArrayFieldPath } from "./generator.ts";

/**
 * Teeth for the ignore-list.
 *
 * A predicate that claims too much is the one failure that would make the whole secondary oracle decorative:
 * it would file a genuine Mongo-conformance bug under a divergence we already accepted, and the run would go
 * green. So each predicate is held to both halves of its contract — it must claim its own construct, and it
 * must stay silent on every neighbouring one.
 */
describe('the known-divergence ignore-list', () => {

    const claimants = (filter: unknown): string[] =>
        KNOWN_DIVERGENCES.filter(d => d.claims(filter, isArrayFieldPath)).map(d => d.id);

    describe('claims the disagreement it exists to explain', () => {

        test('#2 recognises an empty $all', () => {
            expect(claimants({ tags: { $all: [] } })).toEqual(['#2']);
        });

        test('#13 recognises a comparison operator applied to an array field', () => {
            expect(claimants({ tags: { $eq: 'a' } })).toEqual(['#13']);
            expect(claimants({ scores: { $gt: 5 } })).toEqual(['#13']);
            expect(claimants({ tags: { $regex: '^a' } })).toEqual(['#13']);
        });

        test('#13 looks through a $not, which inherits the polarity of what it negates', () => {
            expect(claimants({ tags: { $not: { $eq: 'a' } } })).toEqual(['#13']);
        });

        test('#15 recognises $exists or $type inside a scalar $elemMatch body', () => {
            expect(claimants({ tags: { $elemMatch: { $exists: true } } })).toEqual(['#15']);
            expect(claimants({ tags: { $elemMatch: { $type: 'string' } } })).toEqual(['#15']);
            expect(claimants({ tags: { $elemMatch: { $exists: true, $eq: 'a' } } })).toEqual(['#15']);
        });

        test('a divergence nested inside a logic arm is still recognised', () => {
            expect(claimants({ $or: [{ age: 5 }, { tags: { $eq: 'a' } }] })).toEqual(['#13']);
        });
    });

    describe('stays silent on everything it does not explain', () => {

        test('a comparison operator on a SCALAR field is conformant and unclaimed', () => {
            expect(claimants({ name: { $eq: 'ann' } })).toEqual([]);
            expect(claimants({ age: { $gt: 5 } })).toEqual([]);
        });

        test('a populated $all is conformant and unclaimed', () => {
            expect(claimants({ tags: { $all: ['a'] } })).toEqual([]);
        });

        test('array-native operators are conformant and unclaimed', () => {
            expect(claimants({ tags: { $size: 2 } })).toEqual([]);
            expect(claimants({ tags: { $in: ['a'] } })).toEqual([]);
            expect(claimants({ tags: 'a' })).toEqual([]);
        });

        test('a scalar $elemMatch body of value operators is conformant and unclaimed', () => {
            expect(claimants({ tags: { $elemMatch: { $eq: 'a' } } })).toEqual([]);
            expect(claimants({ scores: { $elemMatch: { $gt: 5, $lt: 9 } } })).toEqual([]);
        });

        /**
         * The regression that motivated these teeth. `$type: 'null'` on an absent field disagrees for a reason
         * that has nothing to do with arrays — an earlier draft of #13/#1 claimed any `$type` on an array field
         * and swallowed it, hiding a real finding behind an accepted divergence.
         */
        test('$type on an array field is NOT claimed — mingo shares that blind spot, so a disagreement there is a different bug', () => {
            expect(claimants({ tags: { $type: 'null' } })).toEqual([]);
            expect(claimants({ tags: { $type: 'string' } })).toEqual([]);
        });

        test('$type on a scalar field is not claimed', () => {
            expect(claimants({ name: { $type: 'null' } })).toEqual([]);
        });

    });
});

/**
 * The recorded bugs are held to the same narrowness bar as the accepted divergences — a loose predicate here
 * would let a NEW bug hide behind an old one, which is precisely how a known-issues list rots into a blindfold.
 */
describe('the pending-bug list', () => {

    const claimants = (filter: unknown): string[] =>
        PENDING_BUGS.filter(d => d.claims(filter, isArrayFieldPath)).map(d => d.id);

    describe('claims the bug it records', () => {

        test('BUG-A recognises $type null, which wrongly matches a missing field', () => {
            expect(claimants({ name: { $type: 'null' } })).toEqual(['BUG-A']);
            expect(claimants({ tags: { $type: 'null' } })).toEqual(['BUG-A']);
        });

        test('BUG-B recognises $ne/$nin on a path descending through an array', () => {
            expect(claimants({ 'items.k': { $ne: 'b' } })).toEqual(['BUG-B']);
            expect(claimants({ 'items.v': { $nin: [1] } })).toEqual(['BUG-B']);
        });
    });

    describe('stays silent on everything else', () => {

        test('BUG-A does not claim a $type of another kind — only null conflates with absence', () => {
            expect(claimants({ name: { $type: 'string' } })).toEqual([]);
            expect(claimants({ tags: { $type: 'array' } })).toEqual([]);
        });

        test('BUG-B does not claim $ne/$nin on a plain array field — that is the accepted divergence #13', () => {
            expect(claimants({ tags: { $ne: 'a' } })).toEqual([]);
            expect(claimants({ tags: { $nin: ['a'] } })).toEqual([]);
        });

        test('BUG-B does not claim a conformant operator on a dotted path', () => {
            expect(claimants({ 'items.k': { $eq: 'b' } })).toEqual([]);
            expect(claimants({ 'items.k': 'b' })).toEqual([]);
        });

        test('neither bug claims an ordinary conformant filter', () => {
            expect(claimants({ name: { $eq: 'ann' } })).toEqual([]);
            expect(claimants({ tags: { $size: 2 } })).toEqual([]);
        });
    });
});
