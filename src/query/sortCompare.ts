import { getProperty } from "../dot-prop-paths/getPropertySimpleDot.ts";
import type { SortBoundary, SortDefinition, SortEntry } from './types.ts';

/**
 * The encoded form of a bigint sort value: a frozen tag carrying its canonical decimal string.
 *
 * A tagged object — rather than a bare string or number — because a decimal string would be
 * indistinguishable from a genuine user string (and mis-bracket someone's data), and a number
 * is lossy past 2^53. The shape is reserved by the ordering contract: any raw value of exactly
 * this shape (single own key, canonical payload) is treated as an encoded bigint and orders
 * numerically. See `decisions.md` dec-bigint-tagged-encoding.
 */
export type EncodedBigInt = { readonly $bigint: string };

/**
 * The canonical decimal integer form carried by an {@link EncodedBigInt}: optional minus sign,
 * no leading zeros, no `-0`. Exactly the output of `BigInt.prototype.toString`, so every bigint
 * has one — and only one — encoded representation.
 */
export const CANONICAL_BIGINT_RE = /^(0|-?[1-9][0-9]*)$/;

/**
 * The normalised form of a sort-key value: what a value looks like once it enters the
 * ordering contract. `null` for absent values, `number` for finite numbers, a frozen
 * {@link EncodedBigInt} tag for bigints, `string` for everything else. JSON-serialisable,
 * so encoded values survive a cursor round-trip with their bracket intact.
 */
export type EncodedSortValue = string | number | EncodedBigInt | null;

/**
 * Reads a candidate tagged-bigint object with a single guarded property access: exactly one own
 * enumerable key, `$bigint` (an inherited key never qualifies, so a polluted prototype cannot
 * smuggle an encoding), whose value — read exactly once — must be a canonical decimal string.
 * Returns the payload, or `undefined` when the object is not a tag. May throw on hostile objects
 * (revoked proxy, throwing getter); callers supply the try/catch.
 */
function readCanonicalBigIntPayload(v: object): string | undefined {
    const keys = Object.keys(v);
    if (keys.length !== 1 || keys[0] !== '$bigint' || !('$bigint' in v)) return undefined;
    const payload: unknown = v.$bigint;
    return typeof payload === 'string' && CANONICAL_BIGINT_RE.test(payload) ? payload : undefined;
}

/**
 * Typeguard for the {@link EncodedBigInt} tagged form: exactly one own key `$bigint` holding a
 * canonical decimal string. Total — hostile shapes (throwing getters, revoked proxies) return
 * `false` rather than throwing.
 *
 * @remarks
 * Verification reads the payload once; an object with a getter can still present a different
 * value to a later reader. To hold a value that is stable by construction, encode it with
 * {@link encodeSortValue}, which returns a frozen snapshot.
 */
export function isEncodedBigInt(v: unknown): v is EncodedBigInt {
    if (typeof v !== 'object' || v === null) return false;
    try {
        return readCanonicalBigIntPayload(v) !== undefined;
    } catch {
        return false;
    }
}

/**
 * Normalises any value into its {@link EncodedSortValue} form for sorting.
 *
 * `null` and `undefined` become `null`; finite numbers stay numbers; bigints become the
 * frozen tagged form `{ $bigint: '<decimal>' }`; strings pass through; everything else —
 * booleans, dates, objects, arrays and non-finite numbers — takes its `String(v)` form.
 *
 * Exists so that consumers persisting sort-key values (e.g. inside pagination cursors)
 * store exactly what the comparator will see: for all values `x`, `y` and directions `d`,
 * `compareValues(encodeSortValue(x), encodeSortValue(y), d) === compareValues(x, y, d)`.
 *
 * @param v - Any value read from a sort-key path.
 * @returns The encoded value: `null`, a finite `number`, a frozen {@link EncodedBigInt}, or a `string`.
 *
 * @example
 * encodeSortValue(undefined);  // null
 * encodeSortValue(9.5);        // 9.5
 * encodeSortValue(10n);        // { $bigint: '10' } — frozen
 * encodeSortValue(NaN);        // 'NaN'
 *
 * @remarks
 * Idempotent: primitives re-encode to themselves (`===`); a tagged form re-encodes to a fresh
 * frozen snapshot that is deep-equal and compares `0` — structural, not reference, idempotence.
 * The snapshot rule also applies to caller-supplied objects of the reserved shape: the payload
 * is read exactly once and copied, so a getter or proxy that later throws or changes can never
 * reach the comparator (see `decisions.md` dec-encode-snapshots). A malformed tag (non-canonical
 * payload, extra keys, inherited `$bigint`) is not a tag and takes the structural string form.
 * Non-finite numbers move to the string form because JSON cannot carry them — keeping them
 * numeric would let a value order differently before and after a cursor round-trip.
 * Total: never throws. A value that resists encoding entirely (an object with no prototype, a
 * throwing getter, `toString` or `Symbol.toPrimitive`, a revoked proxy) encodes to the literal
 * `'[object Object]'`.
 */
export function encodeSortValue(v: unknown): EncodedSortValue {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v === 'string') return v;
    if (typeof v === 'bigint') return Object.freeze({ $bigint: v.toString() });
    try {
        if (typeof v === 'object') {
            const payload = readCanonicalBigIntPayload(v);
            if (payload !== undefined) return Object.freeze({ $bigint: payload });
        }
        return String(v);
    } catch {
        // A value with no usable encoded form (no-prototype object, throwing getter, toString or
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
 * the numeric bracket — finite numbers and bigints together, compared by exact real
 * value — orders before all string-formed values; strings compare by code point.
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
 * compareValues(3, null, -1);   // -1 — nulls last even when descending
 * compareValues(10n, 10.5, 1);  // -1 — bigints and numbers share one bracket, compared exactly
 *
 * @remarks
 * The comparator defines a total order over all inputs and never throws — pagination
 * requires that any two values, however malformed, order consistently. Bigints and finite
 * numbers share the numeric bracket because real drivers hydrate a single BIGINT column as
 * a mix of JS numbers (small values) and JS bigints (large values); separate brackets would
 * silently misorder such rows. Every pairing involving a bigint compares exactly at any
 * magnitude — `2n ** 53n + 1n` does not collapse into `2 ** 53` — and equal values of
 * different numeric types (`10` vs `10n`) tie, falling to the caller's pk tiebreak.
 * String comparison
 * is by Unicode code point — equal to UTF-8 byte order (SQLite BINARY collation, Postgres
 * C collation), not to JavaScript's native UTF-16 code-unit order, which differs for
 * supplementary-plane characters. The SQL builders hold Postgres to this by pinning every text
 * expression with `COLLATE "C"` — sort, cursor, and where-filter comparison alike — so a database
 * whose default collation is locale-aware (e.g. `en_US`, where `'a' < 'B'`) still orders and matches
 * exactly as this comparator does. Mixed-bracket pairs
 * resolve by bracket (numeric before string, direction-scaled) rather than by string
 * coercion, which was not transitive (`10 < '30' < 5 < 10` cycles). Structural values
 * (objects, arrays) take their string form and so mutually tie — except the reserved
 * {@link EncodedBigInt} shape, which orders as the bigint it denotes; ordering other
 * structural values is outside the cross-backend contract — the SQL builders refuse
 * structural sort keys outright.
 * Mixed-type pairs
 * deliberately diverge from the where-filter range operators (see `evaluatePredicate`), which
 * type-bracket to a non-match rather than an order: a filter answers a boolean predicate, whereas
 * ordering needs a three-way verdict for every pair. String pairs do not diverge: a range bound
 * between two strings satisfies by this same code-point comparison, so a filter and a sort on one
 * key agree about which values lie beyond a bound.
 */
export function compareValues(a: unknown, b: unknown, direction: 1 | -1): number {
    const ea = encodeSortValue(a);
    const eb = encodeSortValue(b);

    // Nulls always last, in both directions — the null verdict is never direction-scaled.
    if (ea === null && eb === null) return 0;
    if (ea === null) return 1;
    if (eb === null) return -1;

    // Bracket dispatch: the numeric bracket (finite numbers and encoded bigints) orders
    // before the string bracket. Ties are returned as literal 0 — `verdict * direction`
    // would yield -0 when descending, which Object.is-based consumers distinguish from 0.
    if (typeof ea === 'string') {
        if (typeof eb !== 'string') return 1 * direction;
        const verdict = compareStringsByCodePoint(ea, eb);
        return verdict === 0 ? 0 : verdict * direction;
    }
    if (typeof eb === 'string') return -1 * direction;
    const verdict = compareNumericBracket(ea, eb);
    return verdict === 0 ? 0 : verdict * direction;
}

/**
 * Three-way comparison inside the numeric bracket, where finite numbers and encoded bigints
 * order together by exact real value. Number/number keeps native comparison; every pairing
 * involving a bigint compares exactly, with no round-trip through double precision.
 *
 * Tag payloads are ordered without ever materialising a `BigInt`: the canonical decimal form
 * makes (sign, digit count, digit order) an exact numeric comparison, and a payload longer
 * than every finite double is decided by sign alone. This keeps the bracket total for payloads
 * of any length — a `BigInt` construction would throw past the engine's size limit.
 */
function compareNumericBracket(a: number | EncodedBigInt, b: number | EncodedBigInt): -1 | 0 | 1 {
    if (typeof a === 'number') {
        if (typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
        // Flip the tag-first verdict: b orders before a exactly when a orders after b.
        const verdict = compareTagToNumber(b.$bigint, a);
        return verdict === -1 ? 1 : verdict === 1 ? -1 : 0;
    }
    if (typeof b === 'number') return compareTagToNumber(a.$bigint, b);
    return compareCanonicalDecimal(a.$bigint, b.$bigint);
}

/**
 * Exact three-way compare of two canonical decimal integer strings (no leading zeros, no
 * `'-0'`), by the values they denote. Sign decides mixed-sign pairs; within a sign, more
 * digits means larger magnitude, and equal digit counts compare lexicographically (digit
 * characters are ordered). Never constructs a numeric value, so any payload length is safe.
 */
function compareCanonicalDecimal(a: string, b: string): -1 | 0 | 1 {
    const negA = a.charCodeAt(0) === 45; // '-'
    const negB = b.charCodeAt(0) === 45;
    if (negA !== negB) return negA ? -1 : 1;
    const magA = negA ? a.slice(1) : a;
    const magB = negB ? b.slice(1) : b;
    let magnitude: -1 | 0 | 1;
    if (magA.length !== magB.length) magnitude = magA.length < magB.length ? -1 : 1;
    else magnitude = magA < magB ? -1 : magA > magB ? 1 : 0;
    return negA ? (magnitude === -1 ? 1 : magnitude === 1 ? -1 : 0) : magnitude;
}

/**
 * Magnitude digit counts above this exceed every finite double (`Number.MAX_VALUE` has 309
 * integer digits), so a tag that long orders by sign alone against any number.
 */
const DIGITS_BEYOND_ANY_DOUBLE = 310;

/**
 * Exact three-way compare of a canonical tag payload against a finite double. Answers for the
 * tag — `-1` when it orders before the number. A payload too large for any double is decided
 * by sign without materialising it; otherwise the payload is small enough to construct safely
 * and compares via {@link compareBigIntToNumber}.
 */
function compareTagToNumber(payload: string, n: number): -1 | 0 | 1 {
    const negative = payload.charCodeAt(0) === 45; // '-'
    const magnitudeDigits = negative ? payload.length - 1 : payload.length;
    if (magnitudeDigits >= DIGITS_BEYOND_ANY_DOUBLE) return negative ? -1 : 1;
    return compareBigIntToNumber(BigInt(payload), n);
}

/**
 * Exact three-way compare of a bigint against a finite double: any finite double's truncation
 * is an integer-valued double, and `BigInt()` of it is exact; the discarded fraction then
 * breaks the tie. Answers for the bigint — `-1` when it orders before the number.
 */
function compareBigIntToNumber(b: bigint, n: number): -1 | 0 | 1 {
    const t = Math.trunc(n);
    const bt = BigInt(t);
    if (b < bt) return -1;
    if (b > bt) return 1;
    const frac = n - t;
    return frac > 0 ? -1 : frac < 0 ? 1 : 0;
}

/**
 * Compares two strings by Unicode code point — the one text comparison referenced by both the
 * ordering contract ({@link compareValues}) and the where-filter range operators, so a sort and a
 * range bound on the same key can never disagree about which values lie beyond a boundary.
 *
 * JS relational operators compare by UTF-16 code unit, which inverts pairs where one string
 * starts a surrogate pair (all supplementary-plane characters) and the other holds a BMP
 * character above U+D7FF.
 *
 * Exported for consumers implementing the same text-ordering contract against their own
 * substrate.
 *
 * @param a - Left string.
 * @param b - Right string.
 * @returns Negative if `a` orders before `b`, positive if after, `0` if equal.
 *
 * @example
 * compareStringsByCodePoint(String.fromCodePoint(0xE000), String.fromCodePoint(0x10000)); // < 0
 * [...items].sort((x, y) => compareStringsByCodePoint(x.name, y.name));
 *
 * @remarks
 * Total over all JS strings — a lone surrogate compares as its own value — and equal to UTF-8
 * byte order (SQLite's BINARY collation, Postgres's C collation) exactly for well-formed
 * scalar-value strings, since a lone surrogate has no UTF-8 representation.
 */
export function compareStringsByCodePoint(a: string, b: string): number {
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
 * Three-way comparison of an item against a pagination {@link SortBoundary} under a sort
 * definition. Returns a negative number if the item orders before the boundary, positive if
 * after, and `0` if it *is* the boundary position.
 *
 * This is the in-memory statement of the value-based keyset seek: to resume a walk strictly
 * after the boundary, keep the items for which this returns a positive number. It reads each of
 * the user's `sort` keys as a dot-prop path and compares it to the aligned boundary value with
 * {@link compareValues}; the first non-tie wins. If every sort key ties, the primary key breaks
 * the tie — always ascending, and only when the sort does not already end on the primary key
 * (the same rule {@link resolveSort} applies). When the pk arm does not apply, all-tied yields `0`.
 *
 * @param item - The candidate row.
 * @param boundary - The boundary: encoded sort-key values (aligned 1:1 with `sort`) plus the pk.
 * @param sort - The user's sort definition (before the automatic pk tiebreaker is appended).
 * @param primaryKey - The property that uniquely identifies each item.
 * @returns Negative if `item` is before the boundary, positive if strictly after, `0` if equal.
 *
 * @example
 * // Keep only rows strictly after the boundary
 * const next = sorted.filter(i => compareToBoundary(i, boundary, sort, 'id') > 0);
 */
export function compareToBoundary<T extends Record<string, any>>(
    item: T,
    boundary: SortBoundary,
    sort: SortDefinition<T>,
    primaryKey: keyof T & string
): number {
    for (let i = 0; i < sort.length; i++) {
        const entry = sort[i]!;
        const cmp = compareValues(getProperty(item, entry.key), boundary.values[i], entry.direction);
        if (cmp !== 0) return cmp;
    }
    // Every user sort key tied. Break by the primary key — always ascending — unless the sort
    // already ends on the pk (then the tiebreak arm is unreachable and none is appended), the
    // same rule resolveSort applies. An empty sort has no tiebreak either.
    const lastEntry = sort[sort.length - 1];
    if (sort.length === 0 || lastEntry!.key === primaryKey) return 0;
    return compareValues(item[primaryKey], boundary.pk, 1);
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
