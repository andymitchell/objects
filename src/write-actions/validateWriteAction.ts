import type { ZodType } from "zod";
import type { WriteAction, WriteError, WritePayload } from "./types.ts";
import { validateWritePayloadValues } from "./validateWritePayload.ts";
import { validateWhereFilter } from "../where-filter/validateWhereFilter.ts";

/**
 * Validate a whole `WriteAction` at runtime, before it is accepted — the public entry a store calls up-front so
 * a bad action is rejected (errors-as-values) and never mutates state. It checks both halves of `payload`: the
 * WRITTEN VALUES (create/update `data`, `inc` amount, push/add_to_set `items` — via `validateWritePayloadValues`)
 * and the top-level `where` operands (via `validateWhereFilter`). With `{ requireSerialisableJsonSubset: true }`
 * both halves are held to the `SerialisableJsonSubset` — lossless JSON round-trip — which every ICollection
 * boundary op needs (`dec-data-must-losslessly-roundtrip-json`): a write crosses serialised boundaries and its
 * `payload` (incl. `where`) is recorded in the idempotency ledger in JSON-roundtripped form, so an
 * un-round-trippable operand corrupts a stacking forward and spuriously breaks an honest replay's equivalence.
 *
 * Returns canonical `WriteError`s tagged by source — a written-value fault is `invalid_data_value`, a `where`
 * fault is `invalid_filter` — both reusing the existing `non_finite`/`malformed`/… reasons (no new vocabulary).
 * An empty array means the action is valid. Nested element-level filters (`array_scope.action.where`,
 * `pull.items_where`) are validated by the write engine's own preflight, not here.
 *
 * @example
 * const errs = validateWriteAction(action, schema, { requireSerialisableJsonSubset: true });
 * if (errs.length) return reject(errs); // e.g. [{ type: 'invalid_filter', reason: 'non_finite', where_path: 'rank.$lt' }]
 */
export function validateWriteAction<T extends Record<string, any>>(
  action: WriteAction<T>,
  schema: ZodType<T>,
  options?: { requireSerialisableJsonSubset?: boolean },
): WriteError[] {
  const errors: WriteError[] = [];
  // erased to WritePayload<any>: the value walk is schema-agnostic and reads structurally, and the `where`
  // narrowing below is by discriminant — neither needs the precise generic, which the mapped-type array
  // variants make awkward to thread.
  const payload = action.payload as WritePayload<any>;

  // 1. Written values (create/update data, inc amount, push/add_to_set items; array_scope recurses internally).
  for (const issue of validateWritePayloadValues(payload)) {
    errors.push({ type: "invalid_data_value", reason: issue.reason, data_path: issue.path });
  }

  // 2. Top-level `where` (every verb except `create` carries one).
  if (payload.type !== "create") {
    for (const issue of validateWhereFilter(payload.where, schema, options)) {
      errors.push({ type: "invalid_filter", reason: issue.reason, where_path: issue.path });
    }
  }

  return errors;
}
