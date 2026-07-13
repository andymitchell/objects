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

        test('#15 recognises $exists or $type inside a scalar $elemMatch body', () => {
            expect(claimants({ tags: { $elemMatch: { $exists: true } } })).toEqual(['#15']);
            expect(claimants({ tags: { $elemMatch: { $type: 'string' } } })).toEqual(['#15']);
            expect(claimants({ tags: { $elemMatch: { $exists: true, $eq: 'a' } } })).toEqual(['#15']);
        });

        test('a divergence nested inside a logic arm is still recognised', () => {
            expect(claimants({ $or: [{ age: 5 }, { tags: { $elemMatch: { $exists: true } } }] })).toEqual(['#15']);
        });
    });

    describe('stays silent on everything it does not explain', () => {

        test('a comparison operator on an array field reads element-wise and is unclaimed', () => {
            expect(claimants({ tags: { $eq: 'a' } })).toEqual([]);
            expect(claimants({ scores: { $gt: 5 } })).toEqual([]);
            expect(claimants({ tags: { $regex: '^a' } })).toEqual([]);
            expect(claimants({ tags: { $not: { $eq: 'a' } } })).toEqual([]);
        });

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
 * The debt register, and why an empty one is the assertion.
 *
 * A bug entry exists so the oracle can run green while the bug is outstanding. Deleting it when the bug is fixed
 * is the regression test — with nothing left to claim the disagreement, a regression surfaces immediately as an
 * unexplained shape rather than being quietly re-absorbed as accepted behaviour.
 */
describe('the pending-bug list', () => {

    const claimants = (filter: unknown): string[] =>
        PENDING_BUGS.filter(d => d.claims(filter, isArrayFieldPath)).map(d => d.id);

    test('is empty, so no disagreement can be excused as a known bug', () => {
        expect(PENDING_BUGS).toEqual([]);
    });

    test('claims nothing — every conformance question now goes to the oracle unexcused', () => {
        for (const filter of [
            { 'items.k': { $ne: 'b' } },
            { 'items.v': { $nin: [1] } },
            { name: { $type: 'null' } },
            { tags: { $ne: 'a' } },
            { tags: { $eq: 'a' } },
            { name: { $eq: 'ann' } },
        ]) {
            expect(claimants(filter)).toEqual([]);
        }
    });
});
