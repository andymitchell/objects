import { describe, it, expect } from 'vitest';
import { sortAndSliceObjects } from './sortAndSliceObjects.ts';
import { standardTests, type Execute } from './standardTests.ts';

// --- Standard tests (behavioral / data-result) ---

const execute: Execute<any> = async (items, sortAndSlice, primaryKey) => {
    const result = sortAndSliceObjects(items, sortAndSlice, primaryKey);
    if (!result.success) return undefined;
    return result.items;
};

describe('sortAndSliceObjects', () => {

    standardTests({ it, expect, execute, implementationName: 'runtime' });

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
