import { z } from "zod";
import matchJavascriptObject from "../where-filter/matchJavascriptObject.ts";
import { assertWriteArrayScope } from "./helpers.ts";
import type { DDL } from "../ddl/types.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import type { WriteAction, WritePayload } from "./types.ts";

/**
 * Test harness for `combineWriteActionsWhereFilters`: fixtures, a seeded PRNG, a curated action pool,
 * and an INDEPENDENT oracle. Nothing here imports the function under test — the oracle is derived purely
 * from the spec's semantics (via `matchJavascriptObject`), so it can act as an unbiased arbiter of which
 * rows a write batch could touch.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * String-primary-key fixture with two levels of nested arrays. `score` (a root number) exists so `inc`
 * has a valid target and range operators have a numeric field to bite on.
 */
export const ObjSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    score: z.number(),
    children: z.array(
        z.object({
            cid: z.string(),
            age: z.number(),
            children: z.array(z.object({ ccid: z.string() }).strict()),
        }).strict(),
    ).optional(),
}).strict();
export type Obj = z.infer<typeof ObjSchema>;
export type Child = NonNullable<Obj["children"]>[number];
export type GrandChild = Child["children"][number];

export const ddl: DDL<Obj> = {
    version: 1,
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        "children": { primary_key: "cid" },
        "children.children": { primary_key: "ccid" },
    },
};

/** Numeric-primary-key fixture — exercises the falsy `0` PK branch without any type-defeating casts. */
export const NumObjSchema = z.object({ id: z.number(), label: z.string().optional() }).strict();
export type NumObj = z.infer<typeof NumObjSchema>;
export const numDdl: DDL<NumObj> = {
    version: 1,
    lists: { ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } } },
};

/**
 * Canonical dataset. Ids/cids/ccids are all distinct so membership is unambiguous. Deliberate shapes:
 * `r3` has an EMPTY children array (the Finding-1 scoped-create witness); `r5` omits `text` and `children`
 * entirely (an `$exists`/nullish witness). `score` rises r1→r5 so range operators partition cleanly.
 */
export const DS: Obj[] = [
    { id: "r1", text: "x", score: 10, children: [
        { cid: "a1", age: 5, children: [{ ccid: "g1" }] },
        { cid: "a2", age: 2, children: [] },
    ] },
    { id: "r2", text: "x", score: 20, children: [{ cid: "b1", age: 5, children: [] }] },
    { id: "r3", text: "y", score: 30, children: [] },
    { id: "r4", text: "z", score: 40, children: [{ cid: "d1", age: 9, children: [{ ccid: "g9" }] }] },
    { id: "r5", score: 50 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Seeded PRNG (deterministic — no Math.random, no Date)
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32 — a tiny deterministic PRNG. Same seed → same stream, so property runs are reproducible. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export const SEEDS = [1, 2, 42, 1337, 99991] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Action builder + curated pool
// ─────────────────────────────────────────────────────────────────────────────

let _n = 0;
/** Wrap a payload as a `WriteAction`, varying `ts`/`uuid` each call to prove they never affect the result. */
export function wa(payload: WritePayload<Obj>): WriteAction<Obj> {
    _n += 1;
    return { type: "write", ts: _n, uuid: `u${_n}`, payload };
}

/**
 * The 8 payload discriminants, spelled literally: `WritePayload<Obj>["type"]` collapses to `unknown` for
 * a nested-array `T` (the recursive `array_scope.action` hits TS's instantiation cap). The 8-arm canary in
 * the test file pins this list to the real union via a shallow single-array type where it resolves cleanly.
 */
export type Arm = "create" | "update" | "delete" | "array_scope" | "add_to_set" | "push" | "pull" | "inc";
export const ALL_ARMS: readonly Arm[] = ["create", "update", "delete", "array_scope", "add_to_set", "push", "pull", "inc"];

/** A pool member: an action plus static metadata the property loops use for sampling and coverage checks. */
export type PoolEntry = {
    arm: Arm;
    /** No `array_scope` anywhere in the action — eligible for the Front-B exact-precision property. */
    flat: boolean;
    /** The action's (root-level) `where` is a match-all `{}` — excluded from Front-B's selective pool. */
    matchAll?: boolean;
    action: WriteAction<Obj>;
};

/**
 * A deliberately adversarial cross-section: every arm at least once, selective + match-all + operator
 * `where`s, and scoped actions at one and two levels including the Finding-1 (scoped create) and
 * Finding-2 (scoped match-all inner `where`) witnesses.
 */
export const POOL: PoolEntry[] = [
    // ── flat ──
    { arm: "create", flat: true, action: wa({ type: "create", data: { id: "r1", score: 0 } }) },        // collides with r1
    { arm: "create", flat: true, action: wa({ type: "create", data: { id: "rNEW", score: 0 } }) },       // touches nothing
    { arm: "update", flat: true, action: wa({ type: "update", data: { text: "u" }, where: { id: "r2" } }) },
    { arm: "update", flat: true, action: wa({ type: "update", data: { text: "u" }, where: { score: { $gt: 25 } } }) },
    { arm: "update", flat: true, action: wa({ type: "update", data: { text: "u" }, where: { text: "x" } }) },
    { arm: "update", flat: true, action: wa({ type: "update", data: { text: "u" }, where: { $or: [{ id: "r1" }, { id: "r4" }] } }) },
    { arm: "update", flat: true, matchAll: true, action: wa({ type: "update", data: { text: "u" }, where: {} }) },
    { arm: "update", flat: true, action: wa({ type: "update", data: { text: "u" }, where: { id: { $in: ["r2", "r4"] } } }) },
    { arm: "update", flat: true, action: wa({ type: "update", data: { text: "u" }, where: { $nor: [{ id: "r1" }, { id: "r2" }] } }) },
    { arm: "delete", flat: true, action: wa({ type: "delete", where: { id: "r1" } }) },
    { arm: "delete", flat: true, action: wa({ type: "delete", where: { score: { $lt: 15 } } }) },
    { arm: "add_to_set", flat: true, action: wa({ type: "add_to_set", path: "children", items: [{ cid: "z", age: 0, children: [] }], unique_by: "pk", where: { id: "r3" } }) },
    { arm: "push", flat: true, action: wa({ type: "push", path: "children", items: [{ cid: "z", age: 0, children: [] }], where: { id: "r5" } }) },
    { arm: "pull", flat: true, action: wa({ type: "pull", path: "children", items_where: { cid: "a1" }, where: { id: "r1" } }) },
    { arm: "inc", flat: true, action: wa({ type: "inc", path: "score", amount: 1, where: { score: { $gte: 40 } } }) },

    // ── scoped (array_scope) ──
    { arm: "array_scope", flat: false, action: wa(assertWriteArrayScope<Obj, "children">({
        type: "array_scope", scope: "children", where: { id: { $in: ["r1", "r2", "r4"] } },
        action: { type: "update", data: { age: 99 }, where: { cid: { $in: ["a1", "b1"] } } },
    })) },
    { arm: "array_scope", flat: false, action: wa(assertWriteArrayScope<Obj, "children">({
        type: "array_scope", scope: "children", where: { id: "r3" },
        action: { type: "create", data: { cid: "new", age: 0, children: [] } },              // Finding 1: append over empty array
    })) },
    { arm: "array_scope", flat: false, action: wa(assertWriteArrayScope<Obj, "children">({
        type: "array_scope", scope: "children", where: { id: "r1" },
        action: { type: "delete", where: { cid: "a1" } },
    })) },
    { arm: "array_scope", flat: false, action: wa(assertWriteArrayScope<Obj, "children">({
        type: "array_scope", scope: "children", where: { id: { $in: ["r1", "r2", "r4"] } },
        action: assertWriteArrayScope<Child, "children">({
            type: "array_scope", scope: "children", where: { cid: { $in: ["a1", "b1"] } },
            action: { type: "update", data: {}, where: { ccid: "g1" } },
        }),
    })) },
    { arm: "array_scope", flat: false, action: wa(assertWriteArrayScope<Obj, "children">({
        type: "array_scope", scope: "children", where: { id: "r4" },
        action: { type: "update", data: { age: 1 }, where: {} },                              // Finding 2: match-all inner where
    })) },
];

export const FLAT_POOL = POOL.filter((e) => e.flat);
/** Flat entries whose `where` actually excludes some rows — so Front-B equality is never vacuous. */
export const FLAT_SELECTIVE_POOL = FLAT_POOL.filter((e) => !e.matchAll);
export const SCOPED_POOL = POOL.filter((e) => !e.flat);

/** Sample `min..max` pool entries WITH replacement (so batches also exercise de-duplication). */
export function genBatch(rng: () => number, pool: PoolEntry[], min = 1, max = 6): PoolEntry[] {
    const size = min + Math.floor(rng() * (max - min + 1));
    const out: PoolEntry[] = [];
    for (let k = 0; k < size; k++) {
        const idx = Math.floor(rng() * pool.length) % pool.length;
        out.push(pool[idx]!);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Independent oracle — which existing rows could a batch touch?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The flat structural view of a payload the oracle actually walks (discriminant + the few spec-relevant
 * fields). Decoupled from the library's `WritePayload`, whose deep `array_scope.action` recursion partially
 * resolves to `unknown` for a nested-array `T` and so can't be walked directly.
 */
type OraclePayload =
    | { type: "create"; data: Record<string, any> }
    | { type: "update"; where: WhereFilterDefinition }
    | { type: "add_to_set"; where: WhereFilterDefinition }
    | { type: "push"; where: WhereFilterDefinition }
    | { type: "pull"; where: WhereFilterDefinition }
    | { type: "inc"; where: WhereFilterDefinition }
    | { type: "delete"; where: WhereFilterDefinition }
    | { type: "array_scope"; scope: string; where: WhereFilterDefinition; action: OraclePayload };

function listPrimaryKey(d: DDL<Obj>, listPath: string): string {
    const rule = (d.lists as Record<string, { primary_key: string }>)[listPath];
    if (!rule) throw new Error(`oracle: no DDL list rules for "${listPath}"`);
    return rule.primary_key;
}

function childArray(item: Record<string, any>, scope: string): Record<string, any>[] {
    const v = item[scope];
    return Array.isArray(v) ? v : [];
}

/** Compose an oracle list path: the root is `"."`, and it drops away when descending one scope. */
function composeListPath(listPath: string, scope: string): string {
    return listPath === "." ? scope : `${listPath}.${scope}`;
}

/**
 * Indices of `items` (the elements at `listPath`) that `payload` could touch, per the spec's semantics.
 * A scoped `create` touches its parent unconditionally (Finding 1): an append lands on every parent the
 * outer `where` selects, no matter what the array currently holds — so the inner condition is `true`, not
 * a search for a matching element.
 */
function touchableIndices(items: Record<string, any>[], payload: OraclePayload, d: DDL<Obj>, listPath: string, includeDelete: boolean): number[] {
    const idx: number[] = [];
    switch (payload.type) {
        case "create": {
            const pk = listPrimaryKey(d, listPath);
            const key = (payload.data as Record<string, any>)[pk];
            items.forEach((it, i) => { if (it[pk] === key) idx.push(i); });
            return idx;
        }
        case "update":
        case "add_to_set":
        case "push":
        case "pull":
        case "inc": {
            items.forEach((it, i) => { if (matchJavascriptObject(it, payload.where)) idx.push(i); });
            return idx;
        }
        case "delete": {
            if (!includeDelete) return idx;
            items.forEach((it, i) => { if (matchJavascriptObject(it, payload.where)) idx.push(i); });
            return idx;
        }
        case "array_scope": {
            const childPath = composeListPath(listPath, payload.scope);
            items.forEach((it, i) => {
                if (!matchJavascriptObject(it, payload.where)) return;
                const inner = payload.action.type === "create"
                    ? true
                    : touchableIndices(childArray(it, payload.scope), payload.action, d, childPath, includeDelete).length > 0;
                if (inner) idx.push(i);
            });
            return idx;
        }
        default: {
            const _never: never = payload;
            throw new Error(`oracle: unhandled payload ${JSON.stringify(_never)}`);
        }
    }
}

/** Union of root primary-key values that ANY action in the batch could touch. */
export function requiredRootIds(ds: Obj[], actions: WriteAction<Obj>[], d: DDL<Obj>, includeDelete: boolean): Set<string> {
    const out = new Set<string>();
    for (const a of actions) {
        // The oracle walks only the spec-relevant subset of each payload; bridge the library's deep
        // (partially-`unknown`) `WritePayload` to the flat `OraclePayload` the walker is typed against.
        for (const i of touchableIndices(ds as Record<string, any>[], a.payload as OraclePayload, d, ".", includeDelete)) {
            out.add(ds[i]!.id);
        }
    }
    return out;
}

/**
 * Per the spec, `includeDelete:false` ignores a deletion — a top-level delete, or an `array_scope` whose leaf
 * action is a delete (a scoped child-removal). Derived from the semantics, not copied from the implementation.
 */
function isSuppressedUnderExclusion(payload: OraclePayload): boolean {
    if (payload.type === "delete") return true;
    if (payload.type === "array_scope") return isSuppressedUnderExclusion(payload.action);
    return false;
}

/**
 * Remove exactly the actions that `includeDelete:false` suppresses. Lets a test assert the metamorphic relation
 * `fn(B, false)` selects the same rows as `fn(stripDeletes(B), true)` — a stronger, correct alternative to a naive
 * `⊆` (which fails because an all-suppressed batch collapses to `undefined` = match-all, the top of the lattice).
 */
export function stripDeletes(actions: WriteAction<Obj>[]): WriteAction<Obj>[] {
    return actions.filter((a) => !isSuppressedUnderExclusion(a.payload as OraclePayload));
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertion helpers (pure — no vitest dependency)
// ─────────────────────────────────────────────────────────────────────────────

/** Root ids the combined `filter` selects. An absent filter (`undefined`) means "no constraint" → all rows. */
export function matchedIds(filter: WhereFilterDefinition<Obj> | undefined, ds: Obj[] = DS): Set<string> {
    if (filter === undefined) return new Set(ds.map((o) => o.id));
    return new Set(ds.filter((o) => matchJavascriptObject(o, filter)).map((o) => o.id));
}

/** Required ids the filter FAILS to cover — a non-empty result is an under-selection (correctness) bug. */
export function missingCoverage(filter: WhereFilterDefinition<Obj> | undefined, requiredIds: Iterable<string>, ds: Obj[] = DS): string[] {
    const matched = matchedIds(filter, ds);
    return [...requiredIds].filter((id) => !matched.has(id));
}

export function sortedIds(ids: Iterable<string>): string[] {
    return [...ids].sort();
}

/** Whether the combined filter is a top-level `$or` union (vs a single bare term). */
export function hasTopLevelOr(filter: WhereFilterDefinition<Obj> | undefined): boolean {
    return !!filter && typeof filter === "object" && "$or" in filter;
}
