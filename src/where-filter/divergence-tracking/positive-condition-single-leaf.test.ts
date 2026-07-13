/**
 * Pins MONGO-DIVERGENCES.md — slug `positive-condition-single-leaf` (#16): a positive condition on
 * a nested-array path must be satisfied by ONE leaf in full, where MongoDB pools every leaf into a
 * candidate set and lets different elements answer different operators. Negations are NOT folded
 * per leaf — they deny the whole path, which is what keeps the divergence conservative
 * (under-matching, never over-matching).
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import type { WhereFilterDefinition } from "../types.ts";
import { allEngines, matched, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({
    id: z.string(),
    items: z.array(z.object({ v: z.number(), k: z.string() })),
    groups: z.array(z.object({ subtags: z.array(z.string()) })),
});
type Row = z.infer<typeof RowSchema>;

/** The compile-time path grammar cannot name an array-traversing dotted path; the runtime grammar accepts it (the validity gate still checks it). */
const asRowFilter = (filter: unknown) => filter as WhereFilterDefinition<Row>;

/** No single element satisfies both bounds, and 'd'/'a' sit in different groups. */
const splitAcrossElements = {
    id: '1',
    items: [{ v: 1, k: 'x' }, { v: 5, k: 'y' }],
    groups: [{ subtags: ['d'] }, { subtags: ['a'] }],
};
/** One element/leaf satisfies everything at once. */
const satisfiedByOneLeaf = {
    id: '2',
    items: [{ v: 2.5, k: 'x' }],
    groups: [{ subtags: ['d', 'a'] }],
};
/** One element holds the value a negation denies. */
const holdsDeniedValue = {
    id: '3',
    items: [{ v: 1, k: 'b' }, { v: 5, k: 'c' }],
    groups: [],
};

describe('divergence `positive-condition-single-leaf` (#16)', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('a multi-operator condition split across elements fails — no single leaf clears both bounds (MongoDB would match)', async () => {
            expect(await match(splitAcrossElements, asRowFilter({ 'items.v': { $gt: 2, $lt: 3 } }), RowSchema)).toEqual(matched(false));
        });

        test('the same condition matches when one leaf satisfies it in full', async () => {
            expect(await match(satisfiedByOneLeaf, asRowFilter({ 'items.v': { $gt: 2, $lt: 3 } }), RowSchema)).toEqual(matched(true));
        });

        test("the documented route to MongoDB's question: name the operators as separate $and arms", async () => {
            expect(await match(splitAcrossElements, asRowFilter({ $and: [{ 'items.v': { $gt: 2 } }, { 'items.v': { $lt: 3 } }] }), RowSchema)).toEqual(matched(true));
        });

        test('$all split across different leaves fails — one leaf must hold all of it (MongoDB would match)', async () => {
            expect(await match(splitAcrossElements, asRowFilter({ 'groups.subtags': { $all: ['d', 'a'] } }), RowSchema)).toEqual(matched(false));
        });

        test('$all matches when one leaf holds every value', async () => {
            expect(await match(satisfiedByOneLeaf, asRowFilter({ 'groups.subtags': { $all: ['d', 'a'] } }), RowSchema)).toEqual(matched(true));
        });

        test('a negation denies the whole path: one offending element excludes the row, as MongoDB does', async () => {
            expect(await match(holdsDeniedValue, asRowFilter({ 'items.k': { $ne: 'b' } }), RowSchema)).toEqual(matched(false));
        });

        test('a negation keeps a row where no element offends', async () => {
            expect(await match(splitAcrossElements, asRowFilter({ 'items.k': { $ne: 'b' } }), RowSchema)).toEqual(matched(true));
        });
    });
});
