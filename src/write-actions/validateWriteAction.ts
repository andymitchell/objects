import type { ZodType } from "zod";
import type { WriteAction, WriteError, WritePayload } from "./types.ts";
import { validateWritePayloadValues } from "./validateWritePayload.ts";
import { compileValidateWhereFilter } from "../where-filter/validateWhereFilter.ts";
import { collectActionWhereIssues } from "./collectActionWhereIssues.ts";

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
 * An empty array means the action is valid. The `where` check spans the WHOLE filter tree — the top-level
 * `where` AND nested `array_scope.action.where` / `pull.items_where` at any depth (via `collectActionWhereIssues`,
 * shared with the write engine's preflight so both reject identically) — so the gate is complete: a store can
 * rely on the cleared action's entire `payload` being JSON-roundtrippable, every nested operand included.
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

  // 2. `where` across the whole tree — the top-level `where` plus nested `array_scope.action.where` /
  //    `pull.items_where` — sharing the engine's recursion. The root validator is compiled once and reused down
  //    the tree; a create carries no `where`, so this is a no-op for it.
  for (const issue of collectActionWhereIssues(payload, schema, compileValidateWhereFilter(schema, options), options)) {
    errors.push({ type: "invalid_filter", reason: issue.reason, where_path: issue.path });
  }

  return errors;
}
