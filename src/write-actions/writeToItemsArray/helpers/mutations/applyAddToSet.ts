import type { WriteError } from "../../../types.ts";
import type { DDL, ListRules } from "../../types.ts";
import { deepEquals } from "./deepEquals.ts";
import { resolveDdlListRules } from "./resolveDdlListRules.ts";

type AddToSetResult = { value: unknown[]; changed: boolean } | { error: WriteError };

/**
 * Apply an addToSet mutation: append items that don't already exist in the array.
 * Supports 'deep_equals' (structural equality) and 'pk' (primary key) uniqueness modes.
 *
 * @example
 * applyAddToSet(item, 'tags', ['a', 'b'], 'deep_equals', ddl) // deduplicates by value
 */
export function applyAddToSet<T extends Record<string, any>>(
    item: T,
    path: string,
    items: unknown[],
    uniqueBy: 'deep_equals' | 'pk',
    ddl: DDL<T>,
): AddToSetResult {
    const existing = item[path];

    if (existing === null) {
        return { error: { type: 'custom', message: `Cannot addToSet on null field '${path}'` } };
    }
    if (existing !== undefined && !Array.isArray(existing)) {
        return { error: { type: 'custom', message: `Cannot addToSet on non-array field '${path}'` } };
    }

    if (items.length === 0) {
        return { value: existing ?? [], changed: false };
    }

    const base: unknown[] = existing ?? [];

    if (uniqueBy === 'pk') {
        return addToSetByPk(base, items, path, ddl);
    } else {
        return addToSetByDeepEquals(base, items);
    }
}

function addToSetByDeepEquals(base: unknown[], items: unknown[]): AddToSetResult {
    // First deduplicate the incoming items themselves
    const deduped: unknown[] = [];
    for (const item of items) {
        if (!deduped.some(d => deepEquals(d, item))) {
            deduped.push(item);
        }
    }

    // Then filter out items already in base
    const newItems: unknown[] = [];
    for (const item of deduped) {
        if (!base.some(existing => deepEquals(existing, item))) {
            newItems.push(structuredClone(item));
        }
    }

    if (newItems.length === 0) {
        return { value: base, changed: false };
    }
    return { value: [...base, ...newItems], changed: true };
}

function addToSetByPk<T extends Record<string, any>>(
    base: unknown[],
    items: unknown[],
    path: string,
    ddl: DDL<T>,
): AddToSetResult {
    const listRules: ListRules<any> | undefined = resolveDdlListRules(ddl, path);
    if (!listRules) {
        return { error: { type: 'custom', message: `Cannot resolve DDL list rules for path '${path}' — required for pk uniqueness` } };
    }

    const pkField = listRules.primary_key as string;

    // Validate that items are objects (pk mode requires object arrays)
    for (const item of items) {
        if (typeof item !== 'object' || item === null) {
            return { error: { type: 'custom', message: `'pk' uniqueness requires object arrays, but got scalar at path '${path}'` } };
        }
        if (!(pkField in item)) {
            return { error: { type: 'custom', message: `Item missing primary key field '${pkField}' for addToSet at path '${path}'` } };
        }
    }

    // Build set of existing PKs
    const existingPks = new Set<unknown>();
    for (const el of base) {
        if (typeof el === 'object' && el !== null && pkField in el) {
            existingPks.add((el as Record<string, unknown>)[pkField]);
        }
    }

    // Deduplicate incoming items by PK, then filter against existing
    const seenPks = new Set<unknown>(existingPks);
    const newItems: unknown[] = [];
    for (const item of items) {
        const pkValue = (item as Record<string, unknown>)[pkField];
        if (!seenPks.has(pkValue)) {
            seenPks.add(pkValue);
            newItems.push(structuredClone(item));
        }
    }

    if (newItems.length === 0) {
        return { value: base, changed: false };
    }
    return { value: [...base, ...newItems], changed: true };
}
