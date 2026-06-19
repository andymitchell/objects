import { type ZodIssue } from "zod";
import type {
  ArrayElement,
  ArrayProperty,
  DotPropPathToObjectArraySpreadingArrays,
  DotPropPathValidArrayValue,
  NonObjectArrayProperty,
  NumberProperty,
} from "../dot-prop-paths/types.js";
import type {
  UpdatingMethod,
  WhereFilterDefinition,
} from "../where-filter/types.js";
import { type PrimaryKeyValue } from "../utils/getKeyValue.js";
import type { JsonValueCapped } from "@andyrmitchell/utils/clone-to-json-safe";

export type WritePayloadCreate<W extends Record<string, any>> = {
  type: "create";
  data: W;
};
export type WritePayloadUpdate<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  type: "update";
  data: Partial<Pick<W, NonObjectArrayProperty<W>>>; // Updating whole arrays is forbidden, use array_scope instead. Why? This would require the whole array to be 'set', even if its likely only a tiny part needs to change, and that makes it very hard for CRDTs to reconcile what to overwrite. One solution could be enable this by allowing it to 'diff' it against the client's current cached version to see what has changed, and convert it into array_scope actions internally. The downside, other than an additional layer of uncertainty of how a bug might sneak in (e.g. if cache is somehow not as expected at point of write), is it forces the application code to start editing arrays before passing it to an 'update' rather than directly describing the change... it's more verbose. (Also related: #VALUE_TO_DELETE_KEY).
  where: WhereFilterDefinition<WF>;
  method?: UpdatingMethod;
};
export type WritePayloadArrayScope<
  T extends Record<string, any>,
  P extends DotPropPathToObjectArraySpreadingArrays<T> =
    DotPropPathToObjectArraySpreadingArrays<T>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = {
  type: "array_scope";
  scope: P;
  // IS IT FAILING TO SPOT TYPES? YOU MUST SPECIFY THE 'P' GENERIC IN THE TYPE, OR IT FAILS. IT CANNOT PROPERLY INFER FROM 'scope'. OR USE HELPER assertWriteArrayScope
  action: WritePayload<DotPropPathValidArrayValue<T, P>>;
  where: WhereFilterDefinition<WF>;
};
export type WritePayloadDelete<WF extends Record<string, any>> = {
  type: "delete";
  where: WhereFilterDefinition<WF>;
};

/** Mapped-type-to-union: one variant per array property. Discriminated on `path`. */
export type WritePayloadAddToSet<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  [P in ArrayProperty<W>]: {
    type: "add_to_set";
    path: P;
    items: ArrayElement<W, P>[];
    unique_by: "deep_equals" | "pk";
    where: WhereFilterDefinition<WF>;
  };
}[ArrayProperty<W>];

export type WritePayloadPush<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  [P in ArrayProperty<W>]: {
    type: "push";
    path: P;
    items: ArrayElement<W, P>[];
    where: WhereFilterDefinition<WF>;
  };
}[ArrayProperty<W>];

/** Pull: conditional items_where based on array element type.
 *  Object arrays → WhereFilterDefinition. Scalar arrays → value list (like $pullAll). */
export type WritePayloadPull<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  [P in ArrayProperty<W>]: {
    type: "pull";
    path: P;
    items_where: ArrayElement<W, P> extends Record<string, any>
      ? WhereFilterDefinition<ArrayElement<W, P>>
      : ArrayElement<W, P>[];
    where: WhereFilterDefinition<WF>;
  };
}[ArrayProperty<W>];

export type WritePayloadInc<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  type: "inc";
  path: NumberProperty<W>;
  amount: number;
  where: WhereFilterDefinition<WF>;
};

export type WritePayload<
  T extends Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> =
  | WritePayloadCreate<W>
  | WritePayloadUpdate<W, WF>
  | WritePayloadDelete<WF>
  | WritePayloadArrayScope<T, DotPropPathToObjectArraySpreadingArrays<T>, W, WF>
  | WritePayloadAddToSet<W, WF>
  | WritePayloadPush<W, WF>
  | WritePayloadPull<W, WF>
  | WritePayloadInc<W, WF>;
/**
 * An instruction to modify an object, using CRUD-inspired verbs.
 *
 * The only peculiar one is `array_scope` where every nested list can be treated atomically by first targetting/scoping it,
 * then applying the action at that level. It allows more granular behaviour.
 *
 * @example
 * const a:WriteAction<{id:number}> = {
 *  type: 'write',
 *  ts: Date.now(),
 *  uuid: uuidv4(),
 *  payload: {
 *     type: 'create',
 *     data: {
 *         id: '1'
 *     }
 *  }
 * }
 */
export type WriteAction<
  T extends Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = {
  type: "write";
  ts: number;
  uuid: string;
  payload: WritePayload<T, W, WF>;
};

// ─── Error Types ───

/**
 * Categorised error from a write action. Discriminated union on `type`.
 *
 * @example
 * if (error.type === 'schema') console.log(error.issues);
 */
export type WriteError =
  | { type: "custom"; message?: string }
  | {
      type: "schema";
      issues: ZodIssue[];
      /** The (Zod) schema that is a jsonified `TreeNode`. `TreeNode` was replaced by JsonValueCapped because consumers (like ICollection) need the errors to be fully serialisable, and TreeNode had a) a Zod schema on it, b) a potentially-cyclical parent */
      serialised_schema?: JsonValueCapped;
    }
  | {
      type: "missing_key";
      primary_key: string | number | symbol;
    }
  | {
      type: "update_altered_key";
      primary_key: string | number | symbol;
    }
  | {
      type: "create_duplicated_key";
      primary_key: string | number | symbol;
    }
  | {
      /**
       * Two actions carry the same `uuid` but non-equivalent payloads. Detected in two places:
       * within a single batch by this library (the same uuid submitted twice with differing payloads),
       * or across calls by a store's idempotency ledger (a previously-succeeded uuid replayed with a
       * different payload — the store, not this pure library, holds the ledger). Either way the conflicting
       * action is rejected unrecoverably and state is left unchanged. See ICollection `dec-write-uuid-idempotent`.
       */
      type: "uuid_conflict";
      /** The `uuid` shared by the conflicting actions. */
      uuid: string;
    }
  | {
      /**
       * The action's `where` clause is invalid against the schema — it references a field that
       * doesn't exist, carries a value whose primitive type contradicts the field, or contains a
       * non-finite number. Caught before any mutation; the action is rejected unrecoverably and
       * state is left unchanged. Distinct from `schema` (which is about the written *data*).
       */
      type: "invalid_filter";
      /** The offending dot-prop path within the `where`, when one field can be singled out. */
      where_path?: string;
      /** Why the `where` was rejected. */
      reason: "unknown_field" | "type_mismatch" | "non_finite" | "malformed";
    }
  | {
      /**
       * A written *data* value cannot losslessly round-trip JSON — a non-finite number (`NaN`/`±Infinity`,
       * which serialises to `null`) or a non-JSON carrier (`bigint`/`symbol`/`function`/`Date`/`Map`/…).
       * Caught before any mutation; the action is rejected unrecoverably and state is left unchanged.
       * Distinct from `schema` (a Zod constraint violation on a declared field) and `invalid_filter` (a
       * `where`-clause fault). A value can pass the Zod schema but still be non-JSON-safe because .passthrough()
       * and .loose() preserve extra, undeclared fields that the schema would otherwise miss.
       */
      type: "invalid_data_value";
      /** The dot-prop path to the offending value within the payload's data, when one can be singled out. */
      data_path?: string;
      /** Why the value cannot be persisted as JSON. */
      reason: "non_finite" | "malformed";
    }
  | {
      /** The action did not run: an earlier action in the same batch failed and blocked it. */
      type: "blocked";
      /** `uuid` of the earlier action whose failure blocked this one. */
      blocked_by_action_uuid: string;
    };

/**
 * A `WriteError` enriched with the scalar locator (`item_pk`) of the item where the error occurred. It carries
 * no item body — only JSON-safe scalars — so it always serialises.
 *
 * @example
 * const ctx: WriteErrorContext = { type: 'missing_key', primary_key: 'id', item_pk: '123' };
 */
export type WriteErrorContext = WriteError & {
  item_pk?: PrimaryKeyValue;
};

// ─── Affected Items ───

/**
 * An item affected by a write action. Unified type for both success and failure outcomes.
 *
 * @example
 * const affected: WriteAffectedItem<MyItem> = { item_pk: '123', item: myItem };
 */
export type WriteAffectedItem<
  T extends Record<string, any> = Record<string, any>,
> = {
  item_pk: PrimaryKeyValue;
  item?: T;
};

// ─── Per-Action Outcomes (discriminated union on `ok`) ───

// ── *Core variants ──
// The per-action atoms WITHOUT `affected_items` — for boundaries that must not reveal which
// items a write touched (e.g. a proxied or serialised write response). The full variants
// below compose `affected_items` back on, so the two never drift.

/**
 * A write action that completed successfully — without `affected_items`.
 * The boundary-safe atom; `WriteOutcomeOk` composes `affected_items` back on.
 *
 * @example
 * if (outcome.ok) outcome.action_uuid;
 */
export type WriteOutcomeOkCore<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = {
  ok: true;
  /** The submitted action's `uuid` — a boundary-safe identifier. The full action is not echoed here, so the outcome stays serialisable even when the action carried a non-JSON value. */
  action_uuid: string;
};

/**
 * A write action that failed — without `affected_items`. `errors` is always present with at least one entry.
 * The boundary-safe atom; `WriteOutcomeFailed` composes `affected_items` back on.
 *
 * @example
 * if (!outcome.ok) outcome.errors[0].type; // fully narrowed
 */
export type WriteOutcomeFailedCore<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = {
  ok: false;
  /** The `uuid` of the submitted action that failed — a boundary-safe identifier (the action body is not echoed). */
  action_uuid: string;
  /** The action's errors; always at least one. A blocked action carries a single `blocked` error. */
  errors: [WriteErrorContext, ...WriteErrorContext[]];
  /** True if the action can never succeed (e.g. schema violation, permission denied). */
  unrecoverable?: boolean;
  /** Don't retry until this timestamp. */
  back_off_until_ts?: number;
  /** An earlier action failed, blocking this one. */
  blocked_by_action_uuid?: string;
};

/**
 * Outcome of a single write action — without `affected_items`. Discriminated union on `ok`.
 * The boundary-safe atom; `WriteOutcome` composes `affected_items` back on.
 *
 * @example
 * if (!outcome.ok) outcome.errors[0].type; // narrowed to WriteOutcomeFailedCore
 */
export type WriteOutcomeCore<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = WriteOutcomeOkCore<T, W, WF> | WriteOutcomeFailedCore<T, W, WF>;

// ── Full variants (Core + `affected_items`) ──

/**
 * A write action that completed successfully.
 *
 * @example
 * if (outcome.ok) outcome.affected_items?.[0]?.item_pk;
 */
export type WriteOutcomeOk<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = WriteOutcomeOkCore<T, W, WF> & { affected_items?: WriteAffectedItem<T>[] };

/**
 * A write action that failed. `errors` is always present with at least one entry.
 *
 * @example
 * if (!outcome.ok) outcome.errors[0].type; // fully narrowed
 */
export type WriteOutcomeFailed<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = WriteOutcomeFailedCore<T, W, WF> & {
  affected_items?: WriteAffectedItem<T>[];
  /**
   * The resolved post-merge item that violated the schema — an in-process diagnostic for logging.
   * Holds the offending value as-is (which may be non-JSON), so it never crosses a serialisation
   * boundary: the `*Core` projection drops it, and a logger redacts it when recording.
   */
  tested_item?: T;
};

/**
 * Outcome of a single write action. Discriminated union on `ok`.
 *
 * @example
 * if (!outcome.ok) outcome.errors[0].type; // narrowed to WriteOutcomeFailed
 */
export type WriteOutcome<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = WriteOutcomeOk<T, W, WF> | WriteOutcomeFailed<T, W, WF>;

// ─── Top-Level Result ───

/**
 * Result of applying write actions. NOT a discriminated union — `actions` and other data
 * are always accessible. `ok` is informational.
 *
 * Use `getWriteFailures()` / `getWriteSuccesses()` for filtered, narrowed access.
 *
 * @example
 * if (!result.ok) console.log(result.error?.message);
 * const failures = getWriteFailures(result);
 * failures.forEach(f => f.errors[0].type);
 */
export type WriteResult<
  T extends Record<string, any> = Record<string, any>,
  W extends Record<string, any> = T,
  WF extends Record<string, any> = T,
> = {
  ok: boolean;
  /** All action outcomes in execution order. */
  actions: WriteOutcome<T, W, WF>[];
  /** Lightweight summary; only present when `ok` is false. */
  error?: { message: string };
};
