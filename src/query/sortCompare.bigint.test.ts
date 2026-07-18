import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
    encodeSortValue,
    compareValues,
    compareToBoundary,
    type EncodedSortValue,
} from './sortCompare.ts';
import { EncodedSortValueSchema, SortAndSliceSchema } from './schemas.ts';
import type { SortBoundary, SortDefinition } from './types.ts';

/**
 * Frozen contract suite for bigint sort ordering: bigints encode as the reserved tagged shape
 * `{ $bigint: '<decimal>' }` and order inside the finite-number bracket by exact numeric value,
 * so in-memory sorts and SQL keyset walks agree for magnitudes beyond 2^53.
 *
 * Governing decisions live in `src/query/decisions.md`; each test names its decision slug.
 * Assertions here may be strengthened, never weakened.
 */

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

/** Human-readable label for a pool value, for failure messages. */
function label(v: unknown): string {
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'string') return JSON.stringify(v);
    if (v !== null && typeof v === 'object') {
        try { return JSON.stringify(v) ?? String(v); } catch { return '[unstringifiable]'; }
    }
    return String(v);
}

const DIRECTIONS = [1, -1] as const;

describe('encodeSortValue: bigint encoding [dec-bigint-tagged-encoding]', () => {

    it('encodes a bigint as a frozen tag carrying its canonical decimal form [dec-bigint-tagged-encoding]', () => {
        const encoded = encodeSortValue(10n);
        expect(encoded).toEqual({ $bigint: '10' });
        expect(Object.isFrozen(encoded)).toBe(true);
        expect(encodeSortValue(-42n)).toEqual({ $bigint: '-42' });
        expect(encodeSortValue(0n)).toEqual({ $bigint: '0' });
    });

    it('encoding is total beyond int64: 2^63 still encodes [dec-bigint-tagged-encoding]', () => {
        expect(encodeSortValue(2n ** 63n)).toEqual({ $bigint: '9223372036854775808' });
        expect(encodeSortValue(-(2n ** 63n) - 1n)).toEqual({ $bigint: '-9223372036854775809' });
    });

    it('re-encoding a tagged form is structurally idempotent and comparison-neutral, but yields a fresh snapshot [dec-encode-snapshots]', () => {
        const once = encodeSortValue(10n);
        const twice = encodeSortValue(once);
        expect(twice).toEqual(once);
        expect(compareValues(once, twice, 1)).toBe(0);
        expect(twice).not.toBe(once);
        expect(Object.isFrozen(twice)).toBe(true);
    });

    it('snapshots a caller-supplied tagged object: later mutation of the input cannot reach the encoding [dec-encode-snapshots]', () => {
        const input = { $bigint: '10' };
        const encoded = encodeSortValue(input);
        expect(encoded).not.toBe(input);
        input.$bigint = '999';
        expect(encoded).toEqual({ $bigint: '10' });
        expect(compareValues(encoded, 10n, 1)).toBe(0);
    });

    it('a one-shot hostile getter cannot break later comparisons: the single guarded read is the only read [dec-encode-snapshots]', () => {
        let reads = 0;
        const oneShot = {
            get $bigint(): string {
                reads++;
                if (reads > 1) throw new Error('second read');
                return '10';
            },
        };
        const encoded = encodeSortValue(oneShot);
        expect(encoded).toEqual({ $bigint: '10' });
        // The snapshot is a plain frozen object — comparing never touches the hostile input again.
        expect(compareValues(encoded, 10n, 1)).toBe(0);
        expect(compareValues(encoded, 11n, 1)).toBe(-1);
        // Comparing the exhausted hostile object directly must stay total (never throw).
        expect(() => compareValues(oneShot, 1n, 1)).not.toThrow();
    });

    it('malformed tags fall to the structural string form [dec-bigint-tagged-encoding]', () => {
        const malformed: unknown[] = [
            { $bigint: '007' },          // leading zeros are non-canonical
            { $bigint: '-0' },           // negative zero has no canonical decimal form
            { $bigint: 10 },             // payload must be a string
            { $bigint: '10', extra: 1 }, // exactly one own key
            { $bigint: '1.5' },          // integers only
            { $bigint: '' },
            { $bigint: '10n' },
        ];
        for (const v of malformed) {
            expect(encodeSortValue(v), `expected structural form for ${label(v)}`).toBe('[object Object]');
        }
    });

    it('an inherited $bigint is not a tag: prototype chains cannot smuggle an encoding [dec-bigint-tagged-encoding]', () => {
        expect(encodeSortValue(Object.create({ $bigint: '10' }))).toBe('[object Object]');
        expect(encodeSortValue({})).toBe('[object Object]');
    });

    it('hostile tagged shapes never throw [dec-encode-snapshots]', () => {
        const alwaysThrows = { get $bigint(): string { throw new Error('no read allowed'); } };
        expect(() => encodeSortValue(alwaysThrows)).not.toThrow();
        expect(encodeSortValue(alwaysThrows)).toBe('[object Object]');

        const { proxy, revoke } = Proxy.revocable({ $bigint: '10' }, {});
        revoke();
        expect(() => encodeSortValue(proxy)).not.toThrow();
        expect(encodeSortValue(proxy)).toBe('[object Object]');
    });

    it('a raw object of the reserved shape orders as the bigint it denotes, no longer as a structural tie [dec-bigint-tagged-encoding]', () => {
        expect(compareValues({ $bigint: '10' }, 9, 1)).toBe(1);
        expect(compareValues({ $bigint: '10' }, 11, 1)).toBe(-1);
        expect(compareValues({ $bigint: '10' }, 10n, 1)).toBe(0);
        // Other structural values stay in the string bracket, after the numeric bracket.
        expect(compareValues({ $bigint: '10' }, { a: 1 }, 1)).toBe(-1);
    });

});

describe('compareValues: the merged numeric bracket [dec-bigint-numeric-bracket]', () => {

    it('orders bigints among numbers by exact value [dec-bigint-numeric-bracket]', () => {
        const mixed: unknown[] = [11n, 2, 10n, 9n, 1n, 100n, -3n, 10.5, 0];
        const sorted = [...mixed].sort((a, b) => compareValues(a, b, 1));
        expect(sorted).toEqual([-3n, 0, 1n, 2, 9n, 10n, 10.5, 11n, 100n]);
    });

    it('an equal bigint and number tie, in either argument order [dec-bigint-numeric-bracket]', () => {
        expect(compareValues(10, 10n, 1)).toBe(0);
        expect(compareValues(10n, 10, 1)).toBe(0);
        expect(compareValues(-0, 0n, 1)).toBe(0);
        expect(compareValues(0n, -0, 1)).toBe(0);
    });

    it('compares beyond double precision exactly: 2^53 and its neighbours do not collapse [dec-bigint-numeric-bracket]', () => {
        expect(compareValues(2 ** 53, 2n ** 53n + 1n, 1)).toBe(-1);
        expect(compareValues(9007199254740993n, 9007199254740992, 1)).toBe(1);
        expect(compareValues(2n ** 53n, 2 ** 53, 1)).toBe(0);
    });

    it('compares astronomical magnitudes exactly: the double 1e300 exceeds 10^300 [dec-bigint-numeric-bracket]', () => {
        // The IEEE-754 double written 1e300 is exactly 1000000000000000052504760…, above 10^300.
        expect(compareValues(10n ** 300n, 1e300, 1)).toBe(-1);
        expect(compareValues(1e300, 10n ** 300n, 1)).toBe(1);
    });

    it('a bigint sharing an integer part with a fraction orders by the fraction, in both argument orders [dec-bigint-numeric-bracket]', () => {
        expect(compareValues(10n, 10.5, 1)).toBe(-1);
        expect(compareValues(10.5, 10n, 1)).toBe(1);
        expect(compareValues(10n, 10.9, 1)).toBe(-1);
        expect(compareValues(10.9, 10n, 1)).toBe(1);
        expect(compareValues(-10.5, -10n, 1)).toBe(-1);
        expect(compareValues(-10n, -10.5, 1)).toBe(1);
        expect(compareValues(0n, 5e-324, 1)).toBe(-1);
        expect(compareValues(5e-324, 0n, 1)).toBe(1);
    });

    it('descending flips the fractional tie arm [dec-bigint-numeric-bracket]', () => {
        expect(compareValues(10.5, 10n, -1)).toBe(-1);
        expect(compareValues(10n, 10.5, -1)).toBe(1);
    });

    it('bigints order before every string-bracket value, scaled by direction [dec-bigint-numeric-bracket]', () => {
        for (const s of ['NaN', 'Infinity', '10', '', '0']) {
            expect(compareValues(999999999999999999999n, s, 1), `vs ${label(s)} asc`).toBe(-1);
            expect(compareValues(999999999999999999999n, s, -1), `vs ${label(s)} desc`).toBe(1);
        }
    });

    it('non-finite numbers keep their string form, after every bigint [dec-bigint-numeric-bracket]', () => {
        expect(compareValues(Infinity, 10n ** 30n, 1)).toBe(1);
        expect(compareValues(-Infinity, 10n ** 30n, 1)).toBe(1);
        expect(compareValues(NaN, 10n ** 30n, 1)).toBe(1);
    });

    it('null and undefined sort after bigints in both directions [dec-bigint-numeric-bracket]', () => {
        for (const direction of DIRECTIONS) {
            expect(compareValues(10n, null, direction)).toBe(-1);
            expect(compareValues(null, 10n, direction)).toBe(1);
            expect(compareValues(10n, undefined, direction)).toBe(-1);
            expect(compareValues(undefined, 10n, direction)).toBe(1);
        }
    });

});

describe('property invariants over a seeded mixed pool', () => {

    // Fixed members target every boundary: small bigints against fractions sharing their integer
    // part (the tie arm), the 2^53 precision cliff, int64 extremes, beyond-int64 magnitudes,
    // numeric-looking strings, tagged objects (canonical and malformed), and null-likes.
    const FIXED_POOL: unknown[] = [
        null, undefined,
        0, -0, 1, -1, 10, 0.5, 10.5, -10.5, 5e-324, 1e300, -1e300, 2 ** 53, -(2 ** 53), Infinity, -Infinity, NaN,
        0n, 1n, -1n, 2n, 9n, 10n, -10n, 11n,
        2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, -(2n ** 53n) - 1n,
        2n ** 63n - 1n, -(2n ** 63n), 2n ** 64n + 7n,
        10n ** 400n, -(10n ** 400n), { $bigint: '1' + '0'.repeat(500) },
        '', '0', '10', '9', 'NaN', 'Infinity', '[object Object]', 'a',
        { $bigint: '10' }, { $bigint: '007' }, { $bigint: 10 }, { $bigint: '10', extra: 1 },
        true, false, {}, [],
    ];

    const rand = mulberry32(0xb161);

    const randomBigints: bigint[] = Array.from({ length: 12 }, () => {
        const digitCount = 1 + Math.floor(rand() * 24);
        let digits = '';
        for (let i = 0; i < digitCount; i++) digits += Math.floor(rand() * 10);
        digits = digits.replace(/^0+(?=.)/, '');
        return BigInt((rand() < 0.5 ? '-' : '') + digits);
    });

    const randomNumbers: number[] = Array.from({ length: 12 }, () => {
        const magnitude = Math.floor(rand() * 19) - 3;
        const value = rand() * 10 ** magnitude;
        return rand() < 0.5 ? -value : value;
    });

    const POOL: unknown[] = [...FIXED_POOL, ...randomBigints, ...randomNumbers];

    it('every verdict is exactly -1, 0 or +1 and never throws (totality)', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            for (const a of POOL) {
                for (const b of POOL) {
                    const verdict = compareValues(a, b, direction);
                    if (verdict !== -1 && verdict !== 0 && verdict !== 1) {
                        failures.push(`compareValues(${label(a)}, ${label(b)}, ${direction}) = ${verdict}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('swapping the operands negates the verdict (antisymmetry)', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            for (const a of POOL) {
                for (const b of POOL) {
                    const forward = compareValues(a, b, direction);
                    const backward = compareValues(b, a, direction);
                    if (forward !== -backward) {
                        failures.push(`(${label(a)}, ${label(b)}, ${direction}): ${forward} vs swapped ${backward}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('the order is transitive across every pool triple [dec-bigint-numeric-bracket]', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            const verdicts = POOL.map(a => POOL.map(b => compareValues(a, b, direction)));
            for (let i = 0; i < POOL.length; i++) {
                for (let j = 0; j < POOL.length; j++) {
                    if (verdicts[i]![j]! > 0) continue;
                    for (let k = 0; k < POOL.length; k++) {
                        if (verdicts[j]![k]! > 0) continue;
                        if (verdicts[i]![k]! > 0) {
                            failures.push(
                                `direction ${direction}: ${label(POOL[i])} <= ${label(POOL[j])} <= ${label(POOL[k])} but ${label(POOL[i])} > ${label(POOL[k])}`
                            );
                        }
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('reversing direction negates every non-null verdict and leaves null verdicts untouched', () => {
        const isNullish = (v: unknown): boolean => v === null || v === undefined;
        const failures: string[] = [];
        for (const a of POOL) {
            for (const b of POOL) {
                const asc = compareValues(a, b, 1);
                const desc = compareValues(a, b, -1);
                if (isNullish(a) || isNullish(b)) {
                    if (asc !== desc) failures.push(`null verdict direction-scaled for (${label(a)}, ${label(b)})`);
                } else if (desc !== -asc) {
                    failures.push(`non-null verdict not negated for (${label(a)}, ${label(b)}): asc ${asc}, desc ${desc}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('encoding is structurally idempotent and comparison is encoding-invariant [dec-encode-snapshots]', () => {
        const failures: string[] = [];
        for (const v of POOL) {
            const once = encodeSortValue(v);
            const twice = encodeSortValue(once);
            expect(twice, `re-encoding changed the value for ${label(v)}`).toEqual(once);
        }
        for (const direction of DIRECTIONS) {
            for (const a of POOL) {
                for (const b of POOL) {
                    const raw = compareValues(a, b, direction);
                    const encoded = compareValues(encodeSortValue(a), encodeSortValue(b), direction);
                    if (raw !== encoded) {
                        failures.push(`(${label(a)}, ${label(b)}, ${direction}): raw ${raw}, encoded ${encoded}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('verdicts survive a JSON cursor round-trip [dec-bigint-tagged-encoding]', () => {
        const roundtrip = (v: unknown): unknown => JSON.parse(JSON.stringify(encodeSortValue(v)));
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            for (const a of POOL) {
                for (const b of POOL) {
                    const direct = compareValues(a, b, direction);
                    const persisted = compareValues(roundtrip(a), roundtrip(b), direction);
                    if (direct !== persisted) {
                        failures.push(`(${label(a)}, ${label(b)}, ${direction}): direct ${direct}, after round-trip ${persisted}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

});

describe('compareToBoundary: bigint keyset seeks [dec-bigint-numeric-bracket]', () => {

    // amount spans bigint, number and null on purpose: real drivers hydrate one BIGINT column
    // as a mix of JS numbers (small values) and bigints (large values).
    type Row = { id: string; amount?: bigint | number | null };
    const rows: Row[] = [
        { id: 'a', amount: 2n },
        { id: 'b', amount: 10n },
        { id: 'c', amount: 15n },
        { id: 'd', amount: 100n },
        { id: 'e', amount: 12 },
        { id: 'f', amount: null },
    ];

    it('resumes strictly after a tagged bigint boundary by numeric value, across mixed hydration [dec-bigint-numeric-bracket]', () => {
        const sort: SortDefinition<Row> = [{ key: 'amount', direction: 1 }];
        const boundary: SortBoundary = { values: [encodeSortValue(10n)], pk: 'b' };
        expect(compareToBoundary(rows[0]!, boundary, sort, 'id')).toBeLessThan(0);      // 2n before
        expect(compareToBoundary(rows[1]!, boundary, sort, 'id')).toBe(0);              // the boundary row itself
        expect(compareToBoundary(rows[2]!, boundary, sort, 'id')).toBeGreaterThan(0);   // 15n after
        expect(compareToBoundary(rows[4]!, boundary, sort, 'id')).toBeGreaterThan(0);   // number 12 after
        expect(compareToBoundary(rows[5]!, boundary, sort, 'id')).toBeGreaterThan(0);   // null sorts last
        const nextPageIds = rows.filter(r => compareToBoundary(r, boundary, sort, 'id') > 0).map(r => r.id);
        expect(nextPageIds.sort()).toEqual(['c', 'd', 'e', 'f']);
    });

    it('resumes a descending bigint walk: smaller values are after the boundary [dec-bigint-numeric-bracket]', () => {
        const sort: SortDefinition<Row> = [{ key: 'amount', direction: -1 }];
        const boundary: SortBoundary = { values: [encodeSortValue(10n)], pk: 'b' };
        expect(compareToBoundary(rows[0]!, boundary, sort, 'id')).toBeGreaterThan(0);   // 2n after, descending
        expect(compareToBoundary(rows[3]!, boundary, sort, 'id')).toBeLessThan(0);      // 100n before, descending
    });

    it('a bare-string boundary value stays in the string bracket — the stale-cursor hazard is visible, not silent reinterpretation [dec-bigint-tagged-encoding]', () => {
        // A pre-tagged-encoding cursor holds '10' (a bare string). Bigint rows live in the numeric
        // bracket, before every string, so an ascending walk from such a boundary yields no bigint
        // rows — the documented migration behaviour, never a lexical reinterpretation.
        const sort: SortDefinition<Row> = [{ key: 'amount', direction: 1 }];
        const staleBoundary: SortBoundary = { values: ['10'], pk: 'b' };
        for (const row of rows.filter(r => typeof r.amount === 'bigint')) {
            expect(compareToBoundary(row, staleBoundary, sort, 'id'), `row ${row.id}`).toBeLessThan(0);
        }
    });

});

describe('compile-time contracts [dec-bigint-tagged-encoding]', () => {

    it('EncodedSortValue is exactly string | number | { readonly $bigint: string } | null [dec-bigint-tagged-encoding]', () => {
        expectTypeOf<EncodedSortValue>().toEqualTypeOf<string | number | { readonly $bigint: string } | null>();
    });

    it('the runtime schema and the type stay in lockstep [dec-bigint-tagged-encoding]', () => {
        expectTypeOf<z.infer<typeof EncodedSortValueSchema>>().toEqualTypeOf<EncodedSortValue>();
        expectTypeOf<EncodedSortValue>().toEqualTypeOf<z.infer<typeof EncodedSortValueSchema>>();
    });

    it('a tagged boundary value is accepted, a numeric tag payload is rejected [dec-bigint-tagged-encoding]', () => {
        const accepted: SortBoundary = { values: [{ $bigint: '10' }], pk: 'x' };
        expect(accepted.values).toHaveLength(1);
        const rejected = () => {
            // @ts-expect-error the tag payload must be a canonical decimal string, never a number
            const bad: SortBoundary = { values: [{ $bigint: 10 }], pk: 'x' };
            return bad;
        };
        expect(typeof rejected).toBe('function');
    });

});

describe('runtime schemas [dec-bigint-tagged-encoding]', () => {

    it('EncodedSortValueSchema accepts a canonical tag alongside the existing members [dec-bigint-tagged-encoding]', () => {
        const tagged = EncodedSortValueSchema.safeParse({ $bigint: '10' });
        expect(tagged.success).toBe(true);
        expect(tagged.data).toEqual({ $bigint: '10' });
        expect(EncodedSortValueSchema.safeParse({ $bigint: '-9223372036854775808' }).success).toBe(true);
        for (const existing of ['abc', 42, null]) {
            expect(EncodedSortValueSchema.safeParse(existing).success, `existing member ${label(existing)}`).toBe(true);
        }
    });

    it('EncodedSortValueSchema rejects non-canonical and widened tags [dec-bigint-tagged-encoding]', () => {
        const invalid: unknown[] = [
            { $bigint: '007' },
            { $bigint: '-0' },
            { $bigint: '' },
            { $bigint: '1.5' },
            { $bigint: 10 },
            { $bigint: '10', extra: 1 },
            {},
        ];
        for (const v of invalid) {
            expect(EncodedSortValueSchema.safeParse(v).success, `expected rejection for ${label(v)}`).toBe(false);
        }
    });

    it('SortAndSliceSchema accepts an after_boundary carrying tagged values [dec-bigint-tagged-encoding]', () => {
        const result = SortAndSliceSchema.safeParse({
            sort: [{ key: 'amount', direction: 1 }],
            after_boundary: { values: [{ $bigint: '10' }], pk: 'b' },
        });
        expect(result.success).toBe(true);
    });

    it('the 1:1 sort alignment rule still applies to tagged values [dec-bigint-tagged-encoding]', () => {
        const result = SortAndSliceSchema.safeParse({
            sort: [{ key: 'amount', direction: 1 }],
            after_boundary: { values: [{ $bigint: '1' }, { $bigint: '2' }], pk: 'b' },
        });
        expect(result.success).toBe(false);
    });

});

describe('astronomical magnitudes stay total and exact [dec-bigint-numeric-bracket]', () => {

    // The reserved shape admits canonical payloads of any length, including ones too large to
    // materialise as a BigInt at all — the comparator must order them exactly without doing so.
    const tenTo999 = { $bigint: '1' + '0'.repeat(999) };
    const nines999 = { $bigint: '9'.repeat(999) };
    const minusTenTo999 = { $bigint: '-1' + '0'.repeat(999) };
    const hugePositive = { $bigint: '9'.repeat(1_000_000) };
    const hugeNegative = { $bigint: '-' + '9'.repeat(1_000_000) };

    it('orders same-sign giant tags by magnitude', () => {
        expect(compareValues(nines999, tenTo999, 1)).toBe(-1);
        expect(compareValues(tenTo999, nines999, 1)).toBe(1);
        expect(compareValues({ $bigint: '-' + '9'.repeat(999) }, minusTenTo999, 1)).toBe(1);
        expect(compareValues(minusTenTo999, nines999, 1)).toBe(-1);
    });

    it('orders equal-length giant tags by digit value', () => {
        expect(compareValues({ $bigint: '1' + '2'.repeat(999) }, { $bigint: '1' + '3'.repeat(999) }, 1)).toBe(-1);
        expect(compareValues({ $bigint: '-1' + '2'.repeat(999) }, { $bigint: '-1' + '3'.repeat(999) }, 1)).toBe(1);
    });

    it('a tag beyond every finite double orders by its sign against any number', () => {
        expect(compareValues(tenTo999, 1e300, 1)).toBe(1);
        expect(compareValues(1e300, tenTo999, 1)).toBe(-1);
        expect(compareValues(minusTenTo999, -1e300, 1)).toBe(-1);
        expect(compareValues(hugePositive, Number.MAX_VALUE, 1)).toBe(1);
        expect(compareValues(hugeNegative, -Number.MAX_VALUE, 1)).toBe(-1);
    });

    it('million-digit tags compare without error, in both directions, and tie structurally', () => {
        expect(compareValues(hugePositive, hugeNegative, 1)).toBe(1);
        expect(compareValues(hugePositive, hugeNegative, -1)).toBe(-1);
        expect(compareValues(hugePositive, { $bigint: '9'.repeat(1_000_000) }, 1)).toBe(0);
        expect(compareValues(hugePositive, 0, -1)).toBe(-1);
        expect(compareValues(hugeNegative, null, 1)).toBe(-1);
    });
});
