/**
 * Deep structural equality for addToSet deduplication.
 *
 * - Scalars: `===` except `NaN === NaN` is true.
 * - Objects: recursive key-by-key, key-order independent. `undefined` ≡ missing key (JSON semantics).
 * - Arrays: element-by-element, order-sensitive.
 * - `null` is distinct from `undefined`.
 *
 * @example
 * deepEquals({a:1, b:2}, {b:2, a:1}) // true
 */
export function deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    // NaN === NaN
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;

    // null vs undefined distinction
    if (a === null || b === null) return false;
    if (a === undefined || b === undefined) return false;

    // Arrays: element-by-element, order-sensitive
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEquals(a[i], b[i])) return false;
        }
        return true;
    }
    if (Array.isArray(a) || Array.isArray(b)) return false;

    // Objects: key-order independent, undefined ≡ missing
    if (typeof a === 'object' && typeof b === 'object') {
        const aObj = a as Record<string, unknown>;
        const bObj = b as Record<string, unknown>;

        const aKeys = Object.keys(aObj).filter(k => aObj[k] !== undefined);
        const bKeys = Object.keys(bObj).filter(k => bObj[k] !== undefined);

        if (aKeys.length !== bKeys.length) return false;

        for (const key of aKeys) {
            if (!deepEquals(aObj[key], bObj[key])) return false;
        }
        return true;
    }

    return false;
}
