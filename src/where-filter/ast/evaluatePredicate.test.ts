import { describe, test, expect } from "vitest";
import { evaluatePredicate, matchesMissingField, type SubFilterMatcher } from "./evaluatePredicate.ts";
import { parseFieldPredicate } from "./parseFieldPredicate.ts";
import type { Predicate } from "./predicate.ts";
import { compareValues } from "../../query/sortCompare.ts";

/** A sub-filter reading that recurses through the parser, so an object element is matched field by field. */
const matchSubFilter: SubFilterMatcher = (element, filter) =>
    Object.entries(filter as Record<string, unknown>).every(([field, condition]) =>
        evaluatePredicate(element[field], parseFieldPredicate(condition), matchSubFilter));

const evaluate = (value: unknown, condition: unknown): boolean =>
    evaluatePredicate(value, parseFieldPredicate(condition), matchSubFilter);

describe('a predicate is evaluated against the value stored at its field', () => {

    describe('negation complements its operand', () => {

        test('a negated conjunction requires only one of its operators to fail', () => {
            // The conjunction {$ne: 9, $gt: 5} holds for 10, and for nothing that fails either bound.
            expect(evaluate(10, { $not: { $ne: 9, $gt: 5 } })).toBe(false);
            expect(evaluate(9, { $not: { $ne: 9, $gt: 5 } })).toBe(true);
            expect(evaluate(3, { $not: { $ne: 9, $gt: 5 } })).toBe(true);
        });

        test('a missing field is decided by the operand, not by a rule of its own', () => {
            // `$ne` matches a missing field, so its negation does not.
            expect(evaluate(undefined, { $ne: 5 })).toBe(true);
            expect(evaluate(undefined, { $not: { $ne: 5 } })).toBe(false);
            // `$exists: false` matches a missing field, so its negation does not.
            expect(evaluate(undefined, { $not: { $exists: false } })).toBe(false);
            expect(evaluate(undefined, { $not: { $exists: true } })).toBe(true);
        });

        test('negating twice restores the original verdict', () => {
            for (const value of [undefined, null, 7, 'a', ['a']]) {
                const once = evaluate(value, { $gt: 5 });
                expect(evaluate(value, { $not: { $not: { $gt: 5 } } })).toBe(once);
            }
        });
    });

    describe('a comparison against a value of another type', () => {

        test('a range bound does not match a wrong-typed value, and does not error', () => {
            expect(evaluate('cheap', { $gt: 5 })).toBe(false);
            expect(evaluate(5, { $gt: 'cheap' })).toBe(false);
            expect(evaluate(true, { $gt: 5 })).toBe(false);
        });

        test('a correctly-typed value in the same field still compares', () => {
            expect(evaluate(7, { $gt: 5 })).toBe(true);
            expect(evaluate('d', { $gt: 'b' })).toBe(true);
        });

        test('a bound whose own operand is uncomparable is a broken filter, not a non-matching row', () => {
            const broken: Predicate = { kind: 'range', bounds: [{ operator: '$gt', operand: { nested: true } }] };
            expect(() => evaluatePredicate(5, broken, matchSubFilter)).toThrow(/requires a string or number/);
        });
    });

    describe('an array field reads as a set of values', () => {

        test('a bare scalar asks whether the array contains it', () => {
            expect(evaluate(['a', 'b'], 'a')).toBe(true);
            expect(evaluate(['a', 'b'], 'z')).toBe(false);
        });

        test('$in intersects the array rather than comparing it whole', () => {
            expect(evaluate(['a', 'b'], { $in: ['b', 'z'] })).toBe(true);
            expect(evaluate(['a', 'b'], { $nin: ['b', 'z'] })).toBe(false);
        });

        test('$all requires every operand to be an element, compared structurally', () => {
            expect(evaluate([{ a: 1 }], { $all: [{ a: 1 }] })).toBe(true);
            expect(evaluate([{ a: 1 }], { $all: [{ a: 2 }] })).toBe(false);
        });

        test('one element must satisfy the whole $elemMatch body', () => {
            expect(evaluate([3, 9], { $elemMatch: { $ne: 9, $gt: 5 } })).toBe(false);
            expect(evaluate([3, 7], { $elemMatch: { $ne: 9, $gt: 5 } })).toBe(true);
        });

        test('an array operator against a value that is not an array does not match', () => {
            expect(evaluate('a', { $size: 1 })).toBe(false);
            expect(evaluate(undefined, { $all: ['a'] })).toBe(false);
            expect(evaluate(5, { $elemMatch: { $gt: 1 } })).toBe(false);
        });
    });

    describe('string range bounds compare by Unicode code point', () => {

        // U+E000 (BMP private-use) precedes U+10000 (supplementary plane) by code point, but a
        // UTF-16 code-unit comparison inverts the pair: U+10000 is the surrogate pair D800 DC00,
        // and D800 < E000 as code units.
        const bmp = String.fromCodePoint(0xE000);
        const astral = String.fromCodePoint(0x10000);

        test('a supplementary-plane character orders after a high BMP character', () => {
            expect(evaluate(bmp, { $lt: astral })).toBe(true);
            expect(evaluate(astral, { $lt: bmp })).toBe(false);
        });

        test('every range operator agrees, in both operand orders', () => {
            expect(evaluate(astral, { $gt: bmp })).toBe(true);
            expect(evaluate(bmp, { $gt: astral })).toBe(false);
            expect(evaluate(bmp, { $lte: astral })).toBe(true);
            expect(evaluate(astral, { $lte: bmp })).toBe(false);
            expect(evaluate(astral, { $gte: bmp })).toBe(true);
            expect(evaluate(bmp, { $gte: astral })).toBe(false);
            // Equal values satisfy only the inclusive bounds.
            expect(evaluate(astral, { $gte: astral })).toBe(true);
            expect(evaluate(astral, { $lte: astral })).toBe(true);
            expect(evaluate(astral, { $gt: astral })).toBe(false);
            expect(evaluate(astral, { $lt: astral })).toBe(false);
        });

        test('the empty string orders before every non-empty string', () => {
            expect(evaluate('a', { $gt: '' })).toBe(true);
            expect(evaluate('', { $lt: 'a' })).toBe(true);
            expect(evaluate('', { $gt: 'a' })).toBe(false);
            expect(evaluate('', { $gte: '' })).toBe(true);
        });

        test('a strict prefix orders before its extension', () => {
            expect(evaluate('Car', { $lt: 'Cart' })).toBe(true);
            expect(evaluate('Cart', { $gt: 'Car' })).toBe(true);
            expect(evaluate('Cart', { $lt: 'Car' })).toBe(false);
        });

        test('uppercase orders before lowercase — case-sensitive, locale-blind', () => {
            expect(evaluate('Banana', { $lt: 'apple' })).toBe(true);
            expect(evaluate('apple', { $gt: 'Banana' })).toBe(true);
            expect(evaluate('apple', { $lt: 'Banana' })).toBe(false);
        });

        test('every bound verdict is identical to the ordering comparator\'s verdict', () => {
            // The anti-drift pin: a range filter and a sort must agree on which values lie beyond a
            // bound, so each operator's verdict is the sign of the shared three-way comparison.
            const corpus = ['', 'Banana', 'Car', 'Cart', 'apple', 'zz', bmp, astral];
            for (const a of corpus) {
                for (const b of corpus) {
                    const cmp = compareValues(a, b, 1);
                    expect(evaluate(a, { $gt: b })).toBe(cmp > 0);
                    expect(evaluate(a, { $lt: b })).toBe(cmp < 0);
                    expect(evaluate(a, { $gte: b })).toBe(cmp >= 0);
                    expect(evaluate(a, { $lte: b })).toBe(cmp <= 0);
                }
            }
        });
    });
});

describe('what a predicate says about a field that is absent', () => {

    // A store that compiles a filter into a query decides this before it sees any row, so the answer must be
    // exactly the answer the evaluator gives for `undefined`.
    test.each([
        ['a bare scalar does not match', 'ann', false],
        ['a bare null matches, because absent and null are alike for equality', null, true],
        ['$eq: null matches', { $eq: null }, true],
        ['$eq of a value does not match', { $eq: 5 }, false],
        ['$ne matches, because an absent field differs from any value', { $ne: 5 }, true],
        ['$in does not match', { $in: [5] }, false],
        ['$nin matches', { $nin: [5] }, true],
        ['a range does not match', { $gt: 5 }, false],
        ['$regex does not match', { $regex: 'a' }, false],
        ['$exists: false matches', { $exists: false }, true],
        ['$exists: true does not match', { $exists: true }, false],
        ["$type: 'null' does not match, because an absent field has no type at all", { $type: 'null' }, false],
        ["$type: 'string' does not match", { $type: 'string' }, false],
        ["$not of $type: 'null' matches, because the absent field has no type to negate", { $not: { $type: 'null' } }, true],
        ['$size does not match', { $size: 0 }, false],
        ['$all does not match', { $all: ['a'] }, false],
        ['$elemMatch does not match', { $elemMatch: { $gt: 1 } }, false],
        ['$not inverts whatever its operand says', { $not: { $ne: 5 } }, false],
        ['$not of a non-matching operand matches', { $not: { $in: [5] } }, true],
        ['a conjunction matches only if every operator does', { $ne: 5, $exists: true }, false],
        ['a conjunction of operators that all match a missing field matches', { $ne: 5, $nin: [5] }, true],
    ] as [string, unknown, boolean][])('%s', (_name, condition, expected) => {
        expect(matchesMissingField(parseFieldPredicate(condition))).toBe(expected);
    });

    test('the answer is the evaluator\'s own, so a second implementation cannot drift from it', () => {
        const conditions: unknown[] = [null, 'ann', { $ne: 5 }, { $exists: false }, { $not: { $nin: [5] } }, { $type: 'null' }];
        for (const condition of conditions) {
            const predicate = parseFieldPredicate(condition);
            expect(matchesMissingField(predicate)).toBe(evaluatePredicate(undefined, predicate, matchSubFilter));
        }
    });
});
