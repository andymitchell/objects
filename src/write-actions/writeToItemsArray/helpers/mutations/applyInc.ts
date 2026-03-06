import type { WriteError } from "../../../types.ts";

type IncResult = { value: number; changed: boolean } | { error: WriteError };

/**
 * Apply an inc mutation: add amount to a number field.
 * Missing fields initialise to 0. Null/non-number/NaN fields produce errors.
 *
 * @example
 * applyInc(item, 'count', 5) // { value: currentCount + 5, changed: true }
 */
export function applyInc<T extends Record<string, any>>(
    item: T,
    path: string,
    amount: number,
): IncResult {
    if (Number.isNaN(amount)) {
        return { error: { type: 'custom', message: `Cannot inc with NaN amount on field '${path}'` } };
    }

    const current = item[path];

    if (current === null) {
        return { error: { type: 'custom', message: `Cannot inc null field '${path}'` } };
    }
    if (current !== undefined && typeof current !== 'number') {
        return { error: { type: 'custom', message: `Cannot inc non-number field '${path}'` } };
    }
    if (typeof current === 'number' && Number.isNaN(current)) {
        return { error: { type: 'custom', message: `Cannot inc NaN field '${path}'` } };
    }

    if (amount === 0) {
        return { value: current ?? 0, changed: false };
    }

    const base = current ?? 0;
    return { value: base + amount, changed: true };
}
