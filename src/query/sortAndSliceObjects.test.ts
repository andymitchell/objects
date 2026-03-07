import { describe, it, expect } from 'vitest';
import { sortAndSliceObjects } from './sortAndSliceObjects.ts';
import type { SortAndSlice } from './types.ts';
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

    // --- DEPRECATED_OLD_TESTS ---
    // these should be safe to remove as replaced
    describe('DEPRECATED_OLD_TESTS', () => {
        type Item = { id: string; date: string; score: number; name: string; nested?: { value: number } };

        const items: Item[] = [
            { id: 'a', date: '2024-01-03', score: 10, name: 'Alice' },
            { id: 'b', date: '2024-01-01', score: 30, name: 'Bob' },
            { id: 'c', date: '2024-01-02', score: 20, name: 'Charlie' },
            { id: 'd', date: '2024-01-02', score: 20, name: 'Diana' },
            { id: 'e', date: '2024-01-04', score: 10, name: 'Eve' },
        ];

        describe('sorting', () => {
            it('sorts ascending by a single key', () => {
                const result = sortAndSliceObjects(items, { sort: [{ key: 'date', direction: 1 }] }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items.map(i => i.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
            });

            it('sorts descending by a single key', () => {
                const result = sortAndSliceObjects(items, { sort: [{ key: 'score', direction: -1 }] }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items.map(i => i.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
            });

            it('sorts by multiple keys with PK tiebreaker', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'score', direction: 1 }, { key: 'date', direction: -1 }]
                }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items.map(i => i.id)).toEqual(['e', 'a', 'c', 'd', 'b']);
            });

            it('does not mutate the original array', () => {
                const original = [...items];
                sortAndSliceObjects(items, { sort: [{ key: 'score', direction: -1 }] }, 'id');
                expect(items).toEqual(original);
            });
        });

        describe('limit', () => {
            it('limits the number of results', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 1 }], limit: 2
                }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toHaveLength(2);
                expect(result.items.map(i => i.id)).toEqual(['b', 'c']);
            });

            it('limit larger than array returns all items', () => {
                const result = sortAndSliceObjects(items, { limit: 100 }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toHaveLength(items.length);
            });

            it('limit 0 returns empty', () => {
                const result = sortAndSliceObjects(items, { limit: 0 }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toHaveLength(0);
            });
        });

        describe('offset pagination', () => {
            it('skips items by offset', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 1 }], offset: 2, limit: 2
                }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items.map(i => i.id)).toEqual(['d', 'a']);
            });

            it('offset beyond array length returns empty', () => {
                const result = sortAndSliceObjects(items, { offset: 100 }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toHaveLength(0);
            });
        });

        describe('cursor pagination (after_pk)', () => {
            it('returns items after the cursor', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 1 }], after_pk: 'c', limit: 2
                }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items.map(i => i.id)).toEqual(['d', 'a']);
            });

            it('stale cursor returns empty array', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 1 }], after_pk: 'nonexistent'
                }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toEqual([]);
            });

            it('cursor at last item returns empty', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 1 }], after_pk: 'e'
                }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toEqual([]);
            });
        });

        describe('edge cases', () => {
            it('empty array returns empty', () => {
                const result = sortAndSliceObjects<{date: string; id: string}>([], { sort: [{ key: 'date', direction: 1 }] }, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toEqual([]);
            });

            it('no sort, no limit returns all items in original order', () => {
                const result = sortAndSliceObjects(items, {}, 'id');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.items).toEqual(items);
            });

            it('null values sort last regardless of direction', () => {
                type NullableItem = { id: string; value: number | null };
                const nullItems: NullableItem[] = [
                    { id: '1', value: 5 },
                    { id: '2', value: null },
                    { id: '3', value: 3 },
                    { id: '4', value: null },
                ];

                const ascResult = sortAndSliceObjects(
                    nullItems,
                    { sort: [{ key: 'value', direction: 1 }] } as SortAndSlice<NullableItem>,
                    'id'
                );
                expect(ascResult.success).toBe(true);
                if (!ascResult.success) return;
                expect(ascResult.items.map(i => i.value)).toEqual([3, 5, null, null]);

                const descResult = sortAndSliceObjects(
                    nullItems,
                    { sort: [{ key: 'value', direction: -1 }] } as SortAndSlice<NullableItem>,
                    'id'
                );
                expect(descResult.success).toBe(true);
                if (!descResult.success) return;
                expect(descResult.items.map(i => i.value)).toEqual([5, 3, null, null]);
            });
        });

        describe('validation errors', () => {
            it('returns error for negative limit', () => {
                const result = sortAndSliceObjects(items, { limit: -1 } as any, 'id');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors.length).toBeGreaterThan(0);
            });

            it('returns error for non-integer limit', () => {
                const result = sortAndSliceObjects(items, { limit: 1.5 } as any, 'id');
                expect(result.success).toBe(false);
            });

            it('returns error for offset + after_pk together', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 1 }],
                    offset: 5,
                    after_pk: 'a',
                } as any, 'id');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors.some(e => e.message.includes('mutually exclusive'))).toBe(true);
            });

            it('returns error for after_pk without sort', () => {
                const result = sortAndSliceObjects(items, { after_pk: 'a' } as any, 'id');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors.some(e => e.message.includes('sort'))).toBe(true);
            });

            it('returns error for invalid direction', () => {
                const result = sortAndSliceObjects(items, {
                    sort: [{ key: 'date', direction: 2 }]
                } as any, 'id');
                expect(result.success).toBe(false);
            });
        });
    });
});
