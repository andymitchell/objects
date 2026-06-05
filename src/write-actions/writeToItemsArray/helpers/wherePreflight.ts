import { z } from "zod";
import type { WritePayload } from "../../types.ts";
import { compileValidateWhereFilter, type WhereFilterValidationIssue } from "../../../where-filter/validateWhereFilter.ts";
import matchJavascriptObject from "../../../where-filter/matchJavascriptObject.ts";
import { getZodSchemaAtSchemaDotPropPath } from "../../../dot-prop-paths/zod.ts";
import { ValueComparisonRangeOperators } from "../../../where-filter/consts.ts";
import type { WhereFilterDefinition } from "../../../where-filter/types.ts";

/**
 * Validate an action's `where` filters BEFORE the action mutates anything, so an invalid filter rejects the
 * action cleanly with zero mutation. Two layers, both required by `writeToItemsArray`'s `invalid_filter`
 * contract:
 *  1. **Static** (`collectWhereIssues`) — schema-aware structural validation (unknown field, type mismatch,
 *     non-finite, malformed) across the whole action tree, data-independent.
 *  2. **Runtime throw-safety** (`actionMatchThrows`) — a `$regex`/range operand can make `matchJavascriptObject`
 *     throw on certain rows; a dry-run over the items catches that up-front, so the mutation pass that follows
 *     is throw-free and never commits a partial change.
 *
 * @example
 * const issues = preflightActionWhere(payload, schema, compileValidateWhereFilter(schema), items);
 * if (issues.length) reject(); // e.g. [{ reason: 'unknown_field', path: 'children.ghost' }]
 */
export function preflightActionWhere(
    payload: WritePayload<any>,
    schema: z.ZodType<any, any, any>,
    validate: (filter: WhereFilterDefinition<any>) => WhereFilterValidationIssue[],
    items: Record<string, any>[],
): WhereFilterValidationIssue[] {
    const issues = collectWhereIssues(payload, schema, validate, "");
    if (issues.length > 0) return issues;
    if (whereMightThrow(payload) && actionMatchThrows(payload, items)) {
        return [{ reason: "malformed", message: "Filter operand makes the matcher throw at runtime." }];
    }
    return [];
}

/** Range operators whose operand the matcher feeds to `<`/`>` — a non-number/string operand (or value) makes it throw. */
const RANGE_OPS = ValueComparisonRangeOperators as readonly string[];

/** Join a scope/path segment onto a dot-prop prefix (`'' + 'children'` → `'children'`). */
function joinScope(prefix: string, segment: string): string {
    return prefix ? `${prefix}.${segment}` : segment;
}

/** Re-root a validation issue under `prefix` so a nested error reports its full scope-chain path (e.g. `children.ghost`). */
function prefixIssue(issue: WhereFilterValidationIssue, prefix: string): WhereFilterValidationIssue {
    return prefix && issue.path ? { ...issue, path: joinScope(prefix, issue.path) } : issue;
}

/**
 * Collect every static invalid-`where` issue in an action's whole filter tree, against the right schema at
 * each level: the payload's own `where`, an `array_scope`'s nested `action.where` at any depth (validated
 * against the scoped element schema), and a `pull`'s object-form `items_where` (against the array element
 * schema). Pure and data-independent, so it runs once up-front — the only way to catch a nested invalid
 * `where` when the outer `where` matches no items (the per-item recursion never runs then).
 */
function collectWhereIssues(
    payload: WritePayload<any>,
    schema: z.ZodType<any, any, any>,
    validate: (filter: WhereFilterDefinition<any>) => WhereFilterValidationIssue[],
    prefix: string,
): WhereFilterValidationIssue[] {
    const issues: WhereFilterValidationIssue[] = [];

    // Every non-create payload carries `where`; a create has none to validate.
    if (payload.type !== "create") {
        for (const issue of validate(payload.where)) issues.push(prefixIssue(issue, prefix));
    }

    if (payload.type === "array_scope") {
        // Recurse into the nested action against the scoped element schema. An unresolved scope is left to
        // fail at execution (getArrayScopeSchemaAndDDL throws) — skipping here is the conservative path.
        const elementSchema = getZodSchemaAtSchemaDotPropPath(schema, payload.scope);
        if (elementSchema) {
            issues.push(...collectWhereIssues(payload.action as WritePayload<any>, elementSchema, compileValidateWhereFilter(elementSchema), joinScope(prefix, payload.scope)));
        }
    } else if (payload.type === "pull") {
        // Object-form items_where is a per-element WhereFilter (validated against the element schema); a
        // scalar-array value list stays a value list — opaque, exactly as applyPull dispatches on it.
        const itemsWhere = payload.items_where;
        if (!Array.isArray(itemsWhere) && itemsWhere !== null && typeof itemsWhere === "object") {
            const elementSchema = getZodSchemaAtSchemaDotPropPath(schema, payload.path as string);
            if (elementSchema) {
                const elementPrefix = joinScope(prefix, payload.path as string);
                for (const issue of compileValidateWhereFilter(elementSchema)(itemsWhere as WhereFilterDefinition<any>)) {
                    issues.push(prefixIssue(issue, elementPrefix));
                }
            }
        }
    }

    return issues;
}

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
