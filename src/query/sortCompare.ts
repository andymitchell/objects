import { getProperty } from "../dot-prop-paths/getPropertySimpleDot.ts";
import type { SortDefinition, SortEntry } from './types.ts';

/**
 * The normalised form of a sort-key value: what a value looks like once it enters the
 * ordering contract. `null` for absent values, `number` for finite numbers, `string`
 * for everything else. JSON-serialisable, so encoded values survive a cursor round-trip.
 */
export type EncodedSortValue = string | number | null;

/**
 * Normalises any value into its {@link EncodedSortValue} form for sorting.
 *
 * `null` and `undefined` become `null`; finite numbers stay numbers; everything else —
 * strings pass through, and booleans, dates, objects, arrays, bigints and non-finite
 * numbers take their `String(v)` form.
 *
 * Exists so that consumers persisting sort-key values (e.g. inside pagination cursors)
 * store exactly what the comparator will see: for all values `x`, `y` and directions `d`,
 * `compareValues(encodeSortValue(x), encodeSortValue(y), d) === compareValues(x, y, d)`.
 *
 * @param v - Any value read from a sort-key path.
 * @returns The encoded value: `null`, a finite `number`, or a `string`.
 *
 * @example
 * encodeSortValue(undefined);  // null
 * encodeSortValue(9.5);        // 9.5
 * encodeSortValue(NaN);        // 'NaN'
 * encodeSortValue(true);       // 'true'
 *
 * @remarks
 * Idempotent: `encodeSortValue(encodeSortValue(v)) === encodeSortValue(v)`. Non-finite
 * numbers move to the string form because JSON cannot carry them — keeping them numeric
 * would let a value order differently before and after a cursor round-trip.
 * Total: never throws. A value that resists string coercion entirely (an object with no
 * prototype, a throwing `toString`/`Symbol.toPrimitive`, a revoked proxy) encodes to the
 * literal `'[object Object]'`.
 */
export function encodeSortValue(v: unknown): EncodedSortValue {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v === 'string') return v;
    try {
        return String(v);
    } catch {
        // A value with no usable string form (no-prototype object, throwing toString or
        // Symbol.toPrimitive, revoked proxy, or an array containing one). The literal is
        // returned rather than re-probing the value: any further call into it could throw
        // again, and encoding must never throw.
        return '[object Object]';
    }
}

/**
 * Three-way comparison of two sort-key values under a direction. Returns exactly
 * `-1`, `0` or `1`.
 *
 * This is the single statement of the value-ordering contract shared by the in-memory
 * sorter and the SQL query builders: null and undefined sort last in *both* directions;
 * finite numbers compare numerically and order before all string-formed values; strings
 * compare by code point.
 *
 * @param a - Left value (raw or already encoded — encoding is idempotent).
 * @param b - Right value.
 * @param direction - `1` ascending, `-1` descending. Required: the direction is applied
 *   inside this function so that null verdicts are never direction-scaled. Callers must
 *   never multiply the result by a direction themselves.
 * @returns `-1` if `a` orders before `b`, `1` if after, `0` if they tie.
 *
 * @example
 * compareValues(3, 5, 1);       // -1
 * compareValues(3, 5, -1);      // 1
 * compareValues(3, null, -1);   // -1 — nulls last even when descending
 *
 * @remarks
 * The comparator defines a total order over all inputs and never throws — pagination
 * requires that any two values, however malformed, order consistently. String comparison
 * is by Unicode code point — equal to UTF-8 byte order (SQLite BINARY collation, Postgres
 * C collation), not to JavaScript's native UTF-16 code-unit order, which differs for
 * supplementary-plane characters. Mixed-type pairs
 * resolve by bracket (numbers before strings, direction-scaled) rather than by string
 * coercion, which was not transitive (`10 < '30' < 5 < 10` cycles). Structural values
 * (objects, arrays) take their string form and so mutually tie; ordering them is outside
 * the cross-backend contract — the SQL builders refuse structural sort keys outright.
 * This deliberately
 * diverges from the where-filter range operators (see `evaluatePredicate`), which
 * type-bracket to a non-match: a filter answers a boolean predicate, whereas ordering
 * needs a three-way verdict for every pair.
 */
export function compareValues(a: unknown, b: unknown, direction: 1 | -1): number {
    const ea = encodeSortValue(a);
    const eb = encodeSortValue(b);

    // Nulls always last, in both directions — the null verdict is never direction-scaled.
    if (ea === null && eb === null) return 0;
    if (ea === null) return 1;
    if (eb === null) return -1;

    const aNum = typeof ea === 'number';
    const bNum = typeof eb === 'number';
    if (aNum && !bNum) return -1 * direction;
    if (!aNum && bNum) return 1 * direction;

    if (typeof ea === 'string' && typeof eb === 'string') {
        return compareStringsByCodePoint(ea, eb) * direction;
    }
    return (ea < eb ? -1 : ea > eb ? 1 : 0) * direction;
}

/**
 * Compares two strings by Unicode code point. JS relational operators compare by UTF-16
 * code unit, which inverts pairs where one string starts a surrogate pair (all supplementary-
 * plane characters) and the other holds a BMP character above U+D7FF; code-point order equals
 * UTF-8 byte order, which is what SQLite's BINARY collation and Postgres's C collation use.
 * Lone surrogates (never representable in UTF-8/JSON) still order totally, by their own value.
 */
function compareStringsByCodePoint(a: string, b: string): number {
    if (a === b) return 0;
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (i < len) {
        const ca = a.codePointAt(i)!;
        const cb = b.codePointAt(i)!;
        if (ca !== cb) return ca < cb ? -1 : 1;
        i += ca > 0xFFFF ? 2 : 1;   // equal code points advance both strings equally
    }
    return a.length < b.length ? -1 : 1;   // equal prefix; a === b already returned 0
}

/**
 * Applies the primary-key tiebreak rule to a sort definition, stated once for every
 * query implementation: append `{ key: primaryKey, direction: 1 }` — always ascending,
 * regardless of the other entries' directions — unless the sort is empty or its last
 * entry is already the primary key.
 *
 * An empty sort stays empty: no ordering was requested, so none is invented. When the
 * last entry is already the pk, appending would be unreachable (the pk is unique), so
 * the input is returned as-is.
 *
 * @param sort - The requested sort definition. Never mutated.
 * @param primaryKey - The property that uniquely identifies each item.
 * @returns The resolved sort. May be the input array itself when no append was needed.
 *
 * @example
 * resolveSort([{ key: 'score', direction: -1 }], 'id');
 * // [{ key: 'score', direction: -1 }, { key: 'id', direction: 1 }]
 */
export function resolveSort<T extends Record<string, any>>(
    sort: SortDefinition<T>,
    primaryKey: keyof T & string
): SortDefinition<T> {
    if (sort.length === 0) return sort;
    const lastEntry = sort[sort.length - 1]!;
    if (lastEntry.key === primaryKey) return sort;
    // A top-level key of T is always a valid dot-prop path into T, but TypeScript cannot
    // prove `keyof T & string` narrows into the recursive path union for an unresolved T.
    const pkEntry = { key: primaryKey, direction: 1 } as SortEntry<T>;
    return [...sort, pkEntry];
}

/**
 * Builds an item-vs-item comparator implementing the full ordering contract: walk the
 * resolved sort entries (see {@link resolveSort}) in priority order, reading each key as
 * a dot-prop path and comparing with {@link compareValues}; the first non-tie wins.
 *
 * @param sort - The requested sort definition; the pk tiebreak is appended automatically.
 * @param primaryKey - The property that uniquely identifies each item.
 * @returns A comparator suitable for `Array.prototype.sort`. Returns `0` only when two
 *   items tie on every sort key including the primary key.
 *
 * @example
 * const emails = [...items].sort(buildSortComparator([{ key: 'date', direction: -1 }], 'id'));
 * // newest first; equal dates resolved by ascending id
 */
export function buildSortComparator<T extends Record<string, any>>(
    sort: SortDefinition<T>,
    primaryKey: keyof T & string
): (a: T, b: T) => number {
    const entries = resolveSort(sort, primaryKey);
    return (a, b) => {
        for (const entry of entries) {
            const cmp = compareValues(getProperty(a, entry.key), getProperty(b, entry.key), entry.direction);
            if (cmp !== 0) return cmp;
        }
        return 0;
    };
}
