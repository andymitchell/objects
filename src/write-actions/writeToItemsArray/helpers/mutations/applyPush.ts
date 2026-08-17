import { cloneDeep } from "lodash-es";

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
    // A copy, so a stored element and the action that wrote it lead separate lives: items are edited in place as
    // later writes land on them, and an element installed from the action would let a future write rewrite a
    // document its author may still retry, log or replay. Reading the values rather than transferring them also
    // copies a list composed behind a proxy — an Immer draft, a reactive object — as the plain data it stands for;
    // every value that could not be copied faithfully has already been refused by the payload value gate.
    const clonedItems = cloneDeep(items);
    return { value: [...base, ...clonedItems], changed: true };
}
