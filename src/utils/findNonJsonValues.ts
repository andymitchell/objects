/**
 * **SerialisableJsonSubset** — the subset of values (write-payload values and `where` filter operands) that
 * survives a lossless JSON round-trip (`deepEquals(x, JSON.parse(JSON.stringify(x)))`). It excludes every
 * non-finite number (`NaN`/`±Infinity`, which `JSON.stringify` rewrites to `null`) and every non-JSON carrier
 * (`Date`/`bigint`/`Map`/`Set`/`Symbol`/`RegExp`/class instance — no faithful JSON form). It is the single
 * concept behind two *opt-in* restrictions: the write engine's payload value-gate (`validateWritePayload`) and
 * the `where`-operand gate (`validateWhereFilter`'s `requireSerialisableJsonSubset`). `WhereFilterDefinition`
 * and the bare matcher still permit these values; the narrowing is engaged only by consumers that cross a
 * serialisation boundary (e.g. a stacking ICollection forwarding a write over `fetch`, or recording a write's
 * `payload` in an idempotency ledger in JSON-roundtripped form).
 *
 * `undefined` is the one position-dependent case: in a write-payload *value* it is permitted (an absent key
 * reads back as `undefined`, so it round-trips as "missing"); in a `where` operand it is excluded (`JSON.stringify`
 * drops the key, degrading `{ field: undefined }` to a match-all `{}`). Callers select via `flagUndefined`.
 *
 * Why a single walk: the two gates must agree on what "JSON-safe" means, so the predicate is defined once here
 * — a divergence would let a value pass one boundary and corrupt at the other.
 */

/** Why a walked value cannot losslessly round-trip JSON. Shared by the write-payload value-gate and the `where`-operand gate. */
export type NonJsonValueReason = "non_finite" | "malformed";

/** One non-serialisable value found by {@link findNonJsonValues}, located by its dot-path beneath the walk root (omitted at the root). */
export type NonJsonValueIssue = { reason: NonJsonValueReason; path?: string };

/**
 * Collect EVERY value under `value` that cannot losslessly round-trip JSON — the `SerialisableJsonSubset` walk.
 * Schema-independent (walks the live data), so it catches values an open `.passthrough()`/`.loose()` schema
 * admits. Plain objects/arrays are traversed; a non-finite number is `non_finite`; a `Date`/`Map`/`Set`/`RegExp`/
 * `bigint`/`symbol`/`function`/class instance is `malformed`. `null` and JSON primitives are safe. `undefined`
 * is safe unless `flagUndefined` (set by the `where`-operand gate, where a dropped key silently changes the
 * match set). Collects all faults (not first-only) so a caller can surface every one at once.
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
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push({ reason: "non_finite", path: path || undefined });
    return;
  }
  if (value === null) return;
  if (value === undefined) {
    if (opts?.flagUndefined) out.push({ reason: "malformed", path: path || undefined });
    return;
  }
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "bigint" || t === "symbol" || t === "function") {
    out.push({ reason: "malformed", path: path || undefined });
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) findNonJsonValues(value[i], path ? `${path}.${i}` : String(i), out, opts);
    return;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      out.push({ reason: "malformed", path: path || undefined }); // Date/Map/Set/RegExp/class instance — not a plain object
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      findNonJsonValues(child, path ? `${path}.${key}` : key, out, opts);
    }
    return;
  }
  out.push({ reason: "malformed", path: path || undefined }); // any other exotic typeof
}
