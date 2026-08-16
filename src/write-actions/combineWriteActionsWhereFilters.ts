import { isTypeEqual } from "@andyrmitchell/utils";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import type { DDL } from "../ddl/types.ts";
import { resolveDdlListRules } from "../ddl/resolveDdlListRules.ts";
import { isPrimaryKeyValue } from "../utils/getKeyValue.ts";
import type { WriteAction, WriteError, WritePayload } from "./types.ts";

/**
 * Outcome of {@link combineWriteActionsWhereFilters}: either a combined filter, or the errors that
 * prevented one. The success/errors shape mirrors the `where-filter/sql` prepared-clause result that this
 * filter typically feeds.
 */
export type CombineWriteActionsWhereFiltersResult<T extends Record<string, any> = any> =
    | { success: true; filter: WhereFilterDefinition<T> | undefined }
    | { success: false; errors: WriteError[] };

/**
 * Builds a single `WhereFilterDefinition` that matches every existing row a batch of write actions could
 * read or change.
 *
 * Given a batch of `WriteAction`s, returns one filter describing the union of each action's target rows — the
 * set of rows any of those writes might touch. A caller that must see current state before applying the batch
 * (read-modify-write) uses this to select exactly those rows up front instead of scanning the whole collection.
 *
 * It is purely constructive: it assembles filters from each action's own `where` (and, for `create`s, a
 * primary-key-equality term) and unions them. It never interprets or rewrites the operators inside a `where` —
 * `$in`, `$gt`, `$nor`, `$not`, `$exists`, `$regex`, … all pass through untouched.
 *
 * @param ddl - The collection's DDL. Used only to resolve primary keys (for `create` collision terms, including
 *   creates nested inside `array_scope`s).
 * @param writeActions - The batch. Each action's `where` is treated as opaque and is not validated here.
 * @param includeRowDeletes - When `true` (the default), a top-level `delete` contributes its `where`. When
 *   `false`, a top-level `delete` contributes nothing — a whole-row deletion needs no prior row state, so a
 *   consumer handling deletions out-of-band need not pre-read those rows. A `delete` nested inside an
 *   `array_scope` still contributes regardless: removing an array element modifies the parent row, which a
 *   read-modify-write consumer must pre-read (the same reason `pull` always contributes).
 * @returns On success, `{ success: true, filter }` where `filter` is the combined `WhereFilterDefinition`, or
 *   `undefined` when the batch constrains nothing (see remarks). On failure, `{ success: false, errors }` carrying
 *   the `WriteError`s that prevented a filter (today only a `create` with an absent primary key →
 *   `{ type: 'missing_key', primary_key }`).
 *
 * @example
 * // a create + a conditional update →
 * combineWriteActionsWhereFilters(ddl, [createR1, updateDrafts]);
 * // { success: true, filter: { $or: [ { id: '1' }, { status: { $in: ['draft', 'review'] } } ] } }
 *
 * @remarks
 * **Completeness.** The returned filter matches a *superset* of the rows any action touches. Under-selection would
 * feed a read-modify-write caller stale input, so it is a correctness bug; over-selection is only a perf cost. Every
 * write-payload variant must contribute: a variant with no arm here is a compile error, so a payload can never
 * silently contribute nothing.
 *
 * **Combining.** Distinct terms are `$or`-unioned and de-duplicated; a single distinct term is returned bare (no
 * enclosing `$or`). A match-all `where` (`{}`) makes the whole result `undefined`, and match-all terms are never
 * emitted inside a compound — so the output always compiles to well-formed SQL.
 *
 * **No constraint → `filter: undefined`** means *matches every row*, not none — an empty batch, a batch of only
 * top-level deletes under `includeRowDeletes: false`, or any batch containing a match-all action.
 *
 * **Creates** contribute `{ [primary_key]: value }` (which is what lets a store detect an already-existing or
 * soft-deleted row a create would collide with or revive); an absent primary key yields a `missing_key` error, and
 * any error fails the whole batch (a partial filter would risk under-selection). Every error is collected, not just
 * the first.
 *
 * **Array scopes** with a mutating sub-action contribute `{ $and: [ <outer where>, { <scope>: { $elemMatch:
 * <sub-action filter> } } ] }` (the sub-filter derived recursively). An array scope whose sub-action is a `create`
 * contributes the outer `where` alone, because the create appends to every matching row regardless of the array's
 * current contents.
 *
 * ### Typical consumer
 * A SQL-backed store uses this to pre-read only the rows a write batch could affect instead of scanning the whole
 * table: it compiles the returned `WhereFilterDefinition` into a `WHERE` clause (this repo's `where-filter/sql`
 * compiler does exactly that for Postgres and SQLite), `SELECT`s those rows, runs the write-action merge in memory,
 * and writes back — all in one transaction. The `create` arms surface as primary-key-equality terms, which is what
 * lets such a store also detect an already-existing or soft-deleted row a create would collide with or revive. The
 * function itself knows nothing about SQL or any store — it only returns a filter.
 */
export function combineWriteActionsWhereFilters<T extends Record<string, any>>(
    ddl: DDL<T>,
    writeActions: WriteAction<T>[],
    includeRowDeletes: boolean = true,
): CombineWriteActionsWhereFiltersResult<T> {
    const errors: WriteError[] = [];
    const terms: WhereFilterDefinition[] = [];
    let sawMatchAll = false;

    for (const action of writeActions) {
        // The walker reads only the spec-relevant subset of each payload; bridge the library's deep
        // `WritePayload` (partly `unknown` for a nested-array T) to the flat `ScopedPayload` shape.
        const outcome = deriveActionFilter(action.payload as ScopedPayload, ddl, "", includeRowDeletes);
        if (outcome.kind === "error") { errors.push(outcome.error); continue; }
        if (outcome.kind === "skip") continue;
        if (isMatchAll(outcome.filter)) { sawMatchAll = true; continue; }
        terms.push(outcome.filter);
    }

    // Any error fails the whole batch — a partial filter would silently under-select. Errors win over match-all.
    if (errors.length) return { success: false, errors };
    // A match-all action touches every row, so the superset is everything — the only SQL-safe form is no filter.
    if (sawMatchAll) return { success: true, filter: undefined };

    const distinct = dedupe(terms);
    const filter: WhereFilterDefinition | undefined =
        distinct.length === 0 ? undefined :
        distinct.length === 1 ? distinct[0] :
        { $or: distinct };
    // The terms are built from this batch's own `where`s and PK values, so they are valid `<T>` filters.
    return { success: true, filter: filter as WhereFilterDefinition<T> | undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The flat structural view of a payload this function actually reads (discriminant + the few relevant fields).
 * Decoupled from the library's `WritePayload`, whose deep `array_scope.action` recursion partially resolves to
 * `unknown` for a nested-array `T` and so cannot be walked directly.
 */
type ScopedPayload =
    | { type: "create"; data: Record<string, any> }
    | { type: "update"; where: WhereFilterDefinition }
    | { type: "add_to_set"; where: WhereFilterDefinition }
    | { type: "push"; where: WhereFilterDefinition }
    | { type: "pull"; where: WhereFilterDefinition }
    | { type: "inc"; where: WhereFilterDefinition }
    | { type: "set_property_undefined"; where: WhereFilterDefinition }
    | { type: "delete_property"; where: WhereFilterDefinition }
    | { type: "delete"; where: WhereFilterDefinition }
    | { type: "array_scope"; scope: string; where: WhereFilterDefinition; action: ScopedPayload };

// Compile-time bridge: because payloads reach the walker through an `as ScopedPayload` cast, a `WritePayload`
// variant with no arm here would slip past the switch's `never` check and only surface as a runtime
// `assertNever` throw. Pinning the discriminants against each other turns that into a compile error.
isTypeEqual<Exclude<WritePayload<any>["type"], ScopedPayload["type"]>, never>(true);

type DeriveResult =
    | { kind: "filter"; filter: WhereFilterDefinition }
    | { kind: "skip" }
    | { kind: "error"; error: WriteError };

/**
 * The read-set contribution of one payload, in the coordinates of its own list scope. `accScope` accumulates the
 * dotted path from the root ("" at the root) purely so a nested `create` can resolve its list's primary key; all
 * `$elemMatch` wrapping is done by the `array_scope` branch using the local `scope`.
 *
 * `includeDelete` gates whether a `delete` at THIS level contributes: the top-level call threads the public
 * `includeRowDeletes`, while the `array_scope` branch forces it open, because a nested delete is an element-removal
 * that modifies its parent row (not a row deletion) and so must always be pre-read.
 */
function deriveActionFilter<T extends Record<string, any>>(payload: ScopedPayload, ddl: DDL<T>, accScope: string, includeDelete: boolean): DeriveResult {
    switch (payload.type) {
        case "create": {
            const listRules = resolveDdlListRules(ddl, accScope);
            if (!listRules) return { kind: "error", error: { type: "custom", message: `No DDL list rules for scope "${accScope}"` } };
            const pk = listRules.primary_key;
            const raw = payload.data[pk];
            if (!isPrimaryKeyValue(raw)) return { kind: "error", error: { type: "missing_key", primary_key: pk } };
            return { kind: "filter", filter: { [pk]: raw } };
        }
        case "update":
        case "add_to_set":
        case "push":
        case "pull":
        case "inc":
        case "set_property_undefined":
        case "delete_property":
            return { kind: "filter", filter: payload.where };
        case "delete":
            return includeDelete ? { kind: "filter", filter: payload.where } : { kind: "skip" };
        case "array_scope": {
            const childScope = accScope ? `${accScope}.${payload.scope}` : payload.scope;
            // A delete nested in a scope is an element-removal — a modification of the parent row, not a row
            // deletion — so it always contributes (like `pull`); only a TOP-LEVEL delete is gated by the flag.
            const sub = deriveActionFilter(payload.action, ddl, childScope, true);
            if (sub.kind === "error") return sub;
            // Unreachable now (a nested delete is forced to contribute) but kept so TS narrows `sub` to a filter.
            if (sub.kind === "skip") return { kind: "skip" };
            // A scoped create appends to every parent the outer `where` selects, regardless of the array's contents.
            if (payload.action.type === "create") return { kind: "filter", filter: payload.where };
            // A match-all sub-filter would wrap to `{ scope: { $elemMatch: {} } }` (SQL-hostile) — the outer `where`
            // already selects a sound superset of those parents.
            if (isMatchAll(sub.filter)) return { kind: "filter", filter: payload.where };
            return { kind: "filter", filter: andNormalized(payload.where, wrapElemMatch(payload.scope, sub.filter)) };
        }
        default:
            return assertNever(payload);
    }
}

/** A match-all filter: a plain object with no keys (`{}`), i.e. a `where` that constrains nothing. */
function isMatchAll(filter: WhereFilterDefinition): boolean {
    return !!filter && typeof filter === "object" && !Array.isArray(filter) && Object.keys(filter).length === 0;
}

/** `{ [scope]: { $elemMatch: sub } }` — the one computed-key construction; a plain object key, never match-all. */
function wrapElemMatch(scope: string, sub: WhereFilterDefinition): WhereFilterDefinition {
    return { [scope]: { $elemMatch: sub } };
}

/** `$and` two filters, dropping any match-all term so `{}` never appears inside a compound. */
function andNormalized(a: WhereFilterDefinition, b: WhereFilterDefinition): WhereFilterDefinition {
    const parts = [a, b].filter((p) => !isMatchAll(p));
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0]!;
    return { $and: parts };
}

/** De-duplicate structurally-identical filters (missed dedup would only over-include, never under-select). */
function dedupe(filters: WhereFilterDefinition[]): WhereFilterDefinition[] {
    const seen = new Set<string>();
    const out: WhereFilterDefinition[] = [];
    for (const f of filters) {
        const key = JSON.stringify(f);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
    }
    return out;
}

function assertNever(x: never): never {
    throw new Error(`Unhandled write payload type: ${JSON.stringify(x)}`);
}
