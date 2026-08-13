import type { describe, expect, it } from 'vitest';

import { getProperty } from '../dot-prop-paths/getPropertySimpleDot.ts';
import { buildSortComparator, encodeSortValue } from './sortCompare.ts';
import type { PrimaryKeyValue, SortAndSlice, SortBoundary, SortDefinition } from './types.ts';
import {
    type BooleanItem,
    type CaseItem,
    type NullableItem,
    type NullishItem,
    type NumericItem,
    type UnicodeItem,
    booleanItems,
    caseItems,
    numericItems,
    nullableItems,
    nullishItems,
    tenItems,
    unicodeItems,
} from './standardTestFixtures.ts';

/**
 * The slice of `standardTests`' internal state the after-boundary suite needs: the same
 * per-test gate and `execute` wrapper the rest of the battery uses, so every adapter (runtime,
 * object-table SQL, column-table SQL) exercises value-based keyset pagination unchanged.
 */
export type AfterBoundaryTestContext = {
    describe: typeof describe;
    itIfSupported: (sort: SortDefinition<any> | undefined) => (typeof it) | (typeof it)['skip'];
    run: <U extends Record<string, any>>(
        items: U[],
        sortAndSlice: SortAndSlice<U>,
        pk: keyof U & string
    ) => Promise<U[] | 'skipped'>;
    expect: typeof expect;
    implementationName: string;
};

/** Deterministic PRNG (mulberry32) — property scenarios must be reproducible without Date/Math.random. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The exact ordering the engine must reproduce: the shared comparator over the user sort. */
function referenceIds<U extends Record<string, any>>(items: U[], sort: SortDefinition<U>, pk: keyof U & string): PrimaryKeyValue[] {
    return [...items].sort(buildSortComparator(sort, pk)).map(i => i[pk] as PrimaryKeyValue);
}

/** Mint the boundary a real consumer would: the last returned row's encoded sort values plus its pk. */
function mintBoundary<U extends Record<string, any>>(lastRow: U, sort: SortDefinition<U>, pk: keyof U & string): SortBoundary {
    return {
        values: sort.map(e => encodeSortValue(getProperty(lastRow, e.key as string))),
        pk: lastRow[pk] as PrimaryKeyValue,
    };
}

/**
 * Walk a dataset page-by-page via `after_boundary`, minting each cursor from the previous page's
 * last row. `datasetForNextPage` lets a test mutate the dataset between pages (e.g. delete the
 * boundary row) to prove completeness survives concurrent deletion.
 */
async function walk<U extends Record<string, any>>(
    ctx: AfterBoundaryTestContext,
    initialItems: U[],
    sort: SortDefinition<U>,
    pageSize: number,
    pk: keyof U & string,
    datasetForNextPage?: (current: U[], boundaryRow: U) => U[]
): Promise<PrimaryKeyValue[] | 'skipped'> {
    const collected: PrimaryKeyValue[] = [];
    let items = initialItems;
    let boundary: SortBoundary | undefined;
    const cap = initialItems.length + 3; // bounds a non-seeking implementation instead of looping forever

    for (let i = 0; i < cap; i++) {
        const sortAndSlice: SortAndSlice<U> = boundary === undefined
            ? { sort, limit: pageSize }
            : { sort, limit: pageSize, after_boundary: boundary };
        const page = await ctx.run(items, sortAndSlice, pk);
        if (page === 'skipped') return 'skipped';
        if (page.length === 0) break;
        collected.push(...page.map(r => r[pk] as PrimaryKeyValue));
        const boundaryRow = page[page.length - 1]!;
        boundary = mintBoundary(boundaryRow, sort, pk);
        if (datasetForNextPage) items = datasetForNextPage(items, boundaryRow);
    }
    return collected;
}

/** Same walk via `after_pk` — the identity-anchor cursor, used as the deleted-boundary negative control. */
async function walkByPk<U extends Record<string, any>>(
    ctx: AfterBoundaryTestContext,
    initialItems: U[],
    sort: SortDefinition<U>,
    pageSize: number,
    pk: keyof U & string,
    datasetForNextPage?: (current: U[], boundaryRow: U) => U[]
): Promise<PrimaryKeyValue[] | 'skipped'> {
    const collected: PrimaryKeyValue[] = [];
    let items = initialItems;
    let afterPk: PrimaryKeyValue | undefined;
    const cap = initialItems.length + 3;

    for (let i = 0; i < cap; i++) {
        const sortAndSlice: SortAndSlice<U> = afterPk === undefined
            ? { sort, limit: pageSize }
            : { sort, limit: pageSize, after_pk: afterPk };
        const page = await ctx.run(items, sortAndSlice, pk);
        if (page === 'skipped') return 'skipped';
        if (page.length === 0) break;
        collected.push(...page.map(r => r[pk] as PrimaryKeyValue));
        const boundaryRow = page[page.length - 1]!;
        afterPk = boundaryRow[pk] as PrimaryKeyValue;
        if (datasetForNextPage) items = datasetForNextPage(items, boundaryRow);
    }
    return collected;
}

/**
 * Registers the value-based keyset (`after_boundary`) portion of the standard sort/slice battery.
 * Called from inside `standardTests()` so all adapters run it through the same `execute` wrapper
 * and per-test gate.
 */
export function registerAfterBoundaryTests(ctx: AfterBoundaryTestContext): void {
    const { describe, itIfSupported, expect } = ctx;

    describe('After-Boundary Pagination', () => {

        describe('Walk parity', () => {
            const scenarios: Array<{ name: string; items: any[]; sort: SortDefinition<any>; pageSize: number }> = [
                { name: 'single numeric key ascending', items: numericItems, sort: [{ key: 'age', direction: 1 }], pageSize: 2 },
                { name: 'single string key descending', items: numericItems, sort: [{ key: 'name', direction: -1 }], pageSize: 2 },
                { name: 'multi-key with independent directions', items: numericItems, sort: [{ key: 'category', direction: 1 }, { key: 'date', direction: -1 }], pageSize: 2 },
                { name: 'nested dot-prop key', items: numericItems, sort: [{ key: 'category', direction: 1 }, { key: 'name', direction: 1 }], pageSize: 3 },
                { name: 'the primary key itself', items: tenItems, sort: [{ key: 'id', direction: 1 }], pageSize: 3 },
            ];

            for (const s of scenarios) {
                itIfSupported(s.sort)(`reproduces the full sorted order — ${s.name}`, async () => {
                    const collected = await walk(ctx, s.items, s.sort, s.pageSize, 'id');
                    if (collected === 'skipped') return;
                    expect(collected).toEqual(referenceIds(s.items, s.sort, 'id'));
                });
            }
        });

        describe('Completeness under concurrent deletion', () => {
            const sort: SortDefinition<NumericItem> = [{ key: 'id', direction: 1 }];

            itIfSupported(sort)('visits every surviving row when the boundary row is deleted mid-walk', async () => {
                // Delete each page's boundary row before the next page is fetched.
                const deleteBoundary = (current: NumericItem[], boundaryRow: NumericItem) =>
                    current.filter(r => r.id !== boundaryRow.id);
                const collected = await walk(ctx, tenItems, sort, 3, 'id', deleteBoundary);
                if (collected === 'skipped') return;
                // Every id must be visited exactly once — deleting the anchor must not drop the rows after it.
                expect([...collected].sort()).toEqual(tenItems.map(i => i.id).sort());
                expect(new Set(collected).size).toBe(collected.length);
            });

            itIfSupported(sort)('after_pk truncates the same walk (negative control)', async () => {
                const deleteBoundary = (current: NumericItem[], boundaryRow: NumericItem) =>
                    current.filter(r => r.id !== boundaryRow.id);
                const viaBoundary = await walk(ctx, tenItems, sort, 3, 'id', deleteBoundary);
                const viaPk = await walkByPk(ctx, tenItems, sort, 3, 'id', deleteBoundary);
                if (viaBoundary === 'skipped' || viaPk === 'skipped') return;
                // Deleting the anchor row strands after_pk's correlated subquery, so it collects strictly fewer rows.
                expect(viaPk.length).toBeLessThan(viaBoundary.length);
            });
        });

        describe('Null boundaries', () => {
            itIfSupported([{ key: 'value', direction: 1 }])('walks a nullable field ascending without re-delivering non-null rows', async () => {
                const sort: SortDefinition<NullableItem> = [{ key: 'value', direction: 1 }];
                const collected = await walk(ctx, nullableItems, sort, 1, 'id');
                if (collected === 'skipped') return;
                expect(collected).toEqual(referenceIds(nullableItems, sort, 'id'));
            });

            itIfSupported([{ key: 'value', direction: -1 }])('walks a null/absent mix descending, nulls staying last', async () => {
                const sort: SortDefinition<NullishItem> = [{ key: 'value', direction: -1 }];
                const collected = await walk(ctx, nullishItems, sort, 2, 'id');
                if (collected === 'skipped') return;
                expect(collected).toEqual(referenceIds(nullishItems, sort, 'id'));
            });
        });

        describe('Boolean boundary (page size 1)', () => {
            itIfSupported([{ key: 'flag', direction: 1 }])('walks boolean sort values one page at a time', async () => {
                const sort: SortDefinition<BooleanItem> = [{ key: 'flag', direction: 1 }];
                const collected = await walk(ctx, booleanItems, sort, 1, 'id');
                if (collected === 'skipped') return;
                expect(collected).toEqual(referenceIds(booleanItems, sort, 'id'));
            });
        });

        describe('Code-point boundary', () => {
            itIfSupported([{ key: 'name', direction: 1 }])('walks strings by code point across the BMP boundary', async () => {
                const sort: SortDefinition<UnicodeItem> = [{ key: 'name', direction: 1 }];
                const collected = await walk(ctx, unicodeItems, sort, 1, 'id');
                if (collected === 'skipped') return;
                expect(collected).toEqual(referenceIds(unicodeItems, sort, 'id'));
            });

            itIfSupported([{ key: 'name', direction: 1 }])('walks mixed-case strings case-sensitively, uppercase first', async () => {
                // A locale-collated boundary comparison would order 'apple' before 'Banana' and
                // re-derive a different page split; code-point order keeps every page boundary exact.
                const sort: SortDefinition<CaseItem> = [{ key: 'name', direction: 1 }];
                const collected = await walk(ctx, caseItems, sort, 1, 'id');
                if (collected === 'skipped') return;
                expect(collected).toEqual(referenceIds(caseItems, sort, 'id'));
            });
        });

        describe('Cursor serialisation', () => {
            itIfSupported([{ key: 'age', direction: 1 }])('a JSON-round-tripped boundary yields the correct next page', async () => {
                const sort: SortDefinition<NumericItem> = [{ key: 'age', direction: 1 }];
                const page1 = await ctx.run(numericItems, { sort, limit: 2 }, 'id');
                if (page1 === 'skipped') return;
                const boundary = mintBoundary(page1[page1.length - 1]!, sort, 'id');
                const roundTripped: SortBoundary = JSON.parse(JSON.stringify(boundary));

                const viaJson = await ctx.run(numericItems, { sort, limit: 2, after_boundary: roundTripped }, 'id');
                if (viaJson === 'skipped') return;
                // Page 2 of the reference order — the round-tripped cursor must resume exactly here.
                const expectedPage2 = referenceIds(numericItems, sort, 'id').slice(2, 4);
                expect(viaJson.map(i => i.id)).toEqual(expectedPage2);
            });
        });

        describe('Stale boundary', () => {
            itIfSupported([{ key: 'age', direction: 1 }])('returns an empty page when the boundary is the last row', async () => {
                const sort: SortDefinition<NumericItem> = [{ key: 'age', direction: 1 }];
                const all = await ctx.run(numericItems, { sort }, 'id');
                if (all === 'skipped') return;
                const lastRow = all[all.length - 1]!;
                const boundary = mintBoundary(lastRow, sort, 'id');
                const page = await ctx.run(numericItems, { sort, after_boundary: boundary }, 'id');
                if (page === 'skipped') return;
                expect(page).toEqual([]);
            });
        });

        describe('Seeded property walk', () => {
            // Scenarios are generated once, at registration time, so the static per-test gate can see
            // each scenario's keys. Keys are drawn from a pool present in both the object and column schemas.
            const KEY_POOL: Array<{ key: string; }> = [{ key: 'age' }, { key: 'name' }, { key: 'category' }, { key: 'date' }];
            const rand = mulberry32(0x5eed);
            const source: NumericItem[] = [
                ...numericItems,
                { id: 'f', age: 20, name: 'Alice', category: 'A', date: '2024-01-02' }, // deliberate ties on age/name/category
                { id: 'g', age: 30, name: 'Charlie', category: 'B', date: '2024-01-03' },
                { id: 'h', age: 10, name: 'Bob', category: 'A', date: '2024-01-01' },
            ];

            const scenarios = Array.from({ length: 8 }, (_, n) => {
                const keyCount = 1 + Math.floor(rand() * 2); // 1 or 2 keys
                const shuffled = [...KEY_POOL].sort(() => rand() - 0.5);
                const sort: SortDefinition<any> = shuffled.slice(0, keyCount).map(k => ({
                    key: k.key,
                    direction: rand() < 0.5 ? 1 : -1,
                }));
                const pageSize = 1 + Math.floor(rand() * 3); // 1..3
                const rowCount = 4 + Math.floor(rand() * (source.length - 4 + 1)); // 4..all
                const items = source.slice(0, rowCount);
                return { n, sort, pageSize, items };
            });

            for (const s of scenarios) {
                const label = s.sort.map(e => `${e.key}${e.direction === 1 ? '↑' : '↓'}`).join(',');
                itIfSupported(s.sort)(`scenario ${s.n}: sort=[${label}] page=${s.pageSize} rows=${s.items.length}`, async () => {
                    const collected = await walk(ctx, s.items, s.sort, s.pageSize, 'id');
                    if (collected === 'skipped') return;
                    expect(collected).toEqual(referenceIds(s.items, s.sort, 'id'));
                });
            }
        });
    });
}
