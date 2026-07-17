import type { describe, expect, it } from 'vitest';

import type { DDL } from '../ddl/types.ts';
import { registerAfterBoundaryTests } from './standardTests.boundary.ts';
import type { SortAndSlice, SortDefinition } from './types.ts';
import {
    type BooleanItem,
    type NullableItem,
    type NullishItem,
    type NumericItem,
    type StandardTestItem,
    type TiedItem,
    type UndefinedItem,
    type UnicodeItem,
    STANDARD_TEST_DDL,
    booleanItems,
    multiTiedItems,
    nestedItems,
    nullableItems,
    nullishItems,
    numericItems,
    tenItems,
    tiedItems,
    undefinedItems,
    unicodeItems,
} from './standardTestFixtures.ts';

/**
 * Uniform execute signature for standard tests.
 * All adapters (runtime, object-table SQL, column-table SQL) implement this.
 * Returns `undefined` to signal "not supported by this adapter at runtime" — the
 * test skips. Static skipping based on declared `sortable_keys` is preferred
 * (see `StandardTestConfig.ddl`); this `undefined` path is the runtime fallback
 * for cases the static declaration can't capture (e.g. direction-restricted impls).
 */
export type Execute<T extends Record<string, any>> = (
    items: T[],
    sortAndSlice: SortAndSlice<T>,
    primaryKey: keyof T & string
) => Promise<T[] | undefined>;

type StandardTestConfig<T extends Record<string, any> = StandardTestItem> = {
    it: typeof it;
    expect: typeof expect;
    execute: Execute<T>;
    implementationName?: string;
    /**
     * The DDL the implementation built with. Used to read `lists['.'].sortable_keys`
     * for per-test gating: tests whose sort keys aren't in the allowlist register as
     * `it.skip` rather than running.
     *
     * Omit (or pass `undefined`) to use `STANDARD_TEST_DDL` (= arbitrary — every test runs). Provide a DDL
     * with restricted `sortable_keys` to declare a limited set; e.g. Gmail bridge
     * passes `sortable_keys: []` so all sort tests skip statically.
     */
    ddl?: DDL<T> | undefined;
    /**
     * Optional `describe` override. Defaults to the runner's global `describe`, so a runner with
     * globals enabled (Vitest: `globals: true`) needs no override; without one available, the call
     * throws rather than registering a partial tree.
     *
     * Supply it to run under a runner without globals, or for a meta-test that wants to inspect what
     * `standardTests` registers without polluting the real test tree (pass a stub that invokes the
     * callback but doesn't register a group).
     */
    describe?: typeof describe;
};

/**
 * Shared behavioral tests for sort-and-slice functionality.
 * Called by each adapter test file with its own `execute` implementation.
 *
 * @example
 * standardTests({ it, expect, execute: myAdapter, implementationName: 'runtime' });
 *
 * @example
 * // Restrict to single sort key — multi-key tests will be skipped statically.
 * standardTests({
 *     it, expect, execute,
 *     ddl: { ...STANDARD_TEST_DDL, lists: { '.': { primary_key: 'id', sortable_keys: [{ key: 'age' }] } } },
 * });
 */
export function standardTests<T extends Record<string, any> = StandardTestItem>(config: StandardTestConfig<T>) {
    const { it, expect, execute } = config;
    // Resolved from the runner's globals rather than imported: importing vitest here would vendor a second
    // copy of the runner into the published bundle, which overwrites the consumer's expect-global state.
    const globalDescribe: unknown = Reflect.get(globalThis, 'describe');
    const describe = config.describe ?? (typeof globalDescribe === 'function' ? globalDescribe as StandardTestConfig<T>['describe'] : undefined);
    if (typeof describe !== 'function') {
        throw new Error("standardTests: no `describe` available. Enable your test runner's globals (Vitest: `globals: true`), or pass `describe` explicitly in the config.");
    }
    const implementationName = config.implementationName ?? 'unknown';

    const sortableKeys = (config.ddl ?? (STANDARD_TEST_DDL as unknown as DDL<T>)).lists['.'].sortable_keys;
    // Each sortable_keys entry is a `SortableKeyRule` (`{ key, direction? }`) — gating keys off `.key` (direction is a runtime concern).
    const allowedKeys = sortableKeys ? new Set<string>(sortableKeys.map(e => e.key as string)) : undefined;

    /**
     * Per-test gate. When the impl declares `sortable_keys`, tests whose sort uses
     * keys outside the allowlist register as `it.skip`. Tests with no sort (empty/undefined)
     * always run.
     */
    const itIfSupported = (sort: SortDefinition<any> | undefined) => {
        if (!allowedKeys) return it;
        if (!sort || sort.length === 0) return it;
        return sort.every(e => allowedKeys.has(e.key as string)) ? it : it.skip;
    };

    /** Helper: run execute, skip if undefined (unsupported at runtime — fallback to static skip). */
    async function run<U extends Record<string, any>>(
        items: U[],
        sortAndSlice: SortAndSlice<U>,
        pk: keyof U & string
    ): Promise<U[] | 'skipped'> {
        const result = await (execute as unknown as Execute<U>)(items, sortAndSlice, pk);
        if (result === undefined) {
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] test skipped`);
            return 'skipped';
        }
        return result;
    }

    // Default sort: PK ASC — ensures deterministic results for non-sort-specific tests
    const defaultSort = { sort: [{ key: 'id' as const, direction: 1 as const }] };
    const sortAge: SortDefinition<any> = [{ key: 'age', direction: 1 }];
    const sortName: SortDefinition<any> = [{ key: 'name', direction: -1 }];
    const sortNameAsc: SortDefinition<any> = [{ key: 'name', direction: 1 }];
    const sortCategoryName: SortDefinition<any> = [{ key: 'category', direction: 1 }, { key: 'name', direction: 1 }];
    const sortCategoryDate: SortDefinition<any> = [{ key: 'category', direction: 1 }, { key: 'date', direction: -1 }];
    const sortValue: SortDefinition<any> = [{ key: 'value', direction: 1 }];
    const sortValueDesc: SortDefinition<any> = [{ key: 'value', direction: -1 }];
    const sortScore: SortDefinition<any> = [{ key: 'score', direction: 1 }];
    const sortScoreDesc: SortDefinition<any> = [{ key: 'score', direction: -1 }];
    const sortScoreDate: SortDefinition<any> = [{ key: 'score', direction: 1 }, { key: 'date', direction: -1 }];
    const sortNested: SortDefinition<any> = [{ key: 'sender.name', direction: 1 }];
    const sortFlag: SortDefinition<any> = [{ key: 'flag', direction: 1 }];
    const sortFlagDesc: SortDefinition<any> = [{ key: 'flag', direction: -1 }];
    const sortId: SortDefinition<any> = defaultSort.sort;

    describe('Sorting', () => {

        describe('Single Key', () => {
            itIfSupported(sortAge)('sorts ascending by a numeric field', async () => {
                const result = await run(numericItems, { sort: sortAge }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.age)).toEqual([10, 20, 25, 30, 40]);
            });

            itIfSupported(sortName)('sorts descending by a string field', async () => {
                const result = await run(numericItems, { sort: sortName }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.name)).toEqual(['Eve', 'Diana', 'Charlie', 'Bob', 'Alice']);
            });

            itIfSupported(sortNameAsc)('orders strings by Unicode code point', async () => {
                // Code-point order: '' (b) < 'zz' (d) < U+E000 (a) < U+10000 (c). An implementation
                // comparing by UTF-16 code unit would place the surrogate-pair U+10000 before U+E000.
                const ascending = await run(
                    unicodeItems,
                    { sort: sortNameAsc } as SortAndSlice<UnicodeItem>,
                    'id'
                );
                if (ascending === 'skipped') return;
                expect(ascending.map(i => i.id)).toEqual(['b', 'd', 'a', 'c']);

                const descending = await run(
                    unicodeItems,
                    { sort: sortName } as SortAndSlice<UnicodeItem>,
                    'id'
                );
                if (descending === 'skipped') return;
                expect(descending.map(i => i.id)).toEqual(['c', 'a', 'd', 'b']);
            });

            itIfSupported(sortFlag)('orders boolean sort values false before true with pk tiebreak', async () => {
                const ascending = await run(
                    booleanItems,
                    { sort: sortFlag } as SortAndSlice<BooleanItem>,
                    'id'
                );
                if (ascending === 'skipped') return;
                expect(ascending.map(i => i.id)).toEqual(['a', 'd', 'b', 'c']);

                const descending = await run(
                    booleanItems,
                    { sort: sortFlagDesc } as SortAndSlice<BooleanItem>,
                    'id'
                );
                if (descending === 'skipped') return;
                expect(descending.map(i => i.id)).toEqual(['b', 'c', 'a', 'd']);
            });
        });

        describe('Multi-Key', () => {
            itIfSupported(sortCategoryName)('uses secondary key to break ties on primary', async () => {
                const result = await run(numericItems, { sort: sortCategoryName }, 'id');
                if (result === 'skipped') return;
                // A: Alice, Bob, Eve; B: Charlie, Diana
                expect(result.map(i => i.name)).toEqual(['Alice', 'Bob', 'Eve', 'Charlie', 'Diana']);
            });

            itIfSupported(sortCategoryDate)('respects independent direction per key', async () => {
                const result = await run(numericItems, { sort: sortCategoryDate }, 'id');
                if (result === 'skipped') return;
                // A: dates desc (Eve 01-05, Bob 01-02, Alice 01-01); B: dates desc (Diana 01-04, Charlie 01-03)
                expect(result.map(i => i.id)).toEqual(['e', 'c', 'b', 'd', 'a']);
            });
        });

        // Mixed-type sort values (e.g. a number and a string under one key) are deliberately not
        // exercised here: typed SQL implementations rightly refuse rows that violate their schema,
        // so cross-type ordering cannot be a shared black-box contract. It is pinned by unit tests
        // on the comparator instead.
        describe('Null / Undefined Values', () => {
            itIfSupported(sortValue)('places null sort values after all non-null (ascending)', async () => {
                const result = await run(
                    nullableItems,
                    { sort: sortValue } as SortAndSlice<NullableItem>,
                    'id'
                );
                if (result === 'skipped') return;
                expect(result.map(i => i.value)).toEqual([3, 5, null, null]);
            });

            itIfSupported(sortValue)('places undefined sort values after all non-null (ascending)', async () => {
                const result = await run(
                    undefinedItems,
                    { sort: sortValue } as SortAndSlice<UndefinedItem>,
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

            itIfSupported(sortValueDesc)('null-last applies regardless of sort direction', async () => {
                const result = await run(
                    nullableItems,
                    { sort: sortValueDesc } as SortAndSlice<NullableItem>,
                    'id'
                );
                if (result === 'skipped') return;
                expect(result.map(i => i.value)).toEqual([5, 3, null, null]);
            });

            itIfSupported(sortValueDesc)('places undefined sort values after all non-null regardless of sort direction', async () => {
                const result = await run(
                    undefinedItems,
                    { sort: sortValueDesc } as SortAndSlice<UndefinedItem>,
                    'id'
                );
                if (result === 'skipped') return;
                // Present values descending (5 → '1', 3 → '3'), then the undefined rows in pk ASC order
                expect(result.map(i => i.id)).toEqual(['1', '3', '2', '4']);
            });

            itIfSupported(sortValue)('null and undefined sort as one group, ordered within by the pk tiebreaker', async () => {
                const ascending = await run(
                    nullishItems,
                    { sort: sortValue } as SortAndSlice<NullishItem>,
                    'id'
                );
                if (ascending === 'skipped') return;
                // Present values ascending (3 → '4', 5 → '1'), then the null/absent rows in pk ASC order
                expect(ascending.map(i => i.id)).toEqual(['4', '1', '2', '3', '5']);

                const descending = await run(
                    nullishItems,
                    { sort: sortValueDesc } as SortAndSlice<NullishItem>,
                    'id'
                );
                if (descending === 'skipped') return;
                // Present values descending (5 → '1', 3 → '4'); the null/absent group stays last, still pk ASC
                expect(descending.map(i => i.id)).toEqual(['1', '4', '2', '3', '5']);
            });
        });

        describe('PK Tiebreaker', () => {
            itIfSupported(sortScore)('deterministic order when all sort values are identical', async () => {
                const result = await run(tiedItems, { sort: sortScore }, 'id');
                if (result === 'skipped') return;
                // All score=10, PK tiebreaker ASC: a, b, c
                expect(result.map(i => i.id)).toEqual(['a', 'b', 'c']);
            });

            itIfSupported(sortScoreDesc)('pk tiebreaker stays ascending when the sort direction is descending', async () => {
                const result = await run(tiedItems, { sort: sortScoreDesc }, 'id');
                if (result === 'skipped') return;
                // All score=10; the appended pk tiebreaker is ASC even though the requested sort is DESC
                expect(result.map(i => i.id)).toEqual(['a', 'b', 'c']);
            });

            itIfSupported(sortScoreDate)('pk tiebreaker resolves rows tied on every key of a multi-key sort', async () => {
                const result = await run(multiTiedItems, { sort: sortScoreDate }, 'id');
                if (result === 'skipped') return;
                // score ASC: e(5), a(10), then the score-20 rows by date DESC: c/d (01-02) before b (01-01);
                // c before d only via the pk ASC tiebreaker — they tie on both score and date
                expect(result.map(i => i.id)).toEqual(['e', 'a', 'c', 'd', 'b']);
            });
        });

        describe('Nested Properties', () => {
            itIfSupported(sortNested)('sorts by a dot-prop path into nested objects', async () => {
                const result = await run(
                    nestedItems,
                    { sort: sortNested as any },
                    'id'
                );
                if (result === 'skipped') return;
                expect(result.map(i => i.sender.name)).toEqual(['Alice', 'Mike', 'Zara']);
            });
        });
    });

    // All limit/offset/cursor tests use default sort (PK ASC) for determinism

    describe('Limit', () => {
        itIfSupported(sortId)('returns at most N items', async () => {
            const result = await run(tenItems, { ...defaultSort, limit: 3 }, 'id');
            if (result === 'skipped') return;
            expect(result).toHaveLength(3);
            expect(result.map(i => i.id)).toEqual(['00', '01', '02']);
        });

        itIfSupported(sortId)('returns all when limit exceeds array length', async () => {
            const result = await run(numericItems, { ...defaultSort, limit: 100 }, 'id');
            if (result === 'skipped') return;
            expect(result).toHaveLength(numericItems.length);
        });

        itIfSupported(sortId)('returns empty when limit is zero', async () => {
            const result = await run(numericItems, { ...defaultSort, limit: 0 }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual([]);
        });
    });

    describe('Offset Pagination', () => {
        itIfSupported(sortId)('skips the first N items', async () => {
            const result = await run(tenItems, { ...defaultSort, offset: 7 }, 'id');
            if (result === 'skipped') return;
            expect(result.map(i => i.id)).toEqual(['07', '08', '09']);
        });

        itIfSupported(sortId)('returns empty when offset exceeds length', async () => {
            const result = await run(numericItems, { ...defaultSort, offset: 100 }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual([]);
        });

        itIfSupported(sortId)('combines offset and limit correctly', async () => {
            const result = await run(tenItems, { ...defaultSort, offset: 3, limit: 2 }, 'id');
            if (result === 'skipped') return;
            expect(result.map(i => i.id)).toEqual(['03', '04']);
        });
    });

    describe('Cursor Pagination (after_pk)', () => {

        describe('Basic Cursor', () => {
            itIfSupported(sortId)('returns items after the cursor, excluding the cursor itself', async () => {
                const items = tenItems.slice(0, 5); // 00..04
                const result = await run(items, { sort: sortId, after_pk: '01' }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(['02', '03', '04']);
            });

            itIfSupported(sortId)('returns items after cursor with limit', async () => {
                const items = tenItems.slice(0, 5);
                const result = await run(items, { sort: sortId, after_pk: '01', limit: 2 }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(['02', '03']);
            });

            itIfSupported(sortId)('returns empty when cursor is last item', async () => {
                const items = tenItems.slice(0, 3);
                const result = await run(items, { sort: sortId, after_pk: '02' }, 'id');
                if (result === 'skipped') return;
                expect(result).toEqual([]);
            });

            itIfSupported(sortId)('returns all except first when cursor is first item', async () => {
                const items = tenItems.slice(0, 3);
                const result = await run(items, { sort: sortId, after_pk: '00' }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(['01', '02']);
            });
        });

        describe('Stale / Missing Cursor', () => {
            itIfSupported(sortId)('returns empty when after_pk matches no item', async () => {
                const result = await run(numericItems, { sort: sortId, after_pk: 'nonexistent' }, 'id');
                if (result === 'skipped') return;
                expect(result).toEqual([]);
            });
        });

        describe('Sequential Pagination Completeness', () => {
            itIfSupported(sortId)('paginating through entire dataset yields every item exactly once', async () => {
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

            itIfSupported(sortScore)('completeness holds when items have duplicate sort values', async () => {
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
        itIfSupported(sortAge)('applies sort before limit', async () => {
            // Unsorted input, sort ASC by age, limit 2 → should get the 2 youngest
            const result = await run(numericItems, { sort: sortAge, limit: 2 }, 'id');
            if (result === 'skipped') return;
            expect(result.map(i => i.age)).toEqual([10, 20]);
        });

        itIfSupported(sortAge)('applies sort before offset', async () => {
            const result = await run(numericItems, { sort: sortAge, offset: 2 }, 'id');
            if (result === 'skipped') return;
            // Sorted by age: 10,20,25,30,40 → offset 2 → 25,30,40
            expect(result.map(i => i.age)).toEqual([25, 30, 40]);
        });

        // No sort — always runs regardless of `sortable_keys`.
        itIfSupported(undefined)('returns all items unchanged when SortAndSlice is empty', async () => {
            const result = await run(numericItems, {}, 'id');
            if (result === 'skipped') return;
            // All items present (order may vary)
            expect(result).toHaveLength(numericItems.length);
            const ids = result.map(i => i.id).sort();
            expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
        });

        // No sort — always runs regardless of `sortable_keys`.
        itIfSupported(undefined)('returns at most N items when only limit is set (no sort)', async () => {
            const result = await run(tenItems, { limit: 3 }, 'id');
            if (result === 'skipped') return;
            expect(result).toHaveLength(3);
        });
    });

    describe('Invariants', () => {
        itIfSupported(sortId)('calling twice with same input returns identical result', async () => {
            const sortAndSlice: SortAndSlice<NumericItem> = { ...defaultSort, limit: 3 };
            const r1 = await run(numericItems, sortAndSlice, 'id');
            const r2 = await run(numericItems, sortAndSlice, 'id');
            if (r1 === 'skipped' || r2 === 'skipped') return;
            expect(r1).toEqual(r2);
        });

        itIfSupported(sortId)('limit N result is a prefix of limit N+1 result', async () => {
            const rN = await run(tenItems, { ...defaultSort, limit: 3 }, 'id');
            const rN1 = await run(tenItems, { ...defaultSort, limit: 4 }, 'id');
            if (rN === 'skipped' || rN1 === 'skipped') return;
            expect(rN1.slice(0, 3)).toEqual(rN);
        });

        itIfSupported(sortId)('offset pages are complementary with limit', async () => {
            const page1 = await run(tenItems, { ...defaultSort, offset: 0, limit: 4 }, 'id');
            const page2 = await run(tenItems, { ...defaultSort, offset: 4, limit: 3 }, 'id');
            const combined = await run(tenItems, { ...defaultSort, limit: 7 }, 'id');
            if (page1 === 'skipped' || page2 === 'skipped' || combined === 'skipped') return;
            expect([...page1, ...page2]).toEqual(combined);
        });

        itIfSupported(sortNameAsc)('reversing the direction of a sort over distinct values reverses the row order', async () => {
            const ascending = await run(tenItems, { sort: sortNameAsc }, 'id');
            const descending = await run(tenItems, { sort: sortName }, 'id');
            if (ascending === 'skipped' || descending === 'skipped') return;
            // Every name is distinct, so no tiebreaker can mask a direction bug
            expect(descending.map(i => i.id)).toEqual(ascending.map(i => i.id).reverse());
        });
    });

    describe('Edge Cases', () => {
        itIfSupported(sortId)('handles empty input array', async () => {
            const result = await run([] as NumericItem[], { ...defaultSort }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual([]);
        });

        itIfSupported(sortAge)('handles single-item array', async () => {
            const single = [numericItems[0]!];
            const result = await run(single, { sort: sortAge }, 'id');
            if (result === 'skipped') return;
            expect(result).toEqual(single);
        });
    });

    // Value-based keyset (after_boundary) tests live in their own module to keep this file under the
    // size cap; they run through the same gate and execute wrapper, so every adapter gets them.
    registerAfterBoundaryTests({ describe, itIfSupported, run, expect, implementationName });
}
