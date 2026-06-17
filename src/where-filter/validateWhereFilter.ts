import type { ZodType } from "zod";
import { convertSchemaToDotPropPathTree, type TreeNode } from "../dot-prop-paths/schema-tree.ts";
import { objectRejectsUnknownKeys } from "../zod/introspection.ts";
import { WhereFilterLogicOperators, ValueComparisonRangeOperators } from "./consts.ts";
import { isWhereFilterDefinition } from "./schemas.ts";
import type { WhereFilterDefinition } from "./types.ts";
import { findNonJsonValues, type NonJsonValueIssue } from "../utils/findNonJsonValues.ts";

/**
 * Validate a `WhereFilterDefinition` against a Zod schema *before* it runs, so a clause that references a
 * non-existent field, contradicts a field's type, carries a non-finite number, or is structurally malformed
 * is caught as an error rather than silently matching nothing — or throwing — inside `matchJavascriptObject`.
 * It powers `writeToItemsArray`'s `invalid_filter` error and is reusable by consumers that validate
 * `get`/`keys` filters (e.g. the in-memory ICollection).
 *
 * **Conservative by design — never a false positive.** Because the validator now *gates* writes, a false
 * reject would block a usable write; a missed catch only preserves the prior silent no-op. So it flags a
 * filter only when `matchJavascriptObject` would match **zero** rows for it (or would throw). It mirrors the
 * matcher exactly:
 *
 * - **Polarity.** Only *positive* operators (bare value, `$eq`, `$in`, range `$gt/$lt/$gte/$lte`) make a
 *   clause match nothing on a type/finite contradiction, so only those are checked. *Broadening* forms
 *   match widely — including missing fields — so they are never flagged: bare `null`, `$eq:null`, `$ne`,
 *   `$nin`, `$not`, `$exists`, `$type`. (e.g. `{ghost:{$ne:5}}` matches every row, so the unknown field
 *   `ghost` is *not* reported.)
 * - **Logic.** Anything reached through `$or`/`$nor` is skipped — a sibling arm can rescue the match
 *   (`$or`) or the negation inverts it (`$nor`) — so a bad arm is never flagged. `$and`, multiple keys
 *   (implicit `$and`), and the top level are still checked. (This misses the rare all-arms-dead `$or`;
 *   accepted, to stay simple and never false-positive.)
 * - **Numbers.** A *direct* operand (bare/`$eq`/range) is `non_finite` when it makes the clause match nothing:
 *   `NaN` always (it compares false to everything), and `±Infinity` only in a *zero-match position* —
 *   `$eq`/`$gt`/`$gte:Infinity` and `$eq`/`$lt`/`$lte:-Infinity` (no finite value equals or exceeds ±Infinity,
 *   and data can't store a non-finite number anyway). The mirror positions `$lt`/`$lte:Infinity` and
 *   `$gt`/`$gte:-Infinity` are legitimate bounds matching every finite value, so they stay valid. A non-finite
 *   element inside `$in` can sit beside a matching element, so `$in` is never flagged for it.
 * - **`$in`.** Reported `type_mismatch` only when *every* element is the wrong type (one right-type element
 *   could match).
 * - **Arrays.** Descends element-wise into object-array conditions (`$elemMatch` and the operator-free
 *   compound form) exactly where the matcher does; stays opaque on the array/operator forms it handles
 *   atomically (`$in`/`$size`/`$all`/etc.).
 * - **Malformed.** A filter the matcher would *throw* on is reported `malformed`: a structurally invalid
 *   filter (`isWhereFilterDefinition` false — `null`, `[]`, `{$or:[null]}`), or — in a must-match position — an
 *   un-compilable `$regex` pattern or a range operand that is not a number or string. The operand checks are
 *   static (data-independent, so they hold even on an empty list) but polarity-aware: under `$or`/`$nor` the
 *   matcher short-circuits, so a sibling arm can still match — a throw there is left to the write engine's
 *   runtime dry-run, not flagged here (flagging it would be a false positive).
 *
 * **`unknown_field` is flagged only under `.strict()` objects.** A strict object's parse rejects extra keys,
 * so the write engine cannot store an undeclared key on such a row — only there is a `where` on an undeclared
 * key guaranteed to match nothing. Default (strip), `.passthrough()`, and `.catchall(...)` objects all
 * fail-allow: they tolerate or persist extra keys (the engine stores rows un-normalised), so a filter on an
 * undeclared key could legitimately match and must not be flagged. Records, unions, and dynamic shapes also
 * fail-allow (their keys can't be modelled). In a union, a path counts as strict only when *every* variant is
 * strict; one fail-open variant could carry the key, so both `unknown_field` and the scalar type-checks stand
 * down for that path. This assumes a strict schema's rows are seeded conforming — an unvalidated `initialItems`
 * row carrying an extra key is out of contract.
 *
 * **Deliberately not flagged (accepted misses — it errs toward a miss over a false positive).** Value-constraint
 * "matches nothing" queries (operands are never `safeParse`d, so a `.positive()` field still accepts a negative
 * filter); the documented edge cases (`{}`, `{field:undefined}`, empty `$and`/`$or`/`$nor`); logic-rescued
 * `$or`/`$nor` arms and the rare all-arms-dead `$or`; undeclared or mistyped fields under non-strict or
 * mixed-strictness-union parents; and positive contradictions expressed via `$exists:true` / `$type` / `$regex`
 * (e.g. `{age:{$type:'string'}}` on a number field) — these match zero rows but stay unflagged to keep the
 * validator simple and its false-positive surface minimal.
 *
 * **Opt-in `SerialisableJsonSubset` (`{ requireSerialisableJsonSubset: true }`).** A *further* narrowing layered
 * on top of everything above: also reject every operand that cannot losslessly round-trip JSON — a non-finite
 * number in ANY position (incl. a satisfiable match-all `$lt: Infinity` and an `$in` member), a non-JSON carrier
 * (`Date`/`bigint`/`Map`/`Set`/`Symbol`), and an `undefined` operand — via a schema-independent value walk
 * (`../utils/findNonJsonValues.ts`), so it holds even under a `.passthrough()`/`.loose()` schema. Off by default
 * (the matcher and the bare validator admit these operands); engaged only by callers that cross a serialisation
 * boundary (e.g. a stacking ICollection's `get`/`keys`/`write`, where the operand is forwarded over a wire).
 */

/** One reason a filter is invalid, with the offending field path (absent for whole-filter `malformed`). */
export type WhereFilterValidationIssue = {
    path?: string;
    reason: "unknown_field" | "type_mismatch" | "non_finite" | "malformed";
    message: string;
};

/** ZodKinds whose values are a single primitive we can coarsely type-check a filter operand against. */
const SCALAR_KINDS = new Set<string>(["string", "number", "boolean"]);
const LOGIC_OPERATORS = WhereFilterLogicOperators as readonly string[];
/** Operators that broaden a match (incl. missing fields), so a contradiction under them never means "matches nothing". */
const BROADENING_OPS = ["$ne", "$nin", "$not", "$exists", "$type"] as const;
/** Positive range operators whose operand is compared as the field's own value. */
const RANGE_OPS = ValueComparisonRangeOperators; // literal tuple — each element keeps its `RangeOp` type (no `as string[]`), so a classified operand can record which range op produced it

/**
 * path → *every* `TreeNode` registered at that path. The flat `TreeNodeMap` keeps only the first node per
 * path (zod.ts), which loses the other variants of a union and collapses an array's element node onto its
 * container. Keeping all of them is what lets the validator (a) avoid false-rejecting a union path whose
 * variants disagree on type, and (b) tell an object-array (has child paths) from a scalar array (none).
 */
type NodeMultimap = Record<string, TreeNode[]>;
/**
 * A schema indexed for validation: the multimap; the paths owning ≥1 distinct child path; the `strict` paths
 * (every object node there is `.strict()` — the only paths under which `unknown_field` is flagged); and the
 * `open` paths (carrying ≥1 fail-open object node — default/passthrough/catchall — which can hold an
 * undeclared key of any type).
 */
type SchemaIndex = { multimap: NodeMultimap; hasChildren: Set<string>; strict: Set<string>; open: Set<string> };

/**
 * Build a reusable validator from a schema — mirrors `compileMatchJavascriptObject`. The schema is walked
 * into a node index once; the returned function validates many filters cheaply.
 *
 * @example
 * const validate = compileValidateWhereFilter(ContactSchema);
 * validate({ ghost: 1 });          // [{ path: 'ghost', reason: 'unknown_field', ... }]
 * validate({ ghost: { $ne: 1 } }); // [] — `$ne` matches missing, so it is not a contradiction
 * validate({ age: { $gte: 18 } }); // []
 */
export function compileValidateWhereFilter<T extends Record<string, any>>(
    schema: ZodType<T>,
    options?: { requireSerialisableJsonSubset?: boolean },
): (filter: WhereFilterDefinition<T>) => WhereFilterValidationIssue[] {
    let index: SchemaIndex | undefined;
    try {
        const { root } = convertSchemaToDotPropPathTree(schema, {
            union_aware: true, // a dedicated node per union variant — avoids the walker throwing on a union of objects
            // schema refs retained (not excluded): buildSchemaIndex reads each object node's catchall to fail-allow passthrough/catchall
            exclude_parent_reference: true,
        });
        index = buildSchemaIndex(root);
    } catch {
        // A schema the walker can't model → don't validate (accept everything) rather than risk a false reject.
        index = undefined;
    }
    return (filter) => {
        const issues: WhereFilterValidationIssue[] = [];
        // Schema-aware checks first (skipped when the schema can't be modelled), so the established field-level
        // `where_path` stays `issues[0]` for a fault both layers catch.
        if (index) {
            // A filter the matcher would throw on (null / [] / nested-malformed). A throw is never a match, so
            // reporting it is airtight; checked up-front via the matcher's own predicate so the two stay in sync.
            if (!isWhereFilterDefinition(filter)) {
                issues.push({ reason: "malformed", message: "Filter is not a valid where-filter definition." });
            } else {
                walk(filter as Record<string, unknown>, "", false, index, issues);
            }
        }
        // SerialisableJsonSubset gate (opt-in; see `../utils/findNonJsonValues.ts`). Schema-INDEPENDENT, so it
        // runs even when the schema can't be modelled, and a `.passthrough()`/`.loose()` schema can't hide a
        // non-JSON operand from it. It rejects in ANY position — incl. a broadening `$ne` and a satisfiable
        // match-all bound (`$lt: Infinity`) the conservative schema walk deliberately leaves alone — because
        // those operands corrupt across a serialisation boundary even though the live matcher satisfies them.
        if (options?.requireSerialisableJsonSubset) appendNonSerialisableIssues(filter, issues);
        return issues;
    };
}

/** One-shot validate (builds the index each call). Prefer `compileValidateWhereFilter` for repeated use. */
export function validateWhereFilter<T extends Record<string, any>>(
    filter: WhereFilterDefinition<T>,
    schema: ZodType<T>,
    options?: { requireSerialisableJsonSubset?: boolean },
): WhereFilterValidationIssue[] {
    return compileValidateWhereFilter(schema, options)(filter);
}

/**
 * Append a `WhereFilterValidationIssue` for every operand that breaks the `SerialisableJsonSubset` — the
 * schema-independent half of `requireSerialisableJsonSubset`. Walks the live filter's values (a `where` operand
 * is dropped to `flagUndefined: true`: an `undefined` operand degrades `{ field: undefined }` to a match-all `{}`
 * across the boundary), reusing the existing `non_finite`/`malformed` reasons so no new error vocabulary is needed.
 */
function appendNonSerialisableIssues(filter: unknown, issues: WhereFilterValidationIssue[]): void {
    const nonJson: NonJsonValueIssue[] = [];
    findNonJsonValues(filter, "", nonJson, { flagUndefined: true });
    for (const { reason, path } of nonJson) {
        const where = path ? ` on '${path}'` : "";
        issues.push({
            reason,
            path,
            message: reason === "non_finite"
                ? `Non-finite operand${where} cannot losslessly round-trip JSON.`
                : `Non-JSON operand${where} cannot losslessly round-trip JSON.`,
        });
    }
}

/** Join a dot-prop ancestry prefix with a key (`'' + 'a'` → `'a'`; `'children' + 'name'` → `'children.name'`). */
function joinPath(prefix: string, key: string): string {
    return prefix ? `${prefix}.${key}` : key;
}

/** DFS the schema tree into a multimap (all nodes per path) and a set of paths that have a distinct child path. */
function buildSchemaIndex(root: TreeNode): SchemaIndex {
    const multimap: NodeMultimap = {};
    const hasChildren = new Set<string>();
    const strictCandidate = new Set<string>();
    const open = new Set<string>();
    const stack: TreeNode[] = [root];
    while (stack.length) {
        const node = stack.pop()!;
        (multimap[node.dotprop_path] ??= []).push(node);
        // Classify each object node: `.strict()` guarantees a written row holds no undeclared key (its parse
        // rejects extras); default/passthrough/catchall (`open`) can carry one. Union variants share a path,
        // so a path is genuinely strict only when EVERY object node there is strict — `strict = candidate \ open`.
        if (node.kind === "object" && node.schema) {
            if (objectRejectsUnknownKeys(node.schema)) strictCandidate.add(node.dotprop_path);
            else open.add(node.dotprop_path);
        }
        for (const child of node.children) {
            // Array elements and union variants are nameless and reuse the parent's path; only a child with
            // its *own* path means the parent owns sub-fields (i.e. it is an object-bearing node).
            if (child.dotprop_path !== node.dotprop_path) hasChildren.add(node.dotprop_path);
            stack.push(child);
        }
    }
    const strict = new Set([...strictCandidate].filter((p) => !open.has(p)));
    return { multimap, hasChildren, strict, open };
}

/**
 * Mirror the matcher's traversal: recurse `$and`/`$or`/`$nor` sub-filters; treat every other key as a field
 * leaf (multiple keys = implicit `$and`). `broadening` turns on once an `$or`/`$nor` is entered, so leaves
 * beneath it are skipped (a sibling arm can rescue the match). `prefix` is the dot-prop ancestry accumulated
 * while descending into array elements.
 */
function walk(filter: Record<string, unknown> | null | undefined, prefix: string, broadening: boolean, index: SchemaIndex, issues: WhereFilterValidationIssue[]): void {
    if (!filter || typeof filter !== "object") return;
    for (const key of Object.keys(filter)) {
        const value = filter[key];
        // A logic key only behaves as logic when its value is an array (mirrors `isLogicFilter`); otherwise
        // the matcher treats it as a (non-existent) field path, so we validate it as a leaf.
        if (LOGIC_OPERATORS.includes(key) && Array.isArray(value)) {
            const childBroadening = broadening || key === "$or" || key === "$nor";
            for (const sub of value) walk(sub as Record<string, unknown>, prefix, childBroadening, index, issues);
            continue;
        }
        validateLeaf(joinPath(prefix, key), value, broadening, index, issues);
    }
}

/** A range comparison operator (derived from the canonical tuple — single source of truth) whose operand is compared against the field's own value. */
type RangeOp = (typeof ValueComparisonRangeOperators)[number];
/**
 * A direct (must-match) operand tagged with the operator it was supplied under. The tag is what lets the
 * `non_finite` check tell a zero-match `Infinity` (e.g. `$gte:Infinity`, which no finite row reaches) from a
 * legitimate bound (`$lt:Infinity`, which every finite row satisfies). Bare scalars and `$eq` carry `"$eq"`.
 */
type DirectOperand = { value: unknown; op: "$eq" | RangeOp };

/** A leaf condition classified by which matcher branch it drives — only `direct`/`in` operands can make a clause match nothing. */
type LeafClass =
    | { kind: "broadening" }
    | { kind: "in"; list: unknown[] }
    | { kind: "regex"; pattern: unknown; options: unknown }
    | { kind: "direct"; operands: DirectOperand[] }
    | { kind: "opaque" };

/**
 * Map a leaf condition onto the matcher's `compareValue` precedence so the validator judges exactly the
 * operand the matcher would use: any broadening operator (matches missing/any) short-circuits to skip; among
 * positives the order is `$in` → `$regex` → `$eq` → range, mirroring the matcher's if-chain.
 */
function classifyCondition(condition: unknown): LeafClass {
    if (condition === null || condition === undefined) return { kind: "broadening" }; // bare null / absent → matches missing
    if (typeof condition !== "object") return { kind: "direct", operands: [{ value: condition, op: "$eq" }] }; // bare scalar equality
    if (Array.isArray(condition)) return { kind: "opaque" }; // array literal = exact deep-equal
    const ops = condition as Record<string, unknown>;
    for (const op of BROADENING_OPS) if (op in ops) return { kind: "broadening" };
    if ("$eq" in ops && ops["$eq"] === null) return { kind: "broadening" }; // $eq:null matches null/missing
    if ("$in" in ops) return Array.isArray(ops["$in"]) ? { kind: "in", list: ops["$in"] } : { kind: "opaque" };
    if ("$regex" in ops) return { kind: "regex", pattern: ops["$regex"], options: ops["$options"] }; // pattern, not a field-typed value
    if ("$eq" in ops) return ops["$eq"] === undefined ? { kind: "opaque" } : { kind: "direct", operands: [{ value: ops["$eq"], op: "$eq" }] };
    const operands = RANGE_OPS.filter((op) => op in ops).map((op) => ({ value: ops[op], op })); // tag each operand with its range op → drives the position-aware Infinity check
    if (operands.length > 0) return { kind: "direct", operands };
    return { kind: "opaque" }; // operator-free object: deep-equal on a scalar, or a compound array-element filter
}

/** True when `pattern` (with optional `options`) compiles to a valid RegExp — i.e. the matcher's `RegExp(...)` would not throw. */
function regexCompiles(pattern: string, options: unknown): boolean {
    try {
        RegExp(pattern, typeof options === "string" ? options : undefined);
        return true;
    } catch {
        return false;
    }
}

/**
 * True for an `±Infinity` operand that makes a finite-valued field match **zero** rows — the same zero-match
 * property that flags `NaN`, so it earns the same `non_finite`. No stored finite value equals `±Infinity`, is
 * `> +Infinity`, or is `< -Infinity` (data can't even store a non-finite number — it won't round-trip JSON),
 * so `$eq`/`$gt`/`$gte:Infinity` and `$eq`/`$lt`/`$lte:-Infinity` are contradictions. The mirror positions
 * (`$lt`/`$lte:Infinity`, `$gt`/`$gte:-Infinity`) are legitimate bounds matching every finite value — left valid.
 */
function isZeroMatchInfinity(value: number, op: "$eq" | RangeOp): boolean {
    if (value === Infinity) return op === "$eq" || op === "$gt" || op === "$gte";
    if (value === -Infinity) return op === "$eq" || op === "$lt" || op === "$lte";
    return false;
}

/** Validate one `{ path: condition }` leaf: skip broadening/logic-rescued clauses, descend object-arrays, then coarsely check known scalar fields. */
function validateLeaf(path: string, condition: unknown, broadening: boolean, index: SchemaIndex, issues: WhereFilterValidationIssue[]): void {
    if (broadening) return; // reached through `$or`/`$nor` — a sibling arm could match, so never flag
    const cls = classifyCondition(condition);
    if (cls.kind === "broadening") return; // matches missing/any → not a contradiction (covers unknown fields too)

    // An operand the matcher would THROW on never matches any row, so flag it here — sound only in this
    // must-match position (the returns above mean no `$or`/`$nor` sibling can rescue the filter via
    // short-circuit; those throws are left to the runtime dry-run, which is data-correct). A `$regex` operand
    // is a pattern; a range operand must be a number or string (an `Infinity`/`NaN` operand is a number — a
    // valid comparand or the `non_finite` case below — so it is not malformed).
    if (cls.kind === "regex") {
        if (typeof cls.pattern === "string" && !regexCompiles(cls.pattern, cls.options)) {
            issues.push({ path, reason: "malformed", message: `Invalid $regex pattern on '${path}'.` });
        }
        return; // a $regex operand is a pattern, not a field-typed value — nothing else to check
    }
    if (cls.kind === "direct" && cls.operands.some((o) => o.op !== "$eq" && typeof o.value !== "number" && typeof o.value !== "string")) {
        issues.push({ path, reason: "malformed", message: `Range operator on '${path}' needs a number or string operand.` });
        return;
    }

    const nodes = index.multimap[path];
    if (!nodes || nodes.length === 0) {
        // Flag only when every possible parent is a known object/array — otherwise the path may be a
        // legitimate descent into a record/union/dynamic shape we can't model, so we accept it. (Unknown
        // fields under a union stay accepted by design: a union parent is non-structural here.)
        if (parentIsStrict(path, index)) issues.push({ path, reason: "unknown_field", message: `Unknown field '${path}'.` });
        return;
    }

    if (isObjectArrayPath(path, index)) {
        // The matcher applies a `$elemMatch`/compound object filter element-wise (compareArray), so we
        // descend into the element's sub-paths with a fresh must-match context (`broadening` resets to false).
        // Anything else (array literal, `$in`/`$size`/etc.) the matcher handles atomically → opaque here.
        const inner = recursableArrayInner(condition);
        if (inner) {
            walk(inner, path, false, index, issues);
            return;
        }
    }

    // Type/finite-check only when every node at this path agrees on one scalar kind AND no fail-open union
    // variant could carry this key with another type. Union variants can disagree (e.g. `{a:string} |
    // `{a:number}` → two kinds, skip), and a fail-open sibling that omits the key could carry it as any-typed
    // (parentMayCarryAnyType → skip); either would otherwise false-reject a conforming row.
    const kinds = new Set(nodes.map((n) => n.kind));
    if (kinds.size === 1 && SCALAR_KINDS.has(nodes[0]!.kind) && !parentMayCarryAnyType(path, index)) {
        const kind = nodes[0]!.kind;
        if (cls.kind === "direct") {
            for (const { value, op } of cls.operands) {
                if (typeof value === "number" && (Number.isNaN(value) || isZeroMatchInfinity(value, op))) {
                    issues.push({ path, reason: "non_finite", message: `Non-finite operand in filter on '${path}' matches nothing.` });
                    return;
                }
                if (value !== null && value !== undefined && typeof value !== kind) {
                    issues.push({ path, reason: "type_mismatch", message: `Filter on '${path}' expects ${kind}, got ${typeof value}.` });
                    return;
                }
            }
        } else if (cls.kind === "in") {
            // One right-type element could match, so flag only when EVERY element is the wrong type.
            const checkable = cls.list.filter((el) => el !== null && el !== undefined);
            if (checkable.length > 0 && checkable.every((el) => typeof el !== kind)) {
                issues.push({ path, reason: "type_mismatch", message: `Filter on '${path}' expects ${kind} values in $in.` });
            }
        }
    }
}

/**
 * True when `path`'s immediate parent is a `.strict()` object (or an array of strict objects) — the only case
 * where a missing leaf genuinely cannot exist on a written row, because a strict object's parse rejects extra
 * keys. Anything else (default/strip, passthrough, catchall, record, union, dynamic) fails-allow, so an
 * undeclared key there is not flagged: it may legitimately be present, and flagging would be a false positive.
 */
function parentIsStrict(path: string, index: SchemaIndex): boolean {
    const lastDot = path.lastIndexOf(".");
    const parentPath = lastDot === -1 ? "" : path.slice(0, lastDot); // '' is the schema root
    return index.strict.has(parentPath);
}

/**
 * True when a fail-open object variant at `path`'s parent could carry `path` as an undeclared extra key of
 * ANY type, making the declared kind(s) at `path` non-exhaustive — so the scalar checks must be skipped: a
 * conforming row matching that variant can hold a value of any type, and flagging would be a false positive.
 * (A strict variant can't carry it; a fail-open variant that itself declares `path` is covered by its kind.)
 */
function parentMayCarryAnyType(path: string, index: SchemaIndex): boolean {
    const lastDot = path.lastIndexOf(".");
    const parentPath = lastDot === -1 ? "" : path.slice(0, lastDot);
    if (!index.open.has(parentPath)) return false; // no fail-open variant at the parent → declared kinds are exhaustive
    for (const node of index.multimap[parentPath] ?? []) {
        if (node.kind !== "object" || !node.schema || objectRejectsUnknownKeys(node.schema)) continue;
        if (!node.children.some((c) => c.dotprop_path === path)) return true; // a fail-open variant omits `path`
    }
    return false;
}

/** True when `path` is an array whose elements are objects (so descending into an element filter is meaningful). A scalar array has an array node but no distinct child paths. */
function isObjectArrayPath(path: string, index: SchemaIndex): boolean {
    const nodes = index.multimap[path];
    return !!nodes && nodes.some((n) => n.kind === "array") && index.hasChildren.has(path);
}

/**
 * The element sub-filter to descend into for an object-array condition, or `undefined` when the form is
 * opaque to element-wise matching. Mirrors `compareArray`, which applies a `$elemMatch` body or a bare
 * compound object against each element via the matcher: we descend an operator-free object AND logic
 * operators (`$and`/`$or`/`$nor`), which the matcher evaluates per-element — `walk` re-applies broadening, so
 * an `$or`/`$nor` arm is still never flagged. An array literal, a scalar, or any other `$`-prefixed form
 * (`$in`/`$nin`/`$all`/`$size`/`$exists`/`$type`/`$not`/range ops) is handled atomically and not descended.
 */
function recursableArrayInner(condition: unknown): Record<string, unknown> | undefined {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) return undefined;
    const obj = condition as Record<string, unknown>;
    const inner = "$elemMatch" in obj ? obj["$elemMatch"] : obj;
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) return undefined;
    const innerObj = inner as Record<string, unknown>;
    // Logic operators are descended (the matcher applies them per-element); any other operator is atomic → opaque.
    for (const k of Object.keys(innerObj)) if (k.startsWith("$") && !LOGIC_OPERATORS.includes(k)) return undefined;
    return innerObj;
}
