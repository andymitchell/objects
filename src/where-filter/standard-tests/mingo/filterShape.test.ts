import { filterShape } from "./filterShape.ts";
import { isArrayFieldPath } from "./generator.ts";

/**
 * The shape function decides what a human reads.
 *
 * A fuzz run yields thousands of disagreeing filters; grouping them by shape turns that into a handful of
 * entries someone can actually triage. Granularity is the whole game — merge too eagerly and two unrelated bugs
 * become one line, with one of them never looked at; split too eagerly and the report drowns. These pins fix
 * the granularity so a later edit cannot quietly move it.
 */
describe('filter shape', () => {

    const shape = (f: unknown): string => filterShape(f, isArrayFieldPath);

    describe('ignores what does not change the semantics', () => {

        test('two filters differing only in their operands are one shape', () => {
            expect(shape({ tags: { $eq: 'a' } })).toBe(shape({ tags: { $eq: 'zzz' } }));
        });

        test('two array fields are one shape, because the divergence is about the field being an array', () => {
            expect(shape({ tags: { $eq: 'a' } })).toBe(shape({ scores: { $eq: 9 } }));
        });

        test('the order of a logic node\'s arms does not split a shape', () => {
            const a = shape({ $or: [{ name: 'x' }, { tags: { $size: 1 } }] });
            const b = shape({ $or: [{ tags: { $size: 2 } }, { name: 'y' }] });
            expect(a).toBe(b);
        });
    });

    describe('separates what does change the semantics', () => {

        test('an array field and a scalar field are different shapes', () => {
            expect(shape({ tags: { $eq: 'a' } })).not.toBe(shape({ name: { $eq: 'a' } }));
        });

        test('different operators are different shapes', () => {
            expect(shape({ tags: { $eq: 'a' } })).not.toBe(shape({ tags: { $size: 1 } }));
        });

        test('an empty $all is a different shape from a populated one — emptiness is the divergence', () => {
            expect(shape({ tags: { $all: [] } })).not.toBe(shape({ tags: { $all: ['a'] } }));
        });

        test('a nested predicate is described, not collapsed', () => {
            expect(shape({ tags: { $elemMatch: { $exists: true } } }))
                .not.toBe(shape({ tags: { $elemMatch: { $eq: 'a' } } }));
        });

        test('a $not is distinguished from the bare operator it negates', () => {
            expect(shape({ tags: { $not: { $eq: 'a' } } })).not.toBe(shape({ tags: { $eq: 'a' } }));
        });
    });

    describe('reads as a human-triagable label', () => {

        test('a comparison on an array field names both the field kind and the operator', () => {
            expect(shape({ tags: { $eq: 'a' } })).toBe('array:{$eq}');
        });

        test('an empty $all is legible at a glance', () => {
            expect(shape({ tags: { $all: [] } })).toBe('array:{$all(empty)}');
        });

        test('a scalar $elemMatch body is spelled out', () => {
            expect(shape({ tags: { $elemMatch: { $exists: true, $eq: 'a' } } }))
                .toBe('array:{$elemMatch({$eq,$exists})}');
        });
    });
});
