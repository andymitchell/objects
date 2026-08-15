import type { ZodType } from "zod";
import type { WritePayload } from "./types.ts";
import {
    compileValidateWhereFilter,
    type WhereFilterValidationIssue,
} from "../where-filter/validateWhereFilter.ts";
import { getZodSchemaAtSchemaDotPropPath } from "../dot-prop-paths/schema-tree.ts";
import { joinDotpropPath } from "../dot-prop-paths/joinDotpropPath.ts";
import { findNonJsonValues, type NonJsonValueIssue } from "../utils/findNonJsonValues.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import { resolveArrayScope, type ArrayScopeRejectionReason } from "./arrayScopeResolution.ts";
import { resolvePropertyPathTarget, type PropertyPathRejectionReason } from "./propertyPathResolution.ts";

/**
 * A static fault found in an action's filter/target tree, discriminated by `kind`: a `where`-clause fault
 * (carrying the `WhereFilterValidationIssue` fields), an unwritable `array_scope.scope`, or an unwritable
 * `set_property_undefined`/`delete_property` `path`. Callers map these onto the `invalid_filter` /
 * `invalid_scope` / `invalid_property_path` `WriteError` variants respectively.
 */
export type ActionValidationIssue =
    | ({ kind: "where" } & WhereFilterValidationIssue)
    | { kind: "scope"; scope: string; reason: ArrayScopeRejectionReason }
    | { kind: "property_path"; path: string; reason: PropertyPathRejectionReason };

/**
 * Collect every static invalid-`where`, invalid-scope and unwritable-property-path issue across an action's
 * WHOLE filter tree, against the right schema at each level: the payload's own `where`, an `array_scope`'s scope
 * and nested `action.where` at any depth (validated against the scoped element schema), a `pull`'s object-form
 * `items_where` (against the array element schema), and a `set_property_undefined`/`delete_property` `path`.
 * Pure and data-independent, so it runs once up-front — the only way to catch a nested invalid `where` when the
 * outer `where` matches no items (the per-item recursion never runs then).
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
 * // e.g. [{ kind: 'scope', scope: 'children.nope', reason: 'unknown_path' },
 * //       { kind: 'where', reason: 'malformed', path: 'children.$ne', message: "Non-JSON operand ..." },
 * //       { kind: 'property_path', path: 'children.cid', reason: 'not_optional' }]
 */
export function collectActionWhereIssues(
    payload: WritePayload<any>,
    schema: ZodType<any> | undefined,
    validate: (filter: WhereFilterDefinition<any>) => WhereFilterValidationIssue[],
    options: { requireSerialisableJsonSubset?: boolean } | undefined,
    prefix = "",
): ActionValidationIssue[] {
    const issues: ActionValidationIssue[] = [];

    // Every non-create payload carries `where`; a create has none to validate.
    if (payload.type !== "create") {
        for (const issue of validate(payload.where)) issues.push({ kind: "where", ...prefixIssue(issue, prefix) });
    }

    if (payload.type === "array_scope") {
        const scopePath = joinDotpropPath(prefix, payload.scope);
        // Judge the scope itself ahead of anything beneath it: an unwritable scope is its own fault class
        // (it names the write TARGET, not a match condition), so it is reported before this level's nested
        // `where` issues.
        const resolution = schema ? resolveArrayScope(schema, payload.scope) : undefined;
        if (resolution && !resolution.ok) {
            issues.push({ kind: "scope", scope: scopePath, reason: resolution.reason });
        }
        // Recurse into the nested action against the scoped element schema. An unwritable scope falls back to a
        // subset-only validator so a non-JSON nested operand is still caught (schema-aware checks need a schema;
        // the SerialisableJsonSubset walk does not). The recursion keeps descending either way.
        const elementSchema = resolution?.ok ? resolution.elementSchema : undefined;
        issues.push(...collectActionWhereIssues(
            payload.action as WritePayload<any>,
            elementSchema,
            compileValidateWhereFilter(elementSchema, options),
            options,
            scopePath,
        ));
    } else if (payload.type === "pull") {
        for (const issue of validatePullItemsWhere(payload.items_where, schema, payload.path as string, options, prefix)) {
            issues.push({ kind: "where", ...issue });
        }
    } else if (payload.type === "set_property_undefined" || payload.type === "delete_property") {
        // The `path` names the write TARGET, judged against the schema at THIS level — so a path nested in an
        // `array_scope` is held to the element schema, exactly as a nested `where` is. A path the schema can never
        // clear or remove is a permanent fault, so it is caught here rather than discovered per matched item.
        if (schema) {
            const resolution = resolvePropertyPathTarget(schema, payload.path as string, payload.type);
            if (!resolution.ok) {
                issues.push({ kind: "property_path", path: joinDotpropPath(prefix, payload.path as string), reason: resolution.reason });
            }
        }
    }

    return issues;
}

/**
 * Validate a `pull`'s `items_where`, the one slot that takes two shapes (mirroring how `applyPull` dispatches):
 * an OBJECT-form per-element `WhereFilter` (validated against the array element schema), or a SCALAR value-list
 * ($pullAll-style) whose members are literal match targets. The members are NOT `where` operands, so the filter
 * walk never sees them — yet they ride the JSON-roundtripped idempotency ledger like any operand, so hold each to
 * the `SerialisableJsonSubset` (under the flag) via the shared value walk (`findNonJsonValues`), the same primitive
 * the write-payload value-gate uses. Both shapes are the caller's one filter slot, so both surface as
 * `invalid_filter` — a scalar fault at `items_where.<i>`.
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
        // Scalar value-list: members are match targets held to the JSON-roundtrip subset only under the flag, like
        // the rest of the tree. `flagUndefined` is on — an `undefined` member drops to null and silently shifts the
        // removal set, so it must be rejected. The walk roots at the `items_where` base path, so each fault reports
        // its full `items_where.<i>` location directly.
        if (options?.requireSerialisableJsonSubset) {
            const base = joinDotpropPath(prefix, "items_where");
            const nonJson: NonJsonValueIssue[] = [];
            findNonJsonValues(itemsWhere, base, nonJson, { flagUndefined: true });
            for (const { reason, path } of nonJson) {
                const at = path ? ` at '${path}'` : "";
                issues.push({
                    reason,
                    path,
                    message: reason === "non_finite"
                        ? `Non-finite value${at} cannot losslessly round-trip JSON.`
                        : `Non-JSON value${at} cannot losslessly round-trip JSON.`,
                });
            }
        }
    } else if (itemsWhere !== null && typeof itemsWhere === "object") {
        // Object-form: a per-element WhereFilter validated against the array element schema.
        const elementSchema = schema ? getZodSchemaAtSchemaDotPropPath(schema, fieldPath) : undefined;
        const elementPrefix = joinDotpropPath(prefix, fieldPath);
        for (const issue of compileValidateWhereFilter(elementSchema, options)(itemsWhere as WhereFilterDefinition<any>)) {
            issues.push(prefixIssue(issue, elementPrefix));
        }
    }
    return issues;
}

/** Re-root a validation issue under `prefix` so a nested error reports its full scope-chain path (e.g. `children.ghost`). */
function prefixIssue(issue: WhereFilterValidationIssue, prefix: string): WhereFilterValidationIssue {
    return prefix && issue.path ? { ...issue, path: joinDotpropPath(prefix, issue.path) } : issue;
}
