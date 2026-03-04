import { WhereFilter } from "../../../../where-filter/index-old.ts";
import type { WhereFilterDefinition } from "../../../../where-filter/types.ts";
import type { WriteError } from "../../../types.ts";
import { deepEquals } from "./deepEquals.ts";

type PullResult = { value: unknown[]; changed: boolean } | { error: WriteError };

/**
 * Apply a pull mutation: remove matching elements from an array field.
 * Object arrays use WhereFilterDefinition matching. Scalar arrays use value list matching.
 *
 * @example
 * applyPull(item, 'tags', ['old']) // removes 'old' from tags
 */
export function applyPull<T extends Record<string, any>>(
    item: T,
    path: string,
    itemsWhere: WhereFilterDefinition<any> | unknown[],
): PullResult {
    const existing = item[path];

    if (existing === undefined) {
        return { value: [], changed: false };
    }
    if (existing === null) {
        return { error: { type: 'custom', message: `Cannot pull from null field '${path}'` } };
    }
    if (!Array.isArray(existing)) {
        return { error: { type: 'custom', message: `Cannot pull from non-array field '${path}'` } };
    }
    if (existing.length === 0) {
        return { value: [], changed: false };
    }

    let filtered: unknown[];

    if (Array.isArray(itemsWhere)) {
        // Scalar mode: remove elements matching any value in the list
        filtered = existing.filter(el => !itemsWhere.some(target => deepEquals(el, target)));
    } else {
        // Object mode: remove elements matching the WhereFilter
        filtered = existing.filter(el => {
            if (typeof el === 'object' && el !== null) {
                return !WhereFilter.matchJavascriptObject(el, itemsWhere);
            }
            return true;
        });
    }

    const changed = filtered.length !== existing.length;
    return { value: filtered, changed };
}
