/**
 * **SerialisableJsonSubset** — the subset of values (write-payload values and `where` filter operands) that
 * survives a lossless JSON round-trip (`deepEquals(x, JSON.parse(JSON.stringify(x)))`). It excludes every
 * non-finite number (`NaN`/`±Infinity`, which `JSON.stringify` rewrites to `null`) and every non-JSON carrier
 * (`Date`/`bigint`/`Map`/`Set`/`Symbol`/`RegExp`/class instance — no faithful JSON form), along with a structure that
 * leads back into itself, which `JSON.stringify` refuses outright. It is the single
 * concept behind two *opt-in* restrictions: the write engine's payload value-gate (`validateWritePayload`) and
 * the `where`-operand gate (`validateWhereFilter`'s `requireSerialisableJsonSubset`). `WhereFilterDefinition`
 * and the bare matcher still permit these values; the narrowing is engaged only by consumers that cross a
 * serialisation boundary (e.g. a stacking ICollection forwarding a write over `fetch`, or recording a write's
 * `payload` in an idempotency ledger in JSON-roundtripped form).
 *
 * `undefined` is the one position-dependent case, because what a dropped key degrades INTO differs by position:
 * a `where` operand becomes a match-all (`{ field: undefined }` → `{}`, a wider match set) and a written value
 * becomes an untouched key (a narrower write). Both are silent changes of meaning, so both gates exclude it; a
 * position where an absent key is genuinely equivalent — a list of items already compared by deep equality —
 * does not. Callers select via `flagUndefined`.
 *
 * Why a single walk: the two gates must agree on what "JSON-safe" means, so the predicate is defined once here
 * — a divergence would let a value pass one boundary and corrupt at the other.
 */

import { joinDotpropPath } from "../dot-prop-paths/joinDotpropPath.ts";
import { escapeDotPropPathSegment } from "../dot-prop-paths/dotPropPathSegments.ts";

/** Why a walked value cannot losslessly round-trip JSON. Shared by the write-payload value-gate and the `where`-operand gate. */
export type NonJsonValueReason = "non_finite" | "malformed";

/**
 * One non-serialisable value found by {@link findNonJsonValues}, located by its dot-path beneath the walk root
 * (`undefined` at the root). The path is written in the dot-prop grammar — a key holding a literal dot is escaped
 * — so `parseDotPropPathSegments` reads back the keys that were actually walked.
 */
export type NonJsonValueIssue = {
  reason: NonJsonValueReason;
  path?: string | undefined;
  /**
   * Set when the offending value is an explicit `undefined` — only reachable under `flagUndefined`. The
   * reason stays `malformed`, because a caller's error vocabulary should not fork over it; this marks the
   * one fault whose remedy is about how to spell the intent rather than which JSON type to use.
   */
  undefined_value?: true;
};

/**
 * Collect EVERY value under `value` that cannot losslessly round-trip JSON — the `SerialisableJsonSubset` walk.
 * Schema-independent (walks the live data), so it catches values an open `.passthrough()`/`.loose()` schema
 * admits. Plain objects/arrays are traversed; a non-finite number is `non_finite`; a `Date`/`Map`/`Set`/`RegExp`/
 * `bigint`/`symbol`/`function`/class instance is `malformed`, as is a value that leads back into itself. `null` and
 * JSON primitives are safe. `undefined` is safe unless `flagUndefined`, which reports it as `malformed` and
 * additionally marks the issue `undefined_value` so a caller can offer a remedy specific to it. Collects all faults
 * (not first-only) so a caller can surface every one at once.
 *
 * @remarks
 * One value named in two places is not a loop and is safe: JSON writes it out twice, and both copies read back what
 * was written. Only a value reached from inside itself is refused, and the walk answers rather than recursing on.
 *
 * @example
 * const out: NonJsonValueIssue[] = [];
 * findNonJsonValues({ n: Infinity, when: new Date() }, "", out);
 * // out -> [{ reason: 'non_finite', path: 'n' }, { reason: 'malformed', path: 'when' }]
 */
export function findNonJsonValues(
  value: unknown,
  path: string,
  out: NonJsonValueIssue[],
  opts?: { flagUndefined?: boolean },
): void {
  walkValue(value, path, out, opts, new Set());
}

/**
 * One step of the walk. `enclosing` holds the containers currently being walked THROUGH — added on the way down
 * and removed on the way back up — so a value that leads back into itself is caught while a value merely named
 * twice is not: `JSON.stringify` writes a repeated value out twice and throws only on a loop.
 */
function walkValue(
  value: unknown,
  path: string,
  out: NonJsonValueIssue[],
  opts: { flagUndefined?: boolean } | undefined,
  enclosing: Set<object>,
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push({ reason: "non_finite", path: path || undefined });
    return;
  }
  if (value === null) return;
  if (value === undefined) {
    if (opts?.flagUndefined) out.push({ reason: "malformed", path: path || undefined, undefined_value: true });
    return;
  }
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "bigint" || t === "symbol" || t === "function") {
    out.push({ reason: "malformed", path: path || undefined });
    return;
  }
  if (enclosing.has(value as object)) {
    out.push({ reason: "malformed", path: path || undefined }); // leads back into itself — JSON.stringify throws
    return;
  }
  if (Array.isArray(value)) {
    enclosing.add(value);
    for (let i = 0; i < value.length; i++) walkValue(value[i], joinDotpropPath(path, String(i)), out, opts, enclosing);
    enclosing.delete(value);
    return;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      out.push({ reason: "malformed", path: path || undefined }); // Date/Map/Set/RegExp/class instance — not a plain object
      return;
    }
    enclosing.add(value as object);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walkValue(child, joinDotpropPath(path, escapeDotPropPathSegment(key)), out, opts, enclosing);
    }
    enclosing.delete(value as object);
    return;
  }
  out.push({ reason: "malformed", path: path || undefined }); // any other exotic typeof
}
