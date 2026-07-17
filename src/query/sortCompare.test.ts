import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    encodeSortValue,
    compareValues,
    resolveSort,
    buildSortComparator,
    type EncodedSortValue,
} from './sortCompare.ts';
import type { SortDefinition } from './types.ts';

/**
 * Deterministic value corpus covering every encoding bracket: null-likes, finite numbers
 * (including extremes), non-finite numbers, strings (including numeric-looking and
 * collision-prone ones), booleans, objects, arrays, dates and bigints.
 */
// Non-ASCII strings are built with String.fromCodePoint so the source holds no invisible characters.
const PRIVATE_USE_BMP = String.fromCodePoint(0xE000);        // BMP, above every ASCII code point
const BMP_MAX = String.fromCodePoint(0xFFFF);                // highest BMP code point
const FIRST_SUPPLEMENTARY = String.fromCodePoint(0x10000);   // a UTF-16 surrogate pair
const MAX_CODE_POINT = String.fromCodePoint(0x10FFFF);       // highest Unicode code point
const LONE_HIGH_SURROGATE = String.fromCharCode(0xD800);     // not a code point pair — JS-only value

const CORPUS: unknown[] = [null, undefined, 0, 1, -1, 10, 9.5, 1e308, -1e308, Infinity, -Infinity, NaN,
    '', '0', '1', '10', '9', 'a', 'Z', 'abc', 'NaN', '[object Object]',
    PRIVATE_USE_BMP, BMP_MAX, FIRST_SUPPLEMENTARY, MAX_CODE_POINT,
    true, false, {}, { a: 1 }, [], [1, 2], new Date('2024-01-02T00:00:00Z'), 10n,
    Object.create(null), { toString() { throw new Error('no string form'); } }, Symbol('x')];

const DIRECTIONS = [1, -1] as const;

const isNullish = (v: unknown): boolean => v === null || v === undefined;

/** Human-readable label for a corpus value, for failure messages. */
function label(v: unknown): string {
    if (typeof v === 'bigint') return `${v}n`;
    if (v instanceof Date) return `Date(${v.toISOString()})`;
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return JSON.stringify(v);
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

describe('compareValues', () => {

    it('every verdict is exactly -1, 0 or +1', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            for (const a of CORPUS) {
                for (const b of CORPUS) {
                    const verdict = compareValues(a, b, direction);
                    if (verdict !== -1 && verdict !== 0 && verdict !== 1) {
                        failures.push(`compareValues(${label(a)}, ${label(b)}, ${direction}) = ${verdict}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('swapping the operands negates the verdict', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            for (const a of CORPUS) {
                for (const b of CORPUS) {
                    const forward = compareValues(a, b, direction);
                    const backward = compareValues(b, a, direction);
                    if (!(forward === -backward)) {
                        failures.push(`(${label(a)}, ${label(b)}, ${direction}): ${forward} vs swapped ${backward}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('the order is transitive across every corpus triple', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            // Precompute the pairwise matrix so the triple loop stays cheap.
            const verdicts = CORPUS.map(a => CORPUS.map(b => compareValues(a, b, direction)));
            for (let i = 0; i < CORPUS.length; i++) {
                for (let j = 0; j < CORPUS.length; j++) {
                    if (verdicts[i]![j]! > 0) continue;
                    for (let k = 0; k < CORPUS.length; k++) {
                        if (verdicts[j]![k]! > 0) continue;
                        if (verdicts[i]![k]! > 0) {
                            failures.push(
                                `direction ${direction}: ${label(CORPUS[i])} <= ${label(CORPUS[j])} <= ${label(CORPUS[k])} but ${label(CORPUS[i])} > ${label(CORPUS[k])}`
                            );
                        }
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('resolves the string-coercion cycle: 5, 10 and "30" form a chain, not a loop', () => {
        // Under string coercion these three formed a cycle (10 < '30', '30' < 5, 5 < 10).
        expect(compareValues(5, 10, 1)).toBe(-1);
        expect(compareValues(10, '30', 1)).toBe(-1);
        expect(compareValues(5, '30', 1)).toBe(-1);
    });

    it('null and undefined sort last in both directions', () => {
        const failures: string[] = [];
        for (const direction of DIRECTIONS) {
            for (const nullish of [null, undefined]) {
                for (const v of CORPUS) {
                    if (isNullish(v)) continue;
                    if (compareValues(v, nullish, direction) !== -1) {
                        failures.push(`${label(v)} did not sort before ${label(nullish)} at direction ${direction}`);
                    }
                    if (compareValues(nullish, v, direction) !== 1) {
                        failures.push(`${label(nullish)} did not sort after ${label(v)} at direction ${direction}`);
                    }
                }
            }
            expect(compareValues(null, undefined, direction)).toBe(0);
            expect(compareValues(undefined, null, direction)).toBe(0);
        }
        expect(failures).toEqual([]);
    });

    it('reversing direction negates every non-null verdict and leaves null verdicts untouched', () => {
        const failures: string[] = [];
        for (const a of CORPUS) {
            for (const b of CORPUS) {
                const asc = compareValues(a, b, 1);
                const desc = compareValues(a, b, -1);
                if (isNullish(a) || isNullish(b)) {
                    if (!(asc === desc)) {
                        failures.push(`null verdict direction-scaled for (${label(a)}, ${label(b)}): asc ${asc}, desc ${desc}`);
                    }
                } else if (!(desc === -asc)) {
                    failures.push(`non-null verdict not negated for (${label(a)}, ${label(b)}): asc ${asc}, desc ${desc}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('encoding is idempotent and comparison is encoding-invariant', () => {
        const failures: string[] = [];
        for (const v of CORPUS) {
            const once = encodeSortValue(v);
            const twice = encodeSortValue(once);
            if (!(once === twice)) {
                failures.push(`encodeSortValue not idempotent for ${label(v)}: ${label(once)} vs ${label(twice)}`);
            }
        }
        for (const direction of DIRECTIONS) {
            for (const a of CORPUS) {
                for (const b of CORPUS) {
                    const raw = compareValues(a, b, direction);
                    const encoded = compareValues(encodeSortValue(a), encodeSortValue(b), direction);
                    if (!(raw === encoded)) {
                        failures.push(`round-trip broke for (${label(a)}, ${label(b)}, ${direction}): raw ${raw}, encoded ${encoded}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    describe('type brackets', () => {

        it('finite numbers order before every string-bracket value, scaled by direction', () => {
            expect(compareValues(10, '9', 1)).toBe(-1);
            expect(compareValues(10, '9', -1)).toBe(1);
        });

        it('NaN takes its string form and lands in the string bracket, after finite numbers', () => {
            expect(compareValues(NaN, 5, 1)).toBe(1);
        });

        it('-Infinity takes its string form and lands in the string bracket, after finite numbers', () => {
            expect(compareValues(-Infinity, 5, 1)).toBe(1);
        });

        it('booleans order by their string forms, so false comes before true', () => {
            expect(compareValues(false, true, 1)).toBe(-1);
        });

    });

    describe('code-point string ordering', () => {

        it('orders a BMP character before a supplementary-plane character, in both directions', () => {
            // In UTF-16, U+10000 begins with the surrogate 0xD800, which is below 0xE000 — a
            // code-unit comparison would invert this pair. Code-point order (= UTF-8 byte order,
            // which SQLite BINARY and Postgres C collation use) puts U+E000 first.
            expect(compareValues(PRIVATE_USE_BMP, FIRST_SUPPLEMENTARY, 1)).toBe(-1);
            expect(compareValues(PRIVATE_USE_BMP, FIRST_SUPPLEMENTARY, -1)).toBe(1);
        });

        it('orders ASCII before every character above it', () => {
            expect(compareValues('z', PRIVATE_USE_BMP, 1)).toBe(-1);
        });

        it('orders a lone surrogate totally, by its code-unit value', () => {
            // Lone surrogates cannot survive UTF-8 or JSON, so engines never see them; the JS
            // comparator must still place them somewhere consistent to stay total.
            expect(compareValues(LONE_HIGH_SURROGATE, PRIVATE_USE_BMP, 1)).toBe(-1);
        });

    });

});

describe('Totality', () => {

    it('encodes an object with no prototype to the plain object form instead of throwing', () => {
        expect(encodeSortValue(Object.create(null))).toBe('[object Object]');
    });

    it('encodes an object whose toString throws to the plain object form instead of throwing', () => {
        const hostile = { toString() { throw new Error('no string form'); } };
        expect(encodeSortValue(hostile)).toBe('[object Object]');
    });

    it('encodes an object whose Symbol.toPrimitive throws to the plain object form instead of throwing', () => {
        const hostile = { [Symbol.toPrimitive]() { throw new Error('no primitive form'); } };
        expect(encodeSortValue(hostile)).toBe('[object Object]');
    });

    it('encodes an array containing an uncoercible element to the plain object form instead of throwing', () => {
        expect(encodeSortValue([Object.create(null)])).toBe('[object Object]');
    });

    it('encodes a symbol by its string form without throwing', () => {
        expect(encodeSortValue(Symbol('x'))).toBe('Symbol(x)');
    });

});

describe('resolveSort', () => {

    type Item = { id: string; score: number };

    it('appends an ascending pk entry when the last sort entry is not the pk', () => {
        const sort: SortDefinition<Item> = [{ key: 'score', direction: -1 }];
        const resolved = resolveSort(sort, 'id');
        expect(resolved).toEqual([{ key: 'score', direction: -1 }, { key: 'id', direction: 1 }]);
    });

    it('never mutates the input sort when appending', () => {
        const sort: SortDefinition<Item> = [{ key: 'score', direction: -1 }];
        const snapshot = structuredClone(sort);
        resolveSort(sort, 'id');
        expect(sort).toEqual(snapshot);
    });

    it('returns the sort unchanged and unmutated when the last entry is already the pk', () => {
        const sort: SortDefinition<Item> = [{ key: 'score', direction: 1 }, { key: 'id', direction: -1 }];
        const snapshot = structuredClone(sort);
        const resolved = resolveSort(sort, 'id');
        expect(resolved).toEqual(snapshot);
        expect(sort).toEqual(snapshot);
    });

    it('an empty sort stays empty: no ordering was requested, so none is invented', () => {
        expect(resolveSort<Item>([], 'id')).toEqual([]);
    });

    it('skipping the pk append when the sort already ends on the pk changes nothing observable', () => {
        // With a unique pk the appended entry is unreachable, so a descending-pk sort must
        // order identically to an explicit [pk desc, pk asc] walk.
        const items: Item[] = [
            { id: 'b', score: 1 }, { id: 'd', score: 2 }, { id: 'a', score: 3 }, { id: 'c', score: 4 },
        ];
        const viaComparator = [...items].sort(buildSortComparator<Item>([{ key: 'id', direction: -1 }], 'id'));
        const handWalk: Array<{ key: string; direction: 1 | -1 }> = [
            { key: 'id', direction: -1 }, { key: 'id', direction: 1 },
        ];
        const viaHandWalk = [...items].sort((a, b) => {
            for (const entry of handWalk) {
                const cmp = compareValues(a[entry.key as keyof Item], b[entry.key as keyof Item], entry.direction);
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
        expect(viaComparator.map(i => i.id)).toEqual(viaHandWalk.map(i => i.id));
        expect(viaComparator.map(i => i.id)).toEqual(['d', 'c', 'b', 'a']);
    });

});

describe('buildSortComparator', () => {

    type Message = { id: string; score: number; sender?: { name: string } };

    it('follows nested dot-prop sort keys, with rows missing the parent object last', () => {
        const items: Message[] = [
            { id: '1', score: 0, sender: { name: 'Zara' } },
            { id: '2', score: 0 },
            { id: '3', score: 0, sender: { name: 'Amir' } },
        ];
        const sorted = [...items].sort(buildSortComparator<Message>([{ key: 'sender.name', direction: 1 }], 'id'));
        expect(sorted.map(i => i.id)).toEqual(['3', '1', '2']);
    });

    it('applies sort entries in priority order: later entries only break earlier ties', () => {
        type Row = { id: string; group: string; rank: number };
        const items: Row[] = [
            { id: '1', group: 'b', rank: 1 },
            { id: '2', group: 'a', rank: 9 },
            { id: '3', group: 'a', rank: 2 },
        ];
        const sorted = [...items].sort(buildSortComparator<Row>(
            [{ key: 'group', direction: 1 }, { key: 'rank', direction: -1 }], 'id'
        ));
        expect(sorted.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    it('falls back to ascending pk when every sort key ties', () => {
        const items: Message[] = [
            { id: 'c', score: 7 }, { id: 'a', score: 7 }, { id: 'b', score: 7 },
        ];
        const sorted = [...items].sort(buildSortComparator<Message>([{ key: 'score', direction: -1 }], 'id'));
        expect(sorted.map(i => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('object-valued sort keys tie on their shared string form, so the pk decides', () => {
        // Structural values all encode to '[object Object]'; ordering them is outside the
        // cross-backend contract (the SQL builders refuse such sort keys), but the runtime
        // comparator stays total and resolves them deterministically via the pk tiebreak.
        type Row = { id: string; meta: Record<string, number> };
        const items: Row[] = [
            { id: 'b', meta: { a: 1 } },
            { id: 'a', meta: { b: 1 } },
        ];
        const sorted = [...items].sort(buildSortComparator<Row>([{ key: 'meta', direction: 1 }], 'id'));
        expect(sorted.map(i => i.id)).toEqual(['a', 'b']);
    });

    it('returns 0 when rows tie on every sort key including the pk', () => {
        const comparator = buildSortComparator<Message>([{ key: 'score', direction: -1 }], 'id');
        expect(comparator({ id: 'a', score: 7 }, { id: 'a', score: 7 })).toBe(0);
    });

});

describe('compile-time contracts', () => {

    it('rejects a compareValues call without a direction', () => {
        const typeOnly = () => {
            // @ts-expect-error direction is required
            compareValues(1, 2);
        };
        expect(typeof typeOnly).toBe('function');
    });

    it('EncodedSortValue is exactly string | number | null', () => {
        expectTypeOf<EncodedSortValue>().toEqualTypeOf<string | number | null>();
    });

});
