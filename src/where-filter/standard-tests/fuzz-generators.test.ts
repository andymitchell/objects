import { describe, test, expect } from "vitest";
import {
    mulberry32, mixSeed, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS,
    type FuzzRow, type Rng,
    genRow, genComboPair, genElemMatchCombo, genLeafScopeOps,
    evalScalarOp, leafSatisfiesAll, slowLeafScopeEval,
} from "./fuzz-internals.ts";

/**
 * TEETH for the §24 generators.
 *
 * A metamorphic law can only catch a defect that some generated draw actually exposes. The multi-operator laws
 * (WF-P11, WF-P12) catch an engine that keeps one operator of a payload and drops the rest — but only on a draw
 * where the two operators DISAGREE about the row. Draw two operators that agree, and a truncating engine
 * returns the right answer for the wrong reason and the law passes.
 *
 * These tests replay the exact corpus each property will see (same seed, same iteration count, same draw order)
 * and count the discriminating draws, so the laws' teeth are a property of the generators rather than of luck.
 */

const RANGE_OPS = ['$gt', '$gte', '$lt', '$lte'];

/** Replay a property's corpus: one `(row, draw)` pair per iteration, seeded exactly as the property seeds it. */
function corpus<X>(propertyIndex: number, draw: (rng: Rng, row: FuzzRow) => X): { row: FuzzRow; drawn: X }[] {
    return Array.from({ length: DEFAULT_FUZZ_ITERATIONS }, (_unused, iter) => {
        const rng = mulberry32(mixSeed(DEFAULT_FUZZ_SEED, propertyIndex, iter));
        const row = genRow(rng);
        return { row, drawn: draw(rng, row) };
    });
}

describe('the multi-operator fuzz generators draw payloads that can expose a dropped operator', () => {

    describe('a two-operator payload on a scalar field (WF-P10, WF-P11)', () => {

        test('the two operators never both constrain the same range, which travels as one predicate', () => {
            // `$gt`/`$gte`/`$lt`/`$lte` are evaluated as a single predicate group, so an engine that keeps only
            // the first operator still honours both bounds. Such a pair is blind to the defect by construction.
            const bothRangeBounds = corpus(11, genComboPair)
                .filter(({ drawn }) => RANGE_OPS.includes(drawn.opA) && RANGE_OPS.includes(drawn.opB));
            expect(bothRangeBounds).toEqual([]);
        });

        test('the operators disagree about the row often enough for a dropped operator to change the verdict', () => {
            // When the operators disagree, the payload's conjunction is false while one operator alone is true —
            // so an engine keeping that operator answers differently, and the law bites.
            const discriminating = corpus(11, genComboPair).filter(({ row, drawn }) => {
                const value = drawn.field === 'name' ? row.name : row.age;
                return evalScalarOp(value, drawn.opA, drawn.a) !== evalScalarOp(value, drawn.opB, drawn.b);
            });
            expect(discriminating.length).toBeGreaterThan(DEFAULT_FUZZ_ITERATIONS / 5);
        });
    });

    describe('a two-operator body inside a scalar $elemMatch (WF-P12)', () => {

        test('some draws admit each operator on a different element but neither on one element', () => {
            // The conjunction is then unsatisfiable within any single element (so the payload must not match)
            // while an engine that drops one operator finds the survivor on some element and matches.
            const discriminating = corpus(12, genElemMatchCombo).filter(({ row, drawn }) => {
                const elements: (string | number)[] = drawn.field === 'tags' ? (row.tags ?? []) : (row.scores ?? []);
                const holdsA = (el: string | number) => evalScalarOp(el, drawn.opA, drawn.a);
                const holdsB = (el: string | number) => evalScalarOp(el, drawn.opB, drawn.b);
                const noElementHoldsBoth = !elements.some(el => holdsA(el) && holdsB(el));
                const someElementHoldsOne = elements.some(el => holdsA(el) || holdsB(el));
                return noElementHoldsBoth && someElementHoldsOne;
            });
            expect(discriminating.length).toBeGreaterThan(DEFAULT_FUZZ_ITERATIONS / 10);
        });
    });

    describe('a compound predicate on a path crossing two arrays (WF-P13)', () => {

        test('some draws are satisfiable across two leaf arrays but within none of them', () => {
            // The row must not match, yet an engine that scopes each operator to the whole spread finds every
            // operator satisfied somewhere and matches. This is the only draw shape that separates the two readings.
            // It is the scarcest of the three — a row needs two leaves that between them, but not singly, satisfy
            // the predicate — so the bound is low. The SQL consumers, which draw fewer iterations, still see
            // several such rows.
            const discriminating = corpus(13, genLeafScopeOps).filter(({ row, drawn }) => {
                const leaves = (row.groups ?? []).map(g => g.subtags);
                const everyOperatorHoldsSomewhere = drawn.every(op => leaves.some(leaf => leafSatisfiesAll(leaf, [op])));
                return everyOperatorHoldsSomewhere && !slowLeafScopeEval(row, drawn);
            });
            expect(discriminating.length).toBeGreaterThan(5);
        });
    });
});
