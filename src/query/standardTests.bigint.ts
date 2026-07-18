import type { describe, expect, it } from 'vitest';

import { getProperty } from '../dot-prop-paths/getPropertySimpleDot.ts';
import { buildSortComparator, encodeSortValue } from './sortCompare.ts';
import { type BigintItem, bigintItems } from './standardTestFixtures.ts';
import type { Execute } from './standardTests.ts';
import type { PrimaryKeyValue, SortAndSlice, SortBoundary, SortDefinition } from './types.ts';

/**
 * Configuration for {@link registerBigintSortTests} — the same adapter surface as
 * `standardTests`: the runner's `it`/`expect`, the adapter's `execute`, and an optional
 * `describe` override for runners without globals.
 */
export type BigintSortTestConfig = {
    it: typeof it;
    expect: typeof expect;
    execute: Execute<any>;
    implementationName?: string;
    describe?: typeof describe;
};

/** Deterministic PRNG (mulberry32) — fuzz scenarios must be reproducible without Date/Math.random. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const INT64_MAX = 2n ** 63n - 1n;

/** The exact ordering every engine must reproduce: the shared comparator over the user sort. */
function referenceIds(items: BigintItem[], sort: SortDefinition<any>): PrimaryKeyValue[] {
    return [...items].sort(buildSortComparator(sort, 'id')).map(i => i.id);
}

/** Mint the boundary a real consumer would: the last row's encoded sort values plus its pk. */
function mintBoundary(lastRow: BigintItem, sort: SortDefinition<any>): SortBoundary {
    return {
        values: sort.map(e => encodeSortValue(getProperty(lastRow, e.key as string))),
        pk: lastRow.id,
    };
}

/**
 * Registers cross-engine parity tests for bigint sort keys. Opt-in — invoked only by adapters
 * whose storage can genuinely hold a bigint (the in-memory runtime and the relational
 * column-table engines). It is deliberately NOT part of `standardTests`: a JSON-document
 * adapter cannot even seed these fixtures (`JSON.stringify` throws on bigint), and its correct
 * behaviour — loudly rejecting the sort key — is pinned by unit tests instead.
 *
 * Covers plain sorting (exact-value order beyond double precision, nulls last, multi-key
 * tiebreaks), full `after_pk`/`after_boundary` keyset walks at several page sizes, cursor JSON
 * round-trips, and seeded fuzz walks — all asserted against the `buildSortComparator` oracle,
 * with the headline orders additionally pinned as literal pk-sequences so a defect shared by
 * oracle and engine cannot pass silently.
 *
 * @param config - The adapter's `it`/`expect`/`execute`, mirroring `standardTests`' config.
 */
export function registerBigintSortTests(config: BigintSortTestConfig): void {
    const { it, expect, execute } = config;
    // Resolved from the runner's globals rather than imported: importing vitest here would vendor a
    // second copy of the runner into the published bundle, which overwrites the consumer's expect-global state.
    const globalDescribe: unknown = Reflect.get(globalThis, 'describe');
    const describe = config.describe ?? (typeof globalDescribe === 'function' ? globalDescribe as BigintSortTestConfig['describe'] : undefined);
    if (typeof describe !== 'function') {
        throw new Error("registerBigintSortTests: no `describe` available. Enable your test runner's globals (Vitest: `globals: true`), or pass `describe` explicitly in the config.");
    }
    const implementationName = config.implementationName ?? 'unknown';

    /** Run execute, skip if undefined (unsupported at runtime) — same convention as `standardTests`. */
    async function run(
        items: BigintItem[],
        sortAndSlice: SortAndSlice<BigintItem>,
        pk: 'id'
    ): Promise<BigintItem[] | 'skipped'> {
        const result = await (execute as Execute<BigintItem>)(items, sortAndSlice, pk);
        if (result === undefined) {
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] test skipped`);
            return 'skipped';
        }
        return result;
    }

    /** Walk page-by-page via `after_boundary`, minting each cursor from the previous page's last row. */
    async function walk(items: BigintItem[], sort: SortDefinition<any>, pageSize: number): Promise<PrimaryKeyValue[] | 'skipped'> {
        const collected: PrimaryKeyValue[] = [];
        let boundary: SortBoundary | undefined;
        const cap = items.length + 3; // bounds a non-seeking implementation instead of looping forever
        for (let i = 0; i < cap; i++) {
            const sortAndSlice: SortAndSlice<BigintItem> = boundary === undefined
                ? { sort, limit: pageSize }
                : { sort, limit: pageSize, after_boundary: boundary };
            const page = await run(items, sortAndSlice, 'id');
            if (page === 'skipped') return 'skipped';
            if (page.length === 0) break;
            collected.push(...page.map(r => r.id));
            boundary = mintBoundary(page[page.length - 1]!, sort);
        }
        return collected;
    }

    /** Same walk via `after_pk` — the identity-anchor cursor. */
    async function walkByPk(items: BigintItem[], sort: SortDefinition<any>, pageSize: number): Promise<PrimaryKeyValue[] | 'skipped'> {
        const collected: PrimaryKeyValue[] = [];
        let afterPk: PrimaryKeyValue | undefined;
        const cap = items.length + 3;
        for (let i = 0; i < cap; i++) {
            const sortAndSlice: SortAndSlice<BigintItem> = afterPk === undefined
                ? { sort, limit: pageSize }
                : { sort, limit: pageSize, after_pk: afterPk };
            const page = await run(items, sortAndSlice, 'id');
            if (page === 'skipped') return 'skipped';
            if (page.length === 0) break;
            collected.push(...page.map(r => r.id));
            afterPk = page[page.length - 1]!.id;
        }
        return collected;
    }

    const amountAsc: SortDefinition<any> = [{ key: 'amount', direction: 1 }];
    const amountDesc: SortDefinition<any> = [{ key: 'amount', direction: -1 }];
    const amountThenName: SortDefinition<any> = [{ key: 'amount', direction: 1 }, { key: 'name', direction: 1 }];
    const nameThenAmount: SortDefinition<any> = [{ key: 'name', direction: 1 }, { key: 'amount', direction: 1 }];

    // Literal pk-sequences for the headline sorts, derived by hand from the fixture amounts.
    // Pinned as data (not via the oracle) so a defect the oracle and engine share — e.g. both
    // regressing to lexical string order — still fails here. Ascending walks the negatives up
    // through the adjacent 2^53 triple (k, c, a) to int64 max, with the amount-10 tie (e, f)
    // broken by pk and the null/absent rows (i, j) last in both directions.
    const PINNED_ASC = ['g', 'l', 'n', 'b', 'd', 'm', 'e', 'f', 'k', 'c', 'a', 'h', 'i', 'j'];
    const PINNED_DESC = ['h', 'a', 'c', 'k', 'e', 'f', 'm', 'd', 'b', 'n', 'l', 'g', 'i', 'j'];
    // On [amount, name], ties on amount resolve by name instead of pk: the amount-10 pair orders
    // f ('north') before e ('south'), and the null-amount group orders j ('east') before i ('north').
    const PINNED_AMOUNT_THEN_NAME = ['g', 'l', 'n', 'b', 'd', 'm', 'f', 'e', 'k', 'c', 'a', 'h', 'j', 'i'];
    // On [name, amount], rows group by name (east < north < south < west), each group ordered by
    // amount with its own null (i, j) last.
    const PINNED_NAME_THEN_AMOUNT = ['g', 'd', 'j', 'f', 'c', 'a', 'i', 'n', 'b', 'e', 'h', 'l', 'm', 'k'];

    describe('Bigint Sort Keys (opt-in battery)', () => {

        describe('Sorting [dec-bigint-numeric-bracket]', () => {
            it('orders amounts by exact numeric value ascending, adjacent >2^53 values distinct, nulls last', async () => {
                const result = await run(bigintItems, { sort: amountAsc }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(PINNED_ASC);
            });

            it('orders amounts by exact numeric value descending, nulls still last', async () => {
                const result = await run(bigintItems, { sort: amountDesc }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(PINNED_DESC);
            });

            it('breaks duplicate-amount ties on a secondary key before the pk', async () => {
                const result = await run(bigintItems, { sort: amountThenName }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(PINNED_AMOUNT_THEN_NAME);
            });

            it('orders a bigint as the secondary key under a string primary', async () => {
                const result = await run(bigintItems, { sort: nameThenAmount }, 'id');
                if (result === 'skipped') return;
                expect(result.map(i => i.id)).toEqual(PINNED_NAME_THEN_AMOUNT);
            });
        });

        describe('Keyset walks [dec-bigint-numeric-bracket]', () => {
            for (const pageSize of [1, 2, 3]) {
                for (const sort of [amountAsc, amountDesc]) {
                    const dir = sort === amountAsc ? 'ascending' : 'descending';
                    it(`after_boundary and after_pk walks reproduce the full ${dir} order at page size ${pageSize}`, async () => {
                        const expected = referenceIds(bigintItems, sort);
                        const viaBoundary = await walk(bigintItems, sort, pageSize);
                        if (viaBoundary === 'skipped') return;
                        expect(viaBoundary).toEqual(expected);
                        const viaPk = await walkByPk(bigintItems, sort, pageSize);
                        if (viaPk === 'skipped') return;
                        expect(viaPk).toEqual(expected);
                    });
                }
            }

            it('walks a multi-key sort with a bigint primary key component', async () => {
                const collected = await walk(bigintItems, amountThenName, 2);
                if (collected === 'skipped') return;
                expect(collected).toEqual(PINNED_AMOUNT_THEN_NAME);
            });

            it('walks a multi-key sort with a bigint secondary key component', async () => {
                const collected = await walk(bigintItems, nameThenAmount, 3);
                if (collected === 'skipped') return;
                expect(collected).toEqual(PINNED_NAME_THEN_AMOUNT);
            });
        });

        describe('Cursor serialisation [dec-bigint-tagged-encoding]', () => {
            it('a JSON-round-tripped bigint boundary resumes the walk exactly', async () => {
                const page1 = await run(bigintItems, { sort: amountAsc, limit: 3 }, 'id');
                if (page1 === 'skipped') return;
                const boundary = mintBoundary(page1[page1.length - 1]!, amountAsc);
                const roundTripped: SortBoundary = JSON.parse(JSON.stringify(boundary));

                const page2 = await run(bigintItems, { sort: amountAsc, limit: 3, after_boundary: roundTripped }, 'id');
                if (page2 === 'skipped') return;
                expect(page2.map(i => i.id)).toEqual(PINNED_ASC.slice(3, 6));
            });
        });

        describe('Seeded fuzz walks [dec-bigint-numeric-bracket]', () => {
            // Scenarios are generated once, at registration time, from a fixed seed, so every
            // suite (and every re-run) walks identical datasets.
            const rand = mulberry32(0xb16f5eed);
            const ANCHORS: bigint[] = [
                0n, 1n, -1n, 10n, -10n,
                9007199254740991n, 9007199254740992n, 9007199254740993n,
                -9007199254740992n, -9007199254740993n,
                9223372036854775807n, -9223372036854775808n,
            ];
            const NAMES = ['p', 'q', 'r'];

            /** A random int64-safe bigint of up to 18 digits, either sign — reaches far beyond 2^53. */
            function randomAmount(): bigint {
                const digits = 1 + Math.floor(rand() * 18);
                let s = String(1 + Math.floor(rand() * 9));
                for (let i = 1; i < digits; i++) s += String(Math.floor(rand() * 10));
                const magnitude = BigInt(s);
                return rand() < 0.5 ? -magnitude : magnitude;
            }

            function generateItems(rowCount: number): BigintItem[] {
                const items: BigintItem[] = [];
                for (let i = 0; i < rowCount; i++) {
                    const id = `r${String(i).padStart(2, '0')}`;
                    const name = NAMES[Math.floor(rand() * NAMES.length)]!;
                    const roll = rand();
                    if (roll < 0.08) { items.push({ id, amount: null, name }); continue; }
                    if (roll < 0.16) { items.push({ id, name }); continue; }
                    const prev = items.filter(x => typeof x.amount === 'bigint');
                    let amount: bigint;
                    if (roll < 0.32 && prev.length > 0) {
                        // Duplicate an earlier amount — exercises the pk tiebreak mid-walk.
                        amount = prev[Math.floor(rand() * prev.length)]!.amount as bigint;
                    } else if (roll < 0.48 && prev.length > 0) {
                        // Sit adjacent to an earlier amount — indistinguishable once collapsed to a double.
                        const base = prev[Math.floor(rand() * prev.length)]!.amount as bigint;
                        amount = base < INT64_MAX ? base + 1n : base - 1n;
                    } else if (roll < 0.7) {
                        amount = ANCHORS[Math.floor(rand() * ANCHORS.length)]!;
                    } else {
                        amount = randomAmount();
                    }
                    items.push({ id, amount, name });
                }
                return items;
            }

            const SORT_SHAPES: Array<(d1: 1 | -1, d2: 1 | -1) => SortDefinition<any>> = [
                d1 => [{ key: 'amount', direction: d1 }],
                (d1, d2) => [{ key: 'amount', direction: d1 }, { key: 'name', direction: d2 }],
                (d1, d2) => [{ key: 'name', direction: d1 }, { key: 'amount', direction: d2 }],
            ];

            const scenarios = Array.from({ length: 8 }, (_, n) => {
                const items = generateItems(8 + Math.floor(rand() * 7)); // 8..14 rows
                const shape = SORT_SHAPES[Math.floor(rand() * SORT_SHAPES.length)]!;
                const sort = shape(rand() < 0.5 ? 1 : -1, rand() < 0.5 ? 1 : -1);
                const pageSize = 1 + Math.floor(rand() * 3); // 1..3
                return { n, items, sort, pageSize };
            });

            it('fuzz corpus reaches the divergent territory (guards the generator against seed drift)', () => {
                const amounts = scenarios.flatMap(s => s.items).map(i => i.amount);
                const bigints = amounts.filter((a): a is bigint => typeof a === 'bigint');
                expect(bigints.some(a => a > 9007199254740992n || a < -9007199254740992n)).toBe(true);
                expect(bigints.some(a => a < 0n)).toBe(true);
                expect(amounts.some(a => a === null || a === undefined)).toBe(true);
                // At least one scenario holds a duplicate and an adjacent pair within its own rows.
                const perScenario = scenarios.map(s => s.items.map(i => i.amount).filter((a): a is bigint => typeof a === 'bigint'));
                expect(perScenario.some(list => new Set(list.map(String)).size < list.length)).toBe(true);
                expect(perScenario.some(list => list.some(a => list.some(b => b === a + 1n)))).toBe(true);
            });

            for (const s of scenarios) {
                const label = s.sort.map(e => `${e.key as string}${e.direction === 1 ? '↑' : '↓'}`).join(',');
                it(`scenario ${s.n}: sort=[${label}] page=${s.pageSize} rows=${s.items.length}`, async () => {
                    const expected = referenceIds(s.items, s.sort);
                    const viaBoundary = await walk(s.items, s.sort, s.pageSize);
                    if (viaBoundary === 'skipped') return;
                    expect(viaBoundary).toEqual(expected);
                    const viaPk = await walkByPk(s.items, s.sort, s.pageSize);
                    if (viaPk === 'skipped') return;
                    expect(viaPk).toEqual(expected);
                });
            }
        });
    });
}
