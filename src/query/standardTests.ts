import type { SortAndSlice } from './types.ts';

/**
 * Uniform execute signature for standard tests.
 * All adapters (runtime, object-table SQL, column-table SQL) implement this.
 * Returns `undefined` to signal "not supported by this adapter" — the test skips.
 */
export type Execute<T extends Record<string, any>> = (
    items: T[],
    sortAndSlice: SortAndSlice<T>,
    primaryKey: keyof T & string
) => Promise<T[] | undefined>;

type StandardTestConfig = {
    it: typeof import('vitest').it;
    expect: typeof import('vitest').expect;
    execute: Execute<any>;
    implementationName?: string;
};

// --- Fixtures ---

type NumericItem = { id: string; age: number; name: string; category: string; date: string };
type NullableItem = { id: string; value: number | null };
type UndefinedItem = { id: string; value?: number };
type NestedItem = { id: string; sender: { name: string } };
type TiedItem = { id: string; score: number };

const numericItems: NumericItem[] = [
    { id: 'a', age: 30, name: 'Charlie', category: 'B', date: '2024-01-03' },
    { id: 'b', age: 10, name: 'Alice', category: 'A', date: '2024-01-01' },
    { id: 'c', age: 20, name: 'Bob', category: 'A', date: '2024-01-02' },
    { id: 'd', age: 40, name: 'Diana', category: 'B', date: '2024-01-04' },
    { id: 'e', age: 25, name: 'Eve', category: 'A', date: '2024-01-05' },
];

const nullableItems: NullableItem[] = [
    { id: '1', value: 5 },
    { id: '2', value: null },
    { id: '3', value: 3 },
    { id: '4', value: null },
];

const undefinedItems: UndefinedItem[] = [
    { id: '1', value: 5 },
    { id: '2' },
    { id: '3', value: 3 },
    { id: '4' },
];

const nestedItems: NestedItem[] = [
    { id: 'x', sender: { name: 'Zara' } },
    { id: 'y', sender: { name: 'Alice' } },
    { id: 'z', sender: { name: 'Mike' } },
];

const tiedItems: TiedItem[] = [
    { id: 'c', score: 10 },
    { id: 'a', score: 10 },
    { id: 'b', score: 10 },
];

// 10 items for limit/offset/cursor tests, using PK ASC as default sort
const tenItems: NumericItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i).padStart(2, '0'),
    age: (i + 1) * 10,
    name: `Name${i}`,
    category: i % 2 === 0 ? 'even' : 'odd',
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
}));

/**
 * Shared behavioral tests for sort-and-slice functionality.
 * Called by each adapter test file with its own `execute` implementation.
 *
 * @example
 * standardTests({ it, expect, execute: myAdapter, implementationName: 'runtime' });
 */
export function standardTests(config: StandardTestConfig) {
    const { it, expect, execute } = config;
    const implementationName = config.implementationName ?? 'unknown';

    /** Helper: run execute, skip if undefined (unsupported). */
    async function run<T extends Record<string, any>>(
        items: T[],
        sortAndSlice: SortAndSlice<T>,
        pk: keyof T & string
    ): Promise<T[] | 'skipped'> {
        const result = await execute(items, sortAndSlice, pk);
        if (result === undefined) {
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] test skipped`);
            return 'skipped';
        }
        return result;
    }

    // Default sort: PK ASC — ensures deterministic results for non-sort-specific tests
    const defaultSort = { sort: [{ key: 'id' as const, direction: 1 as const }] };

    describe('Sorting', () => {

        describe('Single Key', () => {
            it('sorts ascending by a numeric field', async () => {
                const result = await run(numericItems, { sort: [{ key: 'age', direction: 1 }] }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.age)).toEqual([10, 20, 25, 30, 40]);
            });

            it('sorts descending by a string field', async () => {
                const result = await run(numericItems, { sort: [{ key: 'name', direction: -1 }] }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.name)).toEqual(['Eve', 'Diana', 'Charlie', 'Bob', 'Alice']);
            });
        });

        describe('Multi-Key', () => {
            it('uses secondary key to break ties on primary', async () => {
                const result = await run(numericItems, {
                    sort: [{ key: 'category', direction: 1 }, { key: 'name', direction: 1 }]
                }, 'id');
                if (result === 'skipped') return;
                // A: Alice, Bob, Eve; B: Charlie, Diana
                expect(result.map(i => i.name)).toEqual(['Alice', 'Bob', 'Eve', 'Charlie', 'Diana']);
            });

            it('respects independent direction per key', async () => {
                const result = await run(numericItems, {
                    sort: [{ key: 'category', direction: 1 }, { key: 'date', direction: -1 }]
                }, 'id');
                if (result === 'skipped') return;
                // A: dates desc (Eve 01-05, Bob 01-02, Alice 01-01); B: dates desc (Diana 01-04, Charlie 01-03)
                expect(result.map(i => i.id)).toEqual(['e', 'c', 'b', 'd', 'a']);
            });
        });

        describe('Null / Undefined Values', () => {
            it('places null sort values after all non-null (ascending)', async () => {
                const result = await run(
                    nullableItems,
                    { sort: [{ key: 'value', direction: 1 }] } as SortAndSlice<NullableItem>,
                    'id'
                );
                if (result === 'skipped') return;
                expect(result.map(i => i.value)).toEqual([3, 5, null, null]);
            });

            it('places undefined sort values after all non-null (ascending)', async () => {
                const result = await run(
                    undefinedItems,
                    { sort: [{ key: 'value', direction: 1 }] } as SortAndSlice<UndefinedItem>,
                    'id'
                );
                if (result === 'skipped') return;
                // Non-null first sorted, then undefined last
                const values = result.map(i => i.value);
                expect(values[0]).toBe(3);
                expect(values[1]).toBe(5);
                expect(values[2]).toBeUndefined();
                expect(values[3]).toBeUndefined();
            });

            it('null-last applies regardless of sort direction', async () => {
                const result = await run(
                    nullableItems,
                    { sort: [{ key: 'value', direction: -1 }] } as SortAndSlice<NullableItem>,
                    'id'
                );
                if (result === 'skipped') return;
                expect(result.map(i => i.value)).toEqual([5, 3, null, null]);
            });
        });

        describe('PK Tiebreaker', () => {
            it('deterministic order when all sort values are identical', async () => {
                const result = await run(tiedItems, { sort: [{ key: 'score', direction: 1 }] }, 'id');
                if (result === 'skipped') return;
                // All score=10, PK tiebreaker ASC: a, b, c
                expect(result.map(i => i.id)).toEqual(['a', 'b', 'c']);
            });
        });

        describe('Nested Properties', () => {
            it('sorts by a dot-prop path into nested objects', async () => {
                const result = await run(
                    nestedItems,
                    { sort: [{ key: 'sender.name' as any, direction: 1 }] },
                    'id'
                );
                if (result === 'skipped') return;
                expect(result.map(i => i.sender.name)).toEqual(['Alice', 'Mike', 'Zara']);
            });
        });
    });

    // All limit/offset/cursor tests use default sort (PK ASC) for determinism

    describe('Limit', () => {
        it('returns at most N items', async () => {
            const result = await run(tenItems, { ...defaultSort, limit: 3 }, 'id');
            if (result === 'skipped') return;
            expect(result).toHaveLength(3);
            expect(result.map(i => i.id)).toEqual(['00', '01', '02']);
        });

        it('returns all when limit exceeds array length', async () => {
            const result = await run(numericItems, { ...defaultSort, limit: 100 }, 'id');
            if (result === 'skipped') return;
            expect(result).toHaveLength(numericItems.length);
        });

        it('returns empty when limit is zero', async () => {
            const result = await run(numericItems, { ...defaultSort, limit: 0 }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual([]);
        });
    });

    describe('Offset Pagination', () => {
        it('skips the first N items', async () => {
            const result = await run(tenItems, { ...defaultSort, offset: 7 }, 'id');
            if (result === 'skipped') return;
            expect(result.map(i => i.id)).toEqual(['07', '08', '09']);
        });

        it('returns empty when offset exceeds length', async () => {
            const result = await run(numericItems, { ...defaultSort, offset: 100 }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual([]);
        });

        it('combines offset and limit correctly', async () => {
            const result = await run(tenItems, { ...defaultSort, offset: 3, limit: 2 }, 'id');
            if (result === 'skipped') return;
            expect(result.map(i => i.id)).toEqual(['03', '04']);
        });
    });

    describe('Cursor Pagination (after_pk)', () => {

        describe('Basic Cursor', () => {
            it('returns items after the cursor, excluding the cursor itself', async () => {
                const items = tenItems.slice(0, 5); // 00..04
                const result = await run(items, { sort: [{ key: 'id', direction: 1 }], after_pk: '01' }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(['02', '03', '04']);
            });

            it('returns items after cursor with limit', async () => {
                const items = tenItems.slice(0, 5);
                const result = await run(items, { sort: [{ key: 'id', direction: 1 }], after_pk: '01', limit: 2 }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(['02', '03']);
            });

            it('returns empty when cursor is last item', async () => {
                const items = tenItems.slice(0, 3);
                const result = await run(items, { sort: [{ key: 'id', direction: 1 }], after_pk: '02' }, 'id');
                if (result === 'skipped') return;
                expect(result).toEqual([]);
            });

            it('returns all except first when cursor is first item', async () => {
                const items = tenItems.slice(0, 3);
                const result = await run(items, { sort: [{ key: 'id', direction: 1 }], after_pk: '00' }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(['01', '02']);
            });
        });

        describe('Stale / Missing Cursor', () => {
            it('returns empty when after_pk matches no item', async () => {
                const result = await run(numericItems, { sort: [{ key: 'id', direction: 1 }], after_pk: 'nonexistent' }, 'id');
                if (result === 'skipped') return;
                expect(result).toEqual([]);
            });
        });

        describe('Sequential Pagination Completeness', () => {
            it('paginating through entire dataset yields every item exactly once', async () => {
                const pageSize = 3;
                const allCollected: NumericItem[] = [];
                let afterPk: string | undefined;

                for (let i = 0; i < 20; i++) { // safety cap
                    const sortAndSlice: SortAndSlice<NumericItem> = {
                        sort: [{ key: 'id', direction: 1 }],
                        limit: pageSize,
                        ...(afterPk !== undefined ? { after_pk: afterPk } : {}),
                    };
                    const page = await run(tenItems, sortAndSlice, 'id');
                    if (page === 'skipped') return;
                    if (page.length === 0) break;
                    allCollected.push(...page);
                    afterPk = page[page.length - 1]!.id;
                }

                expect(allCollected.map(i => i.id)).toEqual(tenItems.map(i => i.id).sort());
            });

            it('completeness holds when items have duplicate sort values', async () => {
                // Items with many duplicate sort values
                const dupeItems: TiedItem[] = [
                    { id: 'a', score: 1 },
                    { id: 'b', score: 1 },
                    { id: 'c', score: 1 },
                    { id: 'd', score: 2 },
                    { id: 'e', score: 2 },
                ];
                const pageSize = 2;
                const allCollected: TiedItem[] = [];
                let afterPk: string | undefined;

                for (let i = 0; i < 20; i++) {
                    const sortAndSlice: SortAndSlice<TiedItem> = {
                        sort: [{ key: 'score', direction: 1 }],
                        limit: pageSize,
                        ...(afterPk !== undefined ? { after_pk: afterPk } : {}),
                    };
                    const page = await run(dupeItems, sortAndSlice, 'id');
                    if (page === 'skipped') return;
                    if (page.length === 0) break;
                    allCollected.push(...page);
                    afterPk = page[page.length - 1]!.id;
                }

                const collectedIds = allCollected.map(i => i.id).sort();
                expect(collectedIds).toEqual(['a', 'b', 'c', 'd', 'e']);
            });
        });
    });

    describe('Composition', () => {
        it('applies sort before limit', async () => {
            // Unsorted input, sort ASC by age, limit 2 → should get the 2 youngest
            const result = await run(numericItems, { sort: [{ key: 'age', direction: 1 }], limit: 2 }, 'id');
            if (result === 'skipped') return;
            expect(result.map(i => i.age)).toEqual([10, 20]);
        });

        it('applies sort before offset', async () => {
            const result = await run(numericItems, { sort: [{ key: 'age', direction: 1 }], offset: 2 }, 'id');
            if (result === 'skipped') return;
            // Sorted by age: 10,20,25,30,40 → offset 2 → 25,30,40
            expect(result.map(i => i.age)).toEqual([25, 30, 40]);
        });

        it('returns all items unchanged when SortAndSlice is empty', async () => {
            const result = await run(numericItems, {}, 'id');
            if (result === 'skipped') return;
            // All items present (order may vary)
            expect(result).toHaveLength(numericItems.length);
            const ids = result.map(i => i.id).sort();
            expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
        });

        it('returns at most N items when only limit is set (no sort)', async () => {
            const result = await run(tenItems, { limit: 3 }, 'id');
            if (result === 'skipped') return;
            expect(result).toHaveLength(3);
        });
    });

    describe('Invariants', () => {
        it('calling twice with same input returns identical result', async () => {
            const sortAndSlice: SortAndSlice<NumericItem> = { ...defaultSort, limit: 3 };
            const r1 = await run(numericItems, sortAndSlice, 'id');
            const r2 = await run(numericItems, sortAndSlice, 'id');
            if (r1 === 'skipped' || r2 === 'skipped') return;
            expect(r1).toEqual(r2);
        });

        it('limit N result is a prefix of limit N+1 result', async () => {
            const rN = await run(tenItems, { ...defaultSort, limit: 3 }, 'id');
            const rN1 = await run(tenItems, { ...defaultSort, limit: 4 }, 'id');
            if (rN === 'skipped' || rN1 === 'skipped') return;
            expect(rN1.slice(0, 3)).toEqual(rN);
        });

        it('offset pages are complementary with limit', async () => {
            const page1 = await run(tenItems, { ...defaultSort, offset: 0, limit: 4 }, 'id');
            const page2 = await run(tenItems, { ...defaultSort, offset: 4, limit: 3 }, 'id');
            const combined = await run(tenItems, { ...defaultSort, limit: 7 }, 'id');
            if (page1 === 'skipped' || page2 === 'skipped' || combined === 'skipped') return;
            expect([...page1, ...page2]).toEqual(combined);
        });
    });

    describe('Edge Cases', () => {
        it('handles empty input array', async () => {
            const result = await run([] as NumericItem[], { ...defaultSort }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual([]);
        });

        it('handles single-item array', async () => {
            const single = [numericItems[0]!];
            const result = await run(single, { sort: [{ key: 'age', direction: 1 }] }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual(single);
        });
    });
}
