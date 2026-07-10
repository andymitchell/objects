import { describe, test, expect } from "vitest";
import { parseFieldPredicate } from "./parseFieldPredicate.ts";
import type { Predicate } from "./predicate.ts";

/**
 * The parser is the single place where "what does this field condition say" is decided. These tests read the
 * tree it produces, because a downstream engine reads exactly that and nothing else.
 */
describe('a field condition is parsed into one tree with one meaning', () => {

    describe('a value that is not an operator payload', () => {

        test('a bare scalar asks for equality with that scalar', () => {
            expect(parseFieldPredicate('ann')).toEqual({ kind: 'scalar', value: 'ann' });
            expect(parseFieldPredicate(30)).toEqual({ kind: 'scalar', value: 30 });
            expect(parseFieldPredicate(true)).toEqual({ kind: 'scalar', value: true });
        });

        test('a bare null is a value, not an absence', () => {
            expect(parseFieldPredicate(null)).toEqual({ kind: 'scalar', value: null });
        });

        test('an explicitly undefined field condition is distinct from a null one', () => {
            expect(parseFieldPredicate(undefined)).toEqual({ kind: 'undefinedField' });
        });

        test('a bare array asks for equality with the whole array', () => {
            expect(parseFieldPredicate(['a', 'b'])).toEqual({ kind: 'exactArray', value: ['a', 'b'] });
        });

        test('an object with no operator keys is a sub-document to match', () => {
            expect(parseFieldPredicate({ name: 'ann' })).toEqual({ kind: 'compoundObject', filter: { name: 'ann' } });
        });

        test('an empty object is a sub-document, and matches anything', () => {
            expect(parseFieldPredicate({})).toEqual({ kind: 'compoundObject', filter: {} });
        });
    });

    describe('a payload carrying one operator', () => {

        test.each([
            ['$eq', { $eq: 5 }, { kind: 'eq', operand: 5 }],
            ['$ne', { $ne: 5 }, { kind: 'ne', operand: 5 }],
            ['$in', { $in: [1, 2] }, { kind: 'in', operand: [1, 2] }],
            ['$nin', { $nin: [1, 2] }, { kind: 'nin', operand: [1, 2] }],
            ['$exists', { $exists: false }, { kind: 'exists', expected: false }],
            ['$type', { $type: 'string' }, { kind: 'type', typeName: 'string' }],
            ['$size', { $size: 2 }, { kind: 'size', n: 2 }],
            ['$all', { $all: ['a'] }, { kind: 'all', elements: ['a'] }],
        ] as [string, unknown, Predicate][])('%s becomes its own predicate', (_name, condition, expected) => {
            expect(parseFieldPredicate(condition)).toEqual(expected);
        });

        test('a lone range bound is a range predicate', () => {
            expect(parseFieldPredicate({ $gt: 5 })).toEqual({ kind: 'range', bounds: [{ operator: '$gt', operand: 5 }] });
        });

        test('$regex without options carries no options', () => {
            expect(parseFieldPredicate({ $regex: '^a' })).toEqual({ kind: 'regex', pattern: '^a' });
        });
    });

    describe('a payload carrying several operators', () => {

        test('two bounds of the same range are ONE predicate, judged against the value together', () => {
            expect(parseFieldPredicate({ $gt: 5, $lt: 10 })).toEqual({
                kind: 'range',
                bounds: [{ operator: '$gt', operand: 5 }, { operator: '$lt', operand: 10 }],
            });
        });

        test('$regex and $options are ONE predicate, because options tune a pattern', () => {
            expect(parseFieldPredicate({ $regex: '^a', $options: 'i' })).toEqual({ kind: 'regex', pattern: '^a', options: 'i' });
        });

        test('unrelated operators become a conjunction', () => {
            expect(parseFieldPredicate({ $ne: 9, $exists: true })).toEqual({
                kind: 'and',
                children: [{ kind: 'ne', operand: 9 }, { kind: 'exists', expected: true }],
            });
        });

        test('the range bounds lead the conjunction, so an uncomparable bound is reached first', () => {
            const parsed = parseFieldPredicate({ $ne: 9, $gt: 5 });
            expect(parsed).toEqual({
                kind: 'and',
                children: [
                    { kind: 'range', bounds: [{ operator: '$gt', operand: 5 }] },
                    { kind: 'ne', operand: 9 },
                ],
            });
        });
    });

    describe('a payload nested inside another operator', () => {

        test('a conjunction under $not stays a conjunction, so the negation covers all of it', () => {
            expect(parseFieldPredicate({ $not: { $ne: 9, $gt: 5 } })).toEqual({
                kind: 'not',
                inner: {
                    kind: 'and',
                    children: [
                        { kind: 'range', bounds: [{ operator: '$gt', operand: 5 }] },
                        { kind: 'ne', operand: 9 },
                    ],
                },
            });
        });

        test('$not nests inside itself', () => {
            expect(parseFieldPredicate({ $not: { $not: { $gt: 5 } } })).toEqual({
                kind: 'not',
                inner: { kind: 'not', inner: { kind: 'range', bounds: [{ operator: '$gt', operand: 5 }] } },
            });
        });

        test('a conjunction inside a scalar $elemMatch body stays a conjunction', () => {
            expect(parseFieldPredicate({ $elemMatch: { $ne: 9, $gt: 5 } })).toEqual({
                kind: 'elemMatch',
                body: {
                    objectFilter: { $ne: 9, $gt: 5 },
                    scalarPredicate: {
                        kind: 'and',
                        children: [
                            { kind: 'range', bounds: [{ operator: '$gt', operand: 5 }] },
                            { kind: 'ne', operand: 9 },
                        ],
                    },
                },
            });
        });

        test('an $elemMatch body carries both readings, chosen later by the element it meets', () => {
            expect(parseFieldPredicate({ $elemMatch: { name: 'ann' } })).toEqual({
                kind: 'elemMatch',
                body: {
                    objectFilter: { name: 'ann' },
                    scalarPredicate: { kind: 'compoundObject', filter: { name: 'ann' } },
                },
            });
        });

        test('a scalar $elemMatch body has no sub-document reading', () => {
            expect(parseFieldPredicate({ $elemMatch: 'a' })).toEqual({
                kind: 'elemMatch',
                body: { objectFilter: undefined, scalarPredicate: { kind: 'scalar', value: 'a' } },
            });
        });

        test('a field-level operator inside an $elemMatch body describes no element', () => {
            // `$exists` asks whether a field is present; an element is present by virtue of being an element.
            expect(parseFieldPredicate({ $elemMatch: { $exists: true } })).toEqual({
                kind: 'elemMatch',
                body: {
                    objectFilter: { $exists: true },
                    scalarPredicate: { kind: 'compoundObject', filter: { $exists: true } },
                },
            });
        });
    });

    describe('a shape the filter language does not admit', () => {

        test('an unknown operator riding alongside a known one is refused', () => {
            expect(() => parseFieldPredicate({ $eq: 1, $mod: 3 })).toThrow(/Unknown filter shape/);
        });

        test('an operand of the wrong shape is refused', () => {
            expect(() => parseFieldPredicate({ $in: 5 })).toThrow(/Unknown filter shape/);
            expect(() => parseFieldPredicate({ $size: 'two' })).toThrow(/Unknown filter shape/);
            expect(() => parseFieldPredicate({ $type: 'timestamp' })).toThrow(/Unknown filter shape/);
        });

        test('a value that is neither scalar, array, nor plain object is refused', () => {
            expect(() => parseFieldPredicate(new Date())).toThrow(/Unknown filter shape/);
        });
    });
});
