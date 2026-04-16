import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { SortAndSliceBaseSchema, SortAndSliceSchema, SortAndSliceCursorSchema } from './schemas.ts';
import type { SortAndSlice, SortAndSliceBase, SortAndSliceCursor } from './types.ts';

describe('SortAndSliceSchema', () => {

    describe('Valid Inputs', () => {
        it('accepts an empty object with all fields omitted', () => {
            const result = SortAndSliceSchema.safeParse({});
            expect(result.success).toBe(true);
        });

        it('accepts sort-only configuration', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }]
            });
            expect(result.success).toBe(true);
        });

        it('accepts sort with limit', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }],
                limit: 20
            });
            expect(result.success).toBe(true);
        });

        it('accepts sort with limit and offset', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }],
                limit: 20,
                offset: 40
            });
            expect(result.success).toBe(true);
        });

        it('accepts sort with limit and string after_pk', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }],
                limit: 20,
                after_pk: 'abc'
            });
            expect(result.success).toBe(true);
        });

        it('accepts sort with limit and numeric after_pk', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }],
                limit: 20,
                after_pk: 42
            });
            expect(result.success).toBe(true);
        });

        it('accepts an empty sort array', () => {
            const result = SortAndSliceSchema.safeParse({ sort: [] });
            expect(result.success).toBe(true);
        });

        it('accepts limit of zero', () => {
            const result = SortAndSliceSchema.safeParse({ limit: 0 });
            expect(result.success).toBe(true);
        });

        it('accepts offset of zero', () => {
            const result = SortAndSliceSchema.safeParse({ offset: 0 });
            expect(result.success).toBe(true);
        });
    });

    describe('Rejected Inputs', () => {
        it('rejects direction values other than 1 or -1', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'x', direction: 0 }]
            });
            expect(result.success).toBe(false);
        });

        it('rejects negative limit', () => {
            const result = SortAndSliceSchema.safeParse({ limit: -1 });
            expect(result.success).toBe(false);
        });

        it('rejects non-integer limit', () => {
            const result = SortAndSliceSchema.safeParse({ limit: 1.5 });
            expect(result.success).toBe(false);
        });

        it('rejects negative offset', () => {
            const result = SortAndSliceSchema.safeParse({ offset: -1 });
            expect(result.success).toBe(false);
        });

        it('rejects non-integer offset', () => {
            const result = SortAndSliceSchema.safeParse({ offset: 2.5 });
            expect(result.success).toBe(false);
        });

        it('rejects boolean after_pk', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'x', direction: 1 }],
                after_pk: true
            });
            expect(result.success).toBe(false);
        });

        it('rejects null after_pk', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'x', direction: 1 }],
                after_pk: null
            });
            expect(result.success).toBe(false);
        });

        it('rejects or strips unrecognized properties', () => {
            const result = SortAndSliceSchema.safeParse({ limit: 10, foo: 'bar' });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect('foo' in result.data).toBe(false);
        });

        it('returns multiple errors when several fields are invalid simultaneously', () => {
            const result = SortAndSliceSchema.safeParse({ limit: -1, offset: -1 });
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Mutual Exclusion (offset / after_pk)', () => {
        it('rejects when both offset and after_pk are present', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [{ key: 'x', direction: 1 }],
                offset: 10,
                after_pk: 'abc'
            });
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.issues.some(i => i.message.includes('mutually exclusive'))).toBe(true);
        });

        it('rejects after_pk with empty sort array', () => {
            const result = SortAndSliceSchema.safeParse({
                sort: [],
                after_pk: 'abc'
            });
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.issues.some(i => i.message.includes('sort'))).toBe(true);
        });

        it('rejects after_pk with no sort field', () => {
            const result = SortAndSliceSchema.safeParse({ after_pk: 'abc' });
            expect(result.success).toBe(false);
        });
    });

    describe('Type Alignment', () => {
        it('inferred schema base fields match manual SortAndSlice base fields', () => {
            // The base fields (sort, limit) should be structurally compatible
            type Inferred = z.infer<typeof SortAndSliceSchema>;
            expectTypeOf<Inferred['sort']>().toEqualTypeOf<Array<{ key: string; direction: 1 | -1 }> | undefined>();
            expectTypeOf<Inferred['limit']>().toEqualTypeOf<number | undefined>();
        });

        it('manual SortAndSlice type is assignable to inferred schema type', () => {
            type Inferred = z.infer<typeof SortAndSliceSchema>;
            // Manual type is narrower (discriminated union), so it should be assignable to the wider schema type
            expectTypeOf<SortAndSlice<any>>().toMatchTypeOf<Inferred>();
        });
    });

    describe('Invariants', () => {
        it('parsing a valid output again produces the same result', () => {
            const input = {
                sort: [{ key: 'date', direction: -1 as const }],
                limit: 20,
                offset: 5,
            };
            const first = SortAndSliceSchema.parse(input);
            const second = SortAndSliceSchema.parse(first);
            expect(first).toEqual(second);
        });
    });
});

describe('SortAndSliceBaseSchema', () => {

    describe('Valid Inputs', () => {
        it('accepts an empty object', () => {
            expect(SortAndSliceBaseSchema.safeParse({}).success).toBe(true);
        });

        it('accepts sort and limit', () => {
            const result = SortAndSliceBaseSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }],
                limit: 20,
            });
            expect(result.success).toBe(true);
        });
    });

    describe('Rejected Inputs', () => {
        it('strips offset (not part of base)', () => {
            const result = SortAndSliceBaseSchema.safeParse({ limit: 10, offset: 5 });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect('offset' in result.data).toBe(false);
        });

        it('strips after_pk (not part of base)', () => {
            const result = SortAndSliceBaseSchema.safeParse({ sort: [{ key: 'x', direction: 1 }], after_pk: 'abc' });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect('after_pk' in result.data).toBe(false);
        });

        it('strips cursor (not part of base)', () => {
            const result = SortAndSliceBaseSchema.safeParse({ limit: 10, cursor: 'abc' });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect('cursor' in result.data).toBe(false);
        });

        it('rejects negative limit', () => {
            expect(SortAndSliceBaseSchema.safeParse({ limit: -1 }).success).toBe(false);
        });
    });

    describe('Type Alignment', () => {
        it('SortAndSlice extends SortAndSliceBase (assignability)', () => {
            expectTypeOf<SortAndSlice<any>>().toMatchTypeOf<SortAndSliceBase<any>>();
        });

        it('SortAndSliceCursor extends SortAndSliceBase (assignability)', () => {
            expectTypeOf<SortAndSliceCursor<any>>().toMatchTypeOf<SortAndSliceBase<any>>();
        });
    });
});

describe('SortAndSliceCursorSchema', () => {

    describe('Valid Inputs', () => {
        it('accepts an empty object (first page, no cursor)', () => {
            expect(SortAndSliceCursorSchema.safeParse({}).success).toBe(true);
        });

        it('accepts cursor string', () => {
            const result = SortAndSliceCursorSchema.safeParse({ cursor: 'abc123' });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.data.cursor).toBe('abc123');
        });

        it('accepts sort, limit, and cursor together', () => {
            const result = SortAndSliceCursorSchema.safeParse({
                sort: [{ key: 'date', direction: -1 }],
                limit: 20,
                cursor: 'pageToken_xyz',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('Rejected Inputs', () => {
        it('rejects non-string cursor', () => {
            expect(SortAndSliceCursorSchema.safeParse({ cursor: 42 }).success).toBe(false);
        });

        it('rejects boolean cursor', () => {
            expect(SortAndSliceCursorSchema.safeParse({ cursor: true }).success).toBe(false);
        });

        it('strips offset (not part of cursor mode)', () => {
            const result = SortAndSliceCursorSchema.safeParse({ cursor: 'abc', offset: 10 });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect('offset' in result.data).toBe(false);
        });

        it('strips after_pk (not part of cursor mode)', () => {
            const result = SortAndSliceCursorSchema.safeParse({ cursor: 'abc', after_pk: 'xyz' });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect('after_pk' in result.data).toBe(false);
        });
    });

    describe('Type Alignment', () => {
        it('inferred schema type matches manual SortAndSliceCursor fields', () => {
            type Inferred = z.infer<typeof SortAndSliceCursorSchema>;
            expectTypeOf<Inferred['sort']>().toEqualTypeOf<Array<{ key: string; direction: 1 | -1 }> | undefined>();
            expectTypeOf<Inferred['limit']>().toEqualTypeOf<number | undefined>();
            expectTypeOf<Inferred['cursor']>().toEqualTypeOf<string | undefined>();
        });

        it('manual SortAndSliceCursor type is assignable to inferred schema type', () => {
            type Inferred = z.infer<typeof SortAndSliceCursorSchema>;
            expectTypeOf<SortAndSliceCursor<any>>().toMatchTypeOf<Inferred>();
        });

        it('SortAndSlice does not accept cursor field', () => {
            // @ts-expect-error — cursor is not part of SortAndSlice
            const _invalid: SortAndSlice<any> = { limit: 20, cursor: 'abc' };
        });

        it('SortAndSliceCursor does not accept offset field', () => {
            // @ts-expect-error — offset is not part of SortAndSliceCursor
            const _invalid: SortAndSliceCursor<any> = { limit: 20, offset: 5 };
        });

        it('SortAndSliceCursor does not accept after_pk field', () => {
            // @ts-expect-error — after_pk is not part of SortAndSliceCursor
            const _invalid: SortAndSliceCursor<any> = { limit: 20, after_pk: 'abc' };
        });
    });

    describe('Invariants', () => {
        it('parsing a valid output again produces the same result', () => {
            const input = {
                sort: [{ key: 'date', direction: -1 as const }],
                limit: 20,
                cursor: 'abc',
            };
            const first = SortAndSliceCursorSchema.parse(input);
            const second = SortAndSliceCursorSchema.parse(first);
            expect(first).toEqual(second);
        });
    });
});
