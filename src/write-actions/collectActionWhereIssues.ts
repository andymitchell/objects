import type { ZodType } from "zod";
import type { WritePayload } from "./types.ts";
import {
    compileValidateWhereFilter,
    collectNonSerialisableWhereIssues,
    type WhereFilterValidationIssue,
} from "../where-filter/validateWhereFilter.ts";
import { getZodSchemaAtSchemaDotPropPath } from "../dot-prop-paths/schema-tree.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";

/**
 * Collect every static invalid-`where` issue across an action's WHOLE filter tree, against the right schema at
 * each level: the payload's own `where`, an `array_scope`'s nested `action.where` at any depth (validated
 * against the scoped element schema), and a `pull`'s object-form `items_where` (against the array element
 * schema). Pure and data-independent, so it runs once up-front — the only way to catch a nested invalid `where`
 * when the outer `where` matches no items (the per-item recursion never runs then).
 *
 * Single-sourced: BOTH the write engine's preflight (`preflightActionWhere`, which adds a runtime throw-safety
 * dry-run on top) and a store's up-front gate (`validateWriteAction`) call this, so the engine and a stacking
 * proxy reject identically. The caller's `options` is threaded to every nested level (not hardcoded), so the
 * `SerialisableJsonSubset` narrowing is engaged consistently top-to-bottom — essential for a store whose
 * idempotency ledger records the whole `payload` (incl. nested `where`s) in JSON-roundtripped form: an
 * un-round-trippable nested operand the gate missed would throw when that ledger clones the replay.
 *
 * `validate` is the pre-compiled validator for THIS level — the caller compiles the (expensive) root once and
 * reuses it; nested element schemas are compiled here as the recursion descends. When a nested element schema
 * cannot be resolved, the schema-independent `SerialisableJsonSubset` walk still runs (under the flag), so a
 * non-JSON operand is caught even where schema-aware checks cannot apply.
 *
 * @example
 * const validate = compileValidateWhereFilter(schema, options);
 * const issues = collectActionWhereIssues(payload, schema, validate, options);
 * // e.g. [{ reason: 'malformed', path: 'children.$ne', message: "Non-JSON operand on 'children.$ne' ..." }]
 */
export function collectActionWhereIssues(
    payload: WritePayload<any>,
    schema: ZodType<any> | undefined,
    validate: (filter: WhereFilterDefinition<any>) => WhereFilterValidationIssue[],
    options: { requireSerialisableJsonSubset?: boolean } | undefined,
    prefix = "",
): WhereFilterValidationIssue[] {
    const issues: WhereFilterValidationIssue[] = [];

    // Every non-create payload carries `where`; a create has none to validate.
    if (payload.type !== "create") {
        for (const issue of validate(payload.where)) issues.push(prefixIssue(issue, prefix));
    }

    if (payload.type === "array_scope") {
        // Recurse into the nested action against the scoped element schema. An unresolved scope falls back to a
        // subset-only validator so a non-JSON nested operand is still caught (schema-aware checks need a schema;
        // the SerialisableJsonSubset walk does not). The recursion keeps descending either way.
        const elementSchema = schema ? getZodSchemaAtSchemaDotPropPath(schema, payload.scope) : undefined;
        issues.push(...collectActionWhereIssues(
            payload.action as WritePayload<any>,
            elementSchema,
            validatorFor(elementSchema, options),
            options,
            joinScope(prefix, payload.scope),
        ));
    } else if (payload.type === "pull") {
        issues.push(...validatePullItemsWhere(payload.items_where, schema, payload.path as string, options, prefix));
    }

    return issues;
}

/**
 * Validate a `pull`'s `items_where`, the one slot that takes two shapes (mirroring how `applyPull` dispatches):
 * an OBJECT-form per-element `WhereFilter` (validated against the array element schema), or a SCALAR value-list
 * ($pullAll-style) whose members are literal match targets. The members are NOT `where` operands, so the filter
 * walk never sees them — yet they ride the JSON-roundtripped idempotency ledger like any operand, so hold each to
 * the `SerialisableJsonSubset` (under the flag), reusing the shared operand walk. Both shapes are the caller's one
 * filter slot, so both surface as `invalid_filter` — a scalar fault at `items_where.<i>`.
 */
function validatePullItemsWhere(
    itemsWhere: unknown,
    schema: ZodType<any> | undefined,
    fieldPath: string,
    options: { requireSerialisableJsonSubset?: boolean } | undefined,
    prefix: string,
): WhereFilterValidationIssue[] {
    const issues: WhereFilterValidationIssue[] = [];
    if (Array.isArray(itemsWhere)) {
        // Scalar value-list: members are match targets, held to the JSON-roundtrip subset (incl. undefined, which
        // drops to null and silently shifts the removal set) — only under the flag, like the rest of the tree.
        if (options?.requireSerialisableJsonSubset) {
            const itemsPrefix = joinScope(prefix, "items_where");
            for (const issue of collectNonSerialisableWhereIssues(itemsWhere)) {
                issues.push(prefixIssue(issue, itemsPrefix));
            }
        }
    } else if (itemsWhere !== null && typeof itemsWhere === "object") {
        // Object-form: a per-element WhereFilter validated against the array element schema.
        const elementSchema = schema ? getZodSchemaAtSchemaDotPropPath(schema, fieldPath) : undefined;
        const elementPrefix = joinScope(prefix, fieldPath);
        for (const issue of validatorFor(elementSchema, options)(itemsWhere as WhereFilterDefinition<any>)) {
            issues.push(prefixIssue(issue, elementPrefix));
        }
    }
    return issues;
}

/** A validator for a nested level: schema-aware when the element schema resolved, else the schema-independent subset-only walk (a no-op without the flag). */
function validatorFor(
    schema: ZodType<any> | undefined,
    options: { requireSerialisableJsonSubset?: boolean } | undefined,
): (filter: WhereFilterDefinition<any>) => WhereFilterValidationIssue[] {
    if (schema) return compileValidateWhereFilter(schema, options);
    return (filter) => (options?.requireSerialisableJsonSubset ? collectNonSerialisableWhereIssues(filter) : []);
}

/** Join a scope/path segment onto a dot-prop prefix (`'' + 'children'` → `'children'`). */
function joinScope(prefix: string, segment: string): string {
    return prefix ? `${prefix}.${segment}` : segment;
}

/** Re-root a validation issue under `prefix` so a nested error reports its full scope-chain path (e.g. `children.ghost`). */
function prefixIssue(issue: WhereFilterValidationIssue, prefix: string): WhereFilterValidationIssue {
    return prefix && issue.path ? { ...issue, path: joinScope(prefix, issue.path) } : issue;
}
