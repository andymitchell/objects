import { describe, it, expect } from 'vitest';
import { sortAndSliceObjects } from './sortAndSliceObjects.ts';
import { registerBigintSortTests } from './standardTests.bigint.ts';
import { standardTests, type Execute } from './standardTests.ts';

// --- Standard tests (behavioral / data-result) ---

const execute: Execute<any> = async (items, sortAndSlice, primaryKey) => {
    const result = sortAndSliceObjects(items, sortAndSlice, primaryKey);
    if (!result.success) return undefined;
    return result.items;
};

describe('sortAndSliceObjects', () => {

    standardTests({ it, expect, execute, implementationName: 'runtime' });
    registerBigintSortTests({ it, expect, execute, implementationName: 'runtime' });

    // --- Per-file only ---

    describe('Input Validation', () => {
        it('returns error for negative limit', () => {
            const items = [{ id: '1' }];
            const result = sortAndSliceObjects(items, { limit: -1 } as any, 'id');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('returns error when after_pk is used without sort', () => {
            const items = [{ id: '1' }];
            const result = sortAndSliceObjects(items, { after_pk: 'x' } as any, 'id');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors.some(e => e.message.includes('sort'))).toBe(true);
        });

        it('returns error when both offset and after_pk are provided', () => {
            const items = [{ id: '1' }];
            const result = sortAndSliceObjects(items, {
                sort: [{ key: 'id', direction: 1 }],
                offset: 5,
                after_pk: 'x',
            } as any, 'id');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors.some(e => e.message.includes('mutually exclusive'))).toBe(true);
        });

        it('returns error for non-integer limit', () => {
            const items = [{ id: '1' }];
            const result = sortAndSliceObjects(items, { limit: 1.5 } as any, 'id');
            expect(result.success).toBe(false);
        });

        it('returns error for invalid direction', () => {
            const items = [{ id: '1' }];
            const result = sortAndSliceObjects(items, {
                sort: [{ key: 'id', direction: 2 }]
            } as any, 'id');
            expect(result.success).toBe(false);
        });

        it('returns validation errors as a value when the boundary does not align with the sort', () => {
            // Type-valid (after_boundary alone), runtime-invalid (2 values against a 1-key sort):
            // the function must surface this as an error value, never throw.
            const items = [{ id: '1', score: 1 }];
            const result = sortAndSliceObjects(items, {
                sort: [{ key: 'score', direction: 1 }],
                after_boundary: { values: [1, 2], pk: '1' },
            }, 'id');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]!.type).toBe('validation');
        });
    });

    describe('After-Boundary Seek', () => {
        // Sorted ascending by score: a(10), b(20), c(30), d(40).
        const items = [
            { id: 'a', score: 10 },
            { id: 'b', score: 20 },
            { id: 'c', score: 30 },
            { id: 'd', score: 40 },
        ];
        const sort = [{ key: 'score' as const, direction: 1 as const }];

        it('returns only items ordered strictly after the boundary', () => {
            const result = sortAndSliceObjects(items, { sort, after_boundary: { values: [20], pk: 'b' } }, 'id');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.items.map(i => i.id)).toEqual(['c', 'd']);
        });

        it('excludes the boundary row itself', () => {
            const result = sortAndSliceObjects(items, { sort, after_boundary: { values: [10], pk: 'a' } }, 'id');
            if (!result.success) return;
            expect(result.items.map(i => i.id)).toEqual(['b', 'c', 'd']);
        });

        it('returns empty when the boundary is the last row', () => {
            const result = sortAndSliceObjects(items, { sort, after_boundary: { values: [40], pk: 'd' } }, 'id');
            if (!result.success) return;
            expect(result.items).toEqual([]);
        });

        it('returns empty for a stale boundary ordered past the end of the dataset', () => {
            const result = sortAndSliceObjects(items, { sort, after_boundary: { values: [999], pk: 'zzz' } }, 'id');
            if (!result.success) return;
            expect(result.items).toEqual([]);
        });

        it('applies limit after seeking past the boundary', () => {
            const result = sortAndSliceObjects(items, { sort, after_boundary: { values: [10], pk: 'a' }, limit: 2 }, 'id');
            if (!result.success) return;
            expect(result.items.map(i => i.id)).toEqual(['b', 'c']);
        });

        it('does not mutate the input array', () => {
            const snapshot = items.map(i => ({ ...i }));
            sortAndSliceObjects(items, { sort, after_boundary: { values: [20], pk: 'b' } }, 'id');
            expect(items).toEqual(snapshot);
        });
    });

    describe('Immutability', () => {
        it('does not mutate the input array', () => {
            const items = [
                { id: 'b', value: 2 },
                { id: 'a', value: 1 },
            ];
            const snapshot = [...items];
            sortAndSliceObjects(items, { sort: [{ key: 'value', direction: 1 }] }, 'id');
            expect(items).toEqual(snapshot);
        });

        it('result items are referentially the same objects as input items', () => {
            const items = [
                { id: 'a', value: 1 },
                { id: 'b', value: 2 },
            ];
            const result = sortAndSliceObjects(items, { sort: [{ key: 'value', direction: -1 }] }, 'id');
            if (!result.success) return;
            expect(result.items[0]).toBe(items[1]); // b comes first when desc
            expect(result.items[1]).toBe(items[0]);
        });
    });
});
