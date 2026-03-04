import type { WriteError } from "../../../types.ts";

type PushResult = { value: unknown[]; changed: boolean } | { error: WriteError };

/**
 * Apply a push mutation: append items to an array field.
 *
 * @example
 * applyPush(item, 'tags', ['new']) // { value: [...existing, 'new'], changed: true }
 */
export function applyPush<T extends Record<string, any>>(
    item: T,
    path: string,
    items: unknown[],
): PushResult {
    const existing = item[path];

    if (existing === null) {
        return { error: { type: 'custom', message: `Cannot push to null field '${path}'` } };
    }
    if (existing !== undefined && !Array.isArray(existing)) {
        return { error: { type: 'custom', message: `Cannot push to non-array field '${path}'` } };
    }

    if (items.length === 0) {
        return { value: existing ?? [], changed: false };
    }

    const base: unknown[] = existing ?? [];
    const clonedItems = structuredClone(items);
    return { value: [...base, ...clonedItems], changed: true };
}
