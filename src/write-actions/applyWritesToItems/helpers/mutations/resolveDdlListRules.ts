import type { DDL, ListRules } from "../../types.ts";

/**
 * Resolve DDL list rules for a given array property path.
 * Handles both root-level paths ('sub_items') and scope-rewritten paths ('.items').
 *
 * @example
 * resolveDdlListRules(ddl, 'sub_items') // ListRules or undefined
 */
export function resolveDdlListRules<T extends Record<string, any>>(ddl: DDL<T>, path: string): ListRules<any> | undefined {
    return (ddl.lists as Record<string, ListRules<any>>)[path]
        ?? (ddl.lists as Record<string, ListRules<any>>)['.' + path];
}
