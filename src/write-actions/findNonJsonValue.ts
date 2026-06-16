/**
 * Write-time JSON-safety gate for *written data* — the value-side complement to the `where`-side finiteness
 * gate in `validateWhereFilter`. A value stored into a JSON substrate must survive
 * `JSON.parse(JSON.stringify(value))`; this classifies the values that cannot, so the write engine (and any
 * pre-serialization layer, e.g. a fetch-boundary proxy) rejects them as a clean per-action `invalid_data_value`
 * rather than corrupting state or throwing.
 */

import type { WritePayload } from "./types.ts";

/** Why a value cannot losslessly round-trip JSON: a precise non-finite number, or any other non-JSON carrier. */
export type NonJsonReason = "non_finite" | "malformed";

/**
 * Find the first value that cannot be safely preserved by a JSON round trip.
 *
 * Returns the invalid value's reason and dot-separated path, or `null` when
 * the entire value is JSON-safe.
 *
 * Arrays are traversed using numeric path segments, such as `items.0`.
 * Only plain objects are traversed. Values such as `Date`, `Map`, `Set`,
 * `RegExp`, and class instances are rejected.
 *
 * This is the internal walker used by:
 * - `findNonJsonValue`, which returns only the failure reason.
 * - `findNonJsonValueInPayload`, which adds the returned path to the
 *   surrounding payload path.
 */
function findNonJson(
  value: unknown,
  path: string,
): { reason: NonJsonReason; path: string } | null {
  if (typeof value === "number")
    return Number.isFinite(value) ? null : { reason: "non_finite", path };
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return null;
  if (t === "bigint" || t === "symbol" || t === "function")
    return { reason: "malformed", path };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findNonJson(value[i], path ? `${path}.${i}` : String(i));
      if (found) return found;
    }
    return null;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      return { reason: "malformed", path }; // Date/Map/Set/RegExp/class instance — not a plain object
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const found = findNonJson(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return null;
  }
  return { reason: "malformed", path }; // any other exotic typeof
}

/**
 * Check whether a value can be preserved by:
 *
 * `JSON.parse(JSON.stringify(value))`
 *
 * Returns:
 * - `'non_finite'` for `NaN`, `Infinity`, or `-Infinity`, because JSON
 *   serializes them as `null` and silently changes the data.
 * - `'malformed'` for unsupported JSON values such as `bigint`, `symbol`,
 *   functions, `Date`, `Map`, `Set`, `RegExp`, and class instances.
 * - `null` when the value is JSON-safe.
 *
 * Arrays and plain objects are checked recursively.
 *
 * `undefined` is treated as valid by this check, as are JSON primitives,
 * `null`, `-0`, and arrays or plain objects containing valid values.
 *
 * @example
 * findNonJsonValue(Infinity);         // 'non_finite'
 * findNonJsonValue(new Date());       // 'malformed'
 * findNonJsonValue({ a: [1, 2n] });   // 'malformed'
 * findNonJsonValue({ a: 1, b: "x" }); // null
 */
export function findNonJsonValue(value: unknown): NonJsonReason | null {
  return findNonJson(value, "")?.reason ?? null;
}

/**
 * Find the first value written by a Write payload that cannot be safely preserved
 * by a JSON round trip.
 *
 * Returns the invalid value's reason and data path, or `null` when all written
 * values are JSON-safe.
 *
 * This check runs before a write is applied or serialized. It allows the write
 * engine and transport layers, such as a fetch proxy, to reject invalid data as
 * an `invalid_data_value` action fault instead of:
 *
 * - silently removing or changing the value; or
 * - allowing `JSON.stringify` to throw an unexpected error.
 *
 * Only payload fields that write data are inspected:
 *
 * - `create` and `update`: `data`
 * - `inc`: `amount`
 * - `push` and `add_to_set`: `items`
 * - `array_scope`: the nested action, recursively
 *
 * `delete` and `pull` are not inspected because they do not contain values to
 * be written.
 *
 * The payload's `where` filter is not checked here. It is validated separately
 * by `validateWhereFilter`.
 *
 * @returns An object containing:
 * - `reason`: why the value is not JSON-safe
 * - `data_path`: the dot-separated location of the value, omitted when the
 *   invalid value is at the payload's data root
 *
 * Returns `null` when all written values are JSON-safe.
 *
 * @example
 * findNonJsonValueInPayload({
 *     type: "create",
 *     data: { id: "x", n: Infinity },
 * });
 * // { reason: "non_finite", data_path: "n" }
 */
export function findNonJsonValueInPayload<T extends Record<string, any>>(
  payload: WritePayload<T>,
): { reason: NonJsonReason; data_path?: string } | null {
  switch (payload.type) {
    case "create":
    case "update": {
      const found = findNonJson(payload.data, "");
      return found ? withPath(found.reason, found.path) : null;
    }
    case "inc": {
      const found = findNonJson(payload.amount, "");
      return found ? withPath(found.reason, String(payload.path)) : null;
    }
    case "push":
    case "add_to_set": {
      const found = findNonJson(payload.items, "");
      return found
        ? withPath(found.reason, joinPath(String(payload.path), found.path))
        : null;
    }
    case "array_scope":
      return findNonJsonValueInPayload(payload.action as WritePayload<any>);
    default:
      return null; // delete / pull carry no written data
  }
}

/** Shape the public result, dropping an empty `data_path` (the value itself was the offending root). */
function withPath(
  reason: NonJsonReason,
  path: string,
): { reason: NonJsonReason; data_path?: string } {
  return path ? { reason, data_path: path } : { reason };
}

/** Join a payload-location prefix onto a walked sub-path (`'tags' + '0'` → `'tags.0'`). */
function joinPath(prefix: string, sub: string): string {
  return sub ? `${prefix}.${sub}` : prefix;
}
