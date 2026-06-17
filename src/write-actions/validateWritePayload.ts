/**
 * Validates that write payloads can cross JSON serialization boundaries losslessly.
 *
 * WriteActions are sometimes transferred through `JSON.stringify` / `JSON.parse` before they are applied.
 * JSON-roundtrip compatibility is therefore a core write requirement: the write surface is intentionally
 * narrowed to values whose write meaning survives that boundary.
 *
 * This module enforces that requirement in two linked layers:
 *
 * - {@link validateWritePayloadSchema} checks the row schema once. It rejects schemas that declare values JSON
 *   cannot represent losslessly, such as `z.date()`, `z.bigint()`, `z.map()`, `z.set()`, `z.nan()`, non-JSON
 *   literals, or schema branches that cannot be proven JSON-safe.
 * - {@link validateWritePayloadValues} checks each write payload. It catches runtime values the schema check
 *   cannot fully cover, especially values admitted by open schemas (Zod passthrough/loose), and JSON edge cases
 *   such as `NaN` or `Infinity` serializing to `null`.
 *
 * Use both for full coverage. The schema check proves the declared write surface is JSON-safe; the value check is
 * the per-write backstop for actual data.
 *
 * @example
 * validateWritePayloadSchema(z.object({ id: z.string(), at: z.date() }));
 * // -> [{ kind: "unsupported", reason: "non_json_type", path: "at", ... }]
 *
 * @example
 * validateWritePayloadSchema(z.looseObject({ id: z.string() }));
 * // -> []
 *
 * validateWritePayloadValues({
 *   type: "create",
 *   data: { id: "1", extra: new Date() },
 * });
 * // -> [{ reason: "malformed", path: "extra" }]
 *
 * @example
 * validateWritePayloadValues({
 *   type: "inc",
 *   path: "count",
 *   amount: NaN,
 *   where: { id: "1" },
 * });
 * // -> [{ reason: "non_finite", path: "count" }]
 */

import type { ZodType } from "zod";
import type { WritePayload } from "./types.ts";
import {
  getZodKind,
  getSchemaChildren,
  getLiteralValues,
  type AnyZodSchema,
  type SchemaChild,
} from "../zod/introspection.ts";
import { findNonJsonValues, type NonJsonValueIssue } from "../utils/findNonJsonValues.ts";

/** Why a value (or a schema's declared type) cannot losslessly round-trip JSON: a non-finite number, or any other non-JSON carrier. Aliases the shared {@link NonJsonValueIssue} reason ({@link findNonJsonValues}) so the value-walk and this module's vocabulary never drift. */
export type NonJsonReason = NonJsonValueIssue["reason"];

/**
 * One per-write VALUE JSON-roundtrip fault from {@link validateWritePayloadValues}. `path` locates the offending
 * value (dot-path, omitted at the payload root); `reason` is the 2-value {@link NonJsonReason} the engine maps
 * straight onto a runtime `invalid_data_value.reason`. The construction-time schema check is a different
 * lifecycle (it throws, never becomes a `WriteError`), so it has its own richer {@link WritePayloadSchemaIssue}.
 */
export type WritePayloadValidationIssue = {
  reason: NonJsonReason;
  path?: string;
  message?: string;
};

/** The closed set of ways a SCHEMA can declare a type that will not round-trip JSON — a construction-time fault, never a runtime error. */
export type WriteSchemaIssueReason =
  | "non_json_type"
  | "indeterminate_branch"
  | "non_json_literal"
  | "bad_root_shape";

/**
 * One construction-time schema JSON-safety fault from {@link validateWritePayloadSchema}. Deliberately distinct
 * from the per-write {@link WritePayloadValidationIssue} (peer to `WhereFilterValidationIssue`): a schema fault
 * throws at construction and never becomes a runtime `WriteError`, so it is free to carry a richer,
 * machine-readable vocabulary instead of the engine's 2-value `NonJsonReason`. `kind` separates a provably
 * non-JSON type (`unsupported`) from a merely unprovable branch (`indeterminate`) — a genuinely different
 * remediation ("remove the `Date`" vs. "narrow this `any`/transform"); `declaredType` is the offending Zod kind
 * (e.g. `date`, `any`, `union`); `message` is always a complete, throwable sentence.
 */
export type WritePayloadSchemaIssue = {
  kind: "unsupported" | "indeterminate";
  reason: WriteSchemaIssueReason;
  path?: string;
  declaredType?: string;
  message: string;
};

// ─────────────────────────────── value safety ───────────────────────────────
// The per-value JSON-roundtrip walk is the shared `findNonJsonValues` (the `SerialisableJsonSubset` predicate).
// A write-payload value treats `undefined` as a recoverable missing key, so it is NOT flagged here
// (`flagUndefined` is left off — that is the `where`-operand gate's concern, where a dropped key changes the
// match set).

/**
 * Checks whether the actual values in one `WritePayload` can cross JSON serialization boundaries losslessly.
 * (Writes are intentionally restricted to just JSON-serialisable objects for maximum environment compatibility.)
 *
 * Run this for every write before the payload is serialized or applied. It is schema-agnostic and walks the
 * written data directly: create/update data, inc amounts, push/add_to_set items, and nested array_scope actions.
 * Delete and pull payloads carry no written values.
 *
 * This is the required backstop for what schema validation cannot fully cover: values admitted by open schemas
 * (Zod passthrough/loose), plus JSON edge cases such as `NaN` and `Infinity`, which JSON would silently turn into
 * `null`.
 *
 * @example
 * validateWritePayloadValues({ type: "create", data: { id: "x", n: Infinity } });
 * // -> [{ reason: "non_finite", path: "n" }]
 */
export function validateWritePayloadValues(
  payload: WritePayload<any>,
): WritePayloadValidationIssue[] {
  const out: WritePayloadValidationIssue[] = [];
  switch (payload.type) {
    case "create":
    case "update":
      findNonJsonValues(payload.data, "", out);
      break;
    case "inc":
      findNonJsonValues(payload.amount, String(payload.path), out);
      break;
    case "push":
    case "add_to_set":
      findNonJsonValues(payload.items, String(payload.path), out);
      break;
    case "array_scope":
      return validateWritePayloadValues(payload.action as WritePayload<any>);
    default:
      break; // delete / pull carry no written data
  }
  return out;
}

// ─────────────────────────────── schema safety ───────────────────────────────
// Relocated from store2's findUnsupportedSchemaTypes; the DDL-specific default_ordering_key check stays in the consumer.

// Concrete types whose declared values cannot losslessly round-trip JSON — a stored value is silently lost or
// rewritten (`Date`/`BigInt`/`Map`/`Set`/`Symbol`/`File` have no JSON form; `z.nan()` admits ONLY `NaN`, which
// `JSON.stringify` rewrites to `null`).
const UNSUPPORTED = new Set([
  "date",
  "bigint",
  "map",
  "set",
  "symbol",
  "file",
  "nan",
]);
// Opaque or value-transforming branches a schema walk cannot prove JSON-safe (a transform/codec surfaces as `pipe`/`transform`).
const INDETERMINATE = new Set([
  "any",
  "unknown",
  "custom",
  "transform",
  "pipe",
  "promise",
  "function",
]);
// Provably JSON-safe terminals — accepted without recursing. `literal` is deliberately ABSENT: its VALUE is
// checked (a `z.literal(1n)` is non-JSON despite the `literal` kind). `nan` is ABSENT too (see UNSUPPORTED):
// `z.nan()` round-trips to `null`. `undefined`/`void`/`never` stay — `undefined` is recoverable (an absent key
// reads back as `undefined`) and `never` has no inhabitant to round-trip.
const JSON_SAFE_LEAF = new Set([
  "string",
  "number",
  "int",
  "boolean",
  "null",
  "enum",
  "undefined",
  "void",
  "never",
  "templateliteral",
]);
// A catchall of one of these kinds is a legitimately OPEN object — `.passthrough()`/`.loose()` (`unknown`) or `.strict()` (`never`), not a typed non-JSON extra.
const OPEN_CATCHALL = new Set(["unknown", "any", "never"]);

/** True when a (primitive) literal value survives a JSON round-trip — a bigint/symbol/NaN/Infinity literal does not, even though its kind is `literal`. */
function literalValueIsJsonSafe(value: unknown): boolean {
  if (value === null || value === undefined) return true; // undefined drops on round-trip but is recoverable — an absent key reads back as undefined
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value); // NaN/±Infinity serialise to null; -0 is finite and round-trips as 0
  return false; // bigint / symbol / function / object — not JSON-safe
}

/** Extend `path` for a child by its structural relation (object `a.b`, array `a[]`, record/catchall `a{}`, tuple `a[i]`); no leading dot at the root. */
function extendSchemaPath(path: string, child: SchemaChild): string {
  switch (child.relation) {
    case "field":
      return path ? `${path}.${child.key}` : String(child.key);
    case "element":
      return `${path}[]`;
    case "value":
    case "catchall":
      return `${path}{}`;
    case "item":
      return `${path}[${child.key}]`;
    default:
      return path; // variant / intersection / wrapped share the parent's path
  }
}

/** Recursively classify a schema node against the JSON-safety policy; a visited-set makes self-referential `z.lazy` schemas terminate. */
function walkSchema(
  schema: AnyZodSchema,
  path: string,
  visited: Set<unknown>,
  out: WritePayloadSchemaIssue[],
): void {
  if (visited.has(schema)) return;
  visited.add(schema);
  const kind = getZodKind(schema);
  const at = path ? ` at '${path}'` : "";
  if (UNSUPPORTED.has(kind)) {
    out.push({
      kind: "unsupported",
      reason: "non_json_type",
      path: path || undefined,
      declaredType: kind,
      message: `Schema declares a non-JSON type '${kind}'${at}.`,
    });
    return;
  }
  if (INDETERMINATE.has(kind)) {
    out.push({
      kind: "indeterminate",
      reason: "indeterminate_branch",
      path: path || undefined,
      declaredType: kind,
      message: `Schema branch '${kind}'${at} cannot be proven JSON-safe.`,
    });
    return;
  }
  if (kind === "literal") {
    for (const value of getLiteralValues(schema)) {
      if (!literalValueIsJsonSafe(value)) {
        // A bigint/symbol/object literal or a non-finite-number literal — the literal's VALUE can't round-trip JSON.
        out.push({
          kind: "unsupported",
          reason: "non_json_literal",
          path: path || undefined,
          declaredType: "literal",
          message: `Schema declares a non-JSON literal${at}.`,
        });
        return; // one issue per literal node is enough
      }
    }
    return;
  }
  if (JSON_SAFE_LEAF.has(kind)) return;
  for (const child of getSchemaChildren(schema)) {
    // A `.passthrough()`/`.loose()`/`.strict()` object is legitimately open; only a typed non-JSON catchall is walked and rejected.
    if (
      child.relation === "catchall" &&
      OPEN_CATCHALL.has(getZodKind(child.schema))
    )
      continue;
    walkSchema(child.schema, extendSchemaPath(path, child), visited, out);
  }
}

/**
 * The declared keys if `schema`'s root resolves to a SINGLE object shape — a `z.object`, or an intersection of
 * object shapes (`A.and(B)`, one merged shape) — else `null`. A root union (`A | B`) or a non-object root is
 * multi-shape / shapeless. Intersection is load-bearing: callers graft fields onto a row via `z.intersection`
 * (e.g. a synthetic PK).
 */
function rootShapeKeys(schema: AnyZodSchema): string[] | null {
  const kind = getZodKind(schema);
  if (kind === "object")
    return getSchemaChildren(schema)
      .filter((c) => c.relation === "field")
      .map((c) => String(c.key));
  if (kind === "intersection") {
    const armKeys = getSchemaChildren(schema)
      .filter((c) => c.relation === "intersection")
      .map((c) => rootShapeKeys(c.schema));
    if (armKeys.some((k) => k === null)) return null;
    return [...new Set(armKeys.flat().filter((k): k is string => k !== null))];
  }
  return null; // union, primitive, lazy-at-root, … — not a single object shape
}

/**
 * Checks whether a row schema declares only write values that can cross JSON serialization boundaries losslessly.
 * (Writes are intentionally restricted to just JSON-serialisable objects for maximum environment compatibility.)
 *
 * Run this once when constructing a schema-bound writer, proxy, or storage adapter. It proves the declared write
 * surface is JSON-roundtrip-compatible before any payload is accepted.
 *
 * This catches declared non-JSON types such as `z.date()`, `z.bigint()`, `z.map()`, `z.set()`, `z.nan()`,
 * non-JSON literals, typed non-JSON catchalls, and branches that cannot be proven JSON-safe.
 *
 * Open schemas (Zod passthrough/loose) are allowed here because openness is not itself unsafe. Actual extra
 * values are checked per write by `validateWritePayloadValues`.
 *
 * @example
 * validateWritePayloadSchema(z.object({ id: z.string(), at: z.date() }));
 * // -> [{ kind: "unsupported", reason: "non_json_type", path: "at", declaredType: "date", message: "Schema declares a non-JSON type 'date' at 'at'." }]
 */
export function validateWritePayloadSchema(
  schema: ZodType,
): WritePayloadSchemaIssue[] {
  const out: WritePayloadSchemaIssue[] = [];
  if (rootShapeKeys(schema) === null) {
    const rootKind = getZodKind(schema);
    out.push({
      kind: "indeterminate",
      reason: "bad_root_shape",
      declaredType: rootKind,
      message: `Schema root must be a single object shape, got '${rootKind}'.`,
    });
    return out; // a multi-shape / non-object root is decisive — don't also walk its arms
  }
  walkSchema(schema, "", new Set(), out);
  return out;
}

// ─────────────────────────────── unified ───────────────────────────────

/**
 * Compiles the full write-payload JSON-roundtrip validator.
 *
 * By default this checks the schema immediately with `validateWritePayloadSchema` and throws if the declared write
 * surface cannot cross JSON serialization boundaries losslessly. It then returns a per-payload validator backed
 * by `validateWritePayloadValues`.
 *
 * Use this when a caller needs both linked layers: schema safety once, value safety for every write. Pass
 * `{ skipSchemaCheck: true }` only when the schema has already been checked at construction time and this call
 * site only needs the per-write value gate.
 *
 * @example
 * const validate = compileValidateWritePayload(schema);
 * const issues = validate(payload);
 */
export function compileValidateWritePayload(
  schema: ZodType,
  options?: { skipSchemaCheck?: boolean },
): (payload: WritePayload<any>) => WritePayloadValidationIssue[] {
  if (!options?.skipSchemaCheck) {
    const schemaIssues = validateWritePayloadSchema(schema);
    if (schemaIssues.length > 0) {
      const first = schemaIssues[0]!;
      throw new Error(
        `compileValidateWritePayload: schema cannot losslessly round-trip JSON — ${first.message}`,
      );
    }
  }
  return (payload) => validateWritePayloadValues(payload);
}
