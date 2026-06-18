import { z } from "zod";
import type { WritePayload } from "../../types.ts";
import { type WhereFilterValidationIssue } from "../../../where-filter/validateWhereFilter.ts";
import matchJavascriptObject from "../../../where-filter/matchJavascriptObject.ts";
import { ValueComparisonRangeOperators } from "../../../where-filter/consts.ts";
import type { WhereFilterDefinition } from "../../../where-filter/types.ts";
import { collectActionWhereIssues } from "../../collectActionWhereIssues.ts";

/**
 * Validate an action's `where` filters BEFORE the action mutates anything, so an invalid filter rejects the
 * action cleanly with zero mutation. Two layers, both required by `writeToItemsArray`'s `invalid_filter`
 * contract:
 *  1. **Static** (`collectActionWhereIssues`, shared with `validateWriteAction` so the engine and a stacking
 *     proxy reject identically) — schema-aware structural validation (unknown field, type mismatch, non-finite,
 *     malformed) across the whole action tree, data-independent.
 *  2. **Runtime throw-safety** (`actionMatchThrows`) — a `$regex`/range operand can make `matchJavascriptObject`
 *     throw on certain rows; a dry-run over the items catches that up-front, so the mutation pass that follows
 *     is throw-free and never commits a partial change.
 *
 * `validate` is the root validator compiled once by the caller (`compileValidateWhereFilter(schema, options)`)
 * and reused across the batch; `options` is threaded to nested levels so the `SerialisableJsonSubset` narrowing
 * applies consistently top-to-bottom.
 *
 * @example
 * const validate = compileValidateWhereFilter(schema, { requireSerialisableJsonSubset: true });
 * const issues = preflightActionWhere(payload, schema, validate, { requireSerialisableJsonSubset: true }, items);
 * if (issues.length) reject(); // e.g. [{ reason: 'unknown_field', path: 'children.ghost' }]
 */
export function preflightActionWhere(
    payload: WritePayload<any>,
    schema: z.ZodType<any, any, any>,
    validate: (filter: WhereFilterDefinition<any>) => WhereFilterValidationIssue[],
    options: { requireSerialisableJsonSubset?: boolean } | undefined,
    items: Record<string, any>[],
): WhereFilterValidationIssue[] {
    const issues = collectActionWhereIssues(payload, schema, validate, options, "");
    if (issues.length > 0) return issues;
    if (whereMightThrow(payload) && actionMatchThrows(payload, items)) {
        return [{ reason: "malformed", message: "Filter operand makes the matcher throw at runtime." }];
    }
    return [];
}

/** Range operators whose operand the matcher feeds to `<`/`>` — a non-number/string operand (or value) makes it throw. */
const RANGE_OPS = ValueComparisonRangeOperators as readonly string[];

/**
 * True when an action's filters contain an operand the matcher can throw on at runtime — a `$regex` (compiled
 * per row) or a range op (`$gt/$lt/$gte/$lte`, which throws on a non-number/string operand or value). These
 * are the matcher's only throw sources for a structurally-valid filter, so this gates the (more expensive)
 * dry-run to the actions that actually need it.
 */
function whereMightThrow(payload: WritePayload<any>): boolean {
    if (payload.type === "create") return false;
    if (filterMightThrow(payload.where)) return true;
    if (payload.type === "pull") {
        const iw = payload.items_where;
        if (iw && typeof iw === "object" && !Array.isArray(iw) && filterMightThrow(iw)) return true;
    }
    return false;
}

/** Recursively scan a filter tree for a `$regex` or range operator (the matcher's runtime throw sources). */
function filterMightThrow(filter: unknown): boolean {
    if (!filter || typeof filter !== "object") return false;
    if (Array.isArray(filter)) return filter.some(filterMightThrow);
    for (const [key, value] of Object.entries(filter as Record<string, unknown>)) {
        if (key === "$regex" || RANGE_OPS.includes(key)) return true;
        if (filterMightThrow(value)) return true;
    }
    return false;
}

/**
 * Dry-run an action's matching against `items` to detect a runtime throw without mutating: the outer `where`
 * over every item, plus (for `pull`) the object `items_where` over the matched items' array elements — exactly
 * the matcher calls the mutation pass will make. An `array_scope`'s nested `where` is checked by that scope's
 * own recursion, so only the outer `where` is dry-run here.
 */
function actionMatchThrows(payload: WritePayload<any>, items: Record<string, any>[]): boolean {
    if (payload.type === "create") return false;
    try {
        for (const item of items) {
            const matched = matchJavascriptObject(item, payload.where);
            if (matched && payload.type === "pull") {
                const arr = (item as Record<string, unknown>)[payload.path as string];
                const itemsWhere = payload.items_where;
                if (Array.isArray(arr) && itemsWhere && typeof itemsWhere === "object" && !Array.isArray(itemsWhere)) {
                    for (const element of arr) {
                        if (element && typeof element === "object") matchJavascriptObject(element as Record<string, any>, itemsWhere as WhereFilterDefinition<any>);
                    }
                }
            }
        }
        return false;
    } catch {
        return true;
    }
}
