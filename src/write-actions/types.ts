import { type ZodIssue } from "zod";
import type {
  ArrayElement,
  ArrayProperty,
  DotPropPathToObjectArraySpreadingArrays,
  DotPropPathToOptionalProperty,
  DotPropPathToUndefinableProperty,
  DotPropPathValidArrayValue,
  NonObjectArrayProperty,
  NumberProperty,
} from "../dot-prop-paths/types.js";
import type {
  UpdatingMethod,
  WhereFilterDefinition,
} from "../where-filter/types.js";
import { type PrimaryKeyValue } from "../utils/getKeyValue.js";
import type { JsonValueCapped } from "@andymitchell/clone-to-json-safe";
import type { ArrayScopeRejectionReason } from "./arrayScopeResolution.ts";
import type { PropertyPathRejectionReason } from "./propertyPathResolution.ts";

export type WritePayloadCreate<W extends Record<string, any>> = {
  type: "create";
  /**
   * The whole new item.
   *
   * A key may be omitted wherever the shape allows it, but no key may be given the value `undefined`: a write
   * action is a JSON document, and `JSON.stringify` erases such a key, so the action would define a different
   * item after a round trip. Omitting the key says the same thing and survives the journey. A field whose type
   * is `string | undefined` therefore has to be given a real value here — its empty state belongs to
   * `set_property_undefined`, once the item exists.
   *
   * Only the top level of this restriction is expressed in the type. A nested `undefined` still compiles; the
   * write is rejected at runtime, at any depth, before anything is stored.
   */
  data: { [K in keyof W]: Exclude<W[K], undefined> };
};
export type WritePayloadUpdate<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  type: "update";
  /**
   * The fields to change on every matched item. Omitting a key leaves it untouched.
   *
   * No key may be given the value `undefined`. A write action is a JSON document, and `JSON.stringify` erases
   * such a key, so an update carrying one would arrive as a request to change nothing at all. Clearing a
   * property's value is `set_property_undefined` and removing it is `delete_property` — both name the intention
   * outright, and both survive serialisation.
   *
   * Only the top level of that restriction is expressed in the type. A nested `undefined` still compiles; the
   * write is rejected at runtime, at any depth, before anything is stored.
   *
   * A key holding an array of objects is not offered. Setting one would replace the array wholesale, which
   * asks the caller to edit arrays before describing the change and leaves a CRDT with no way to tell an
   * intentional overwrite from a stale cache; `array_scope` describes the change to individual elements
   * instead. A scalar array can be set, because replacing it carries no such ambiguity.
   */
  data: { [K in NonObjectArrayProperty<W>]?: Exclude<W[K], undefined> };
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

/* ─── Property-targeting verbs: clearing a value, and removing a key ───
 *
 * A write action is a JSON document, and JSON has no `undefined` — `JSON.stringify({x: undefined})` is
 * `"{}"`, so a payload carrying it would mean something different after a round trip. An `update` is also
 * partial by omission, which leaves "remove this key" with no spelling at all. These two verbs give both
 * intentions a name that survives serialisation.
 *
 * They differ in exactly one respect, and it is a real one: `set_property_undefined` leaves the key present
 * holding `undefined`, while `delete_property` takes the key away. Under `exactOptionalPropertyTypes` those
 * are separate permissions on a type, and `'x' in item` and `Object.keys(item)` tell them apart at runtime.
 *
 * Both `path`s use the escaped dot-prop grammar (`rank\.value` is one key named `rank.value`). A path may
 * cross nested objects and records but never an array — an array's contents are edited by scoping into it
 * with `array_scope`, inside which these verbs work on each element. A leaf holding an array of objects is
 * not offered, for the same reason `update` refuses to replace one.
 */

/**
 * Clears one property's value on every matched item: the key stays present, its value becomes `undefined`.
 *
 * Use it to say "this property has no value right now" while keeping the property itself part of the item.
 * `path` names the property, `where` selects the items. Only paths whose declared type admits `undefined`
 * are offered — a field declared `string | undefined` or `.optional()` qualifies; a plain required field
 * does not.
 *
 * @example
 * const clearNickname: WritePayloadSetPropertyUndefined<User> = {
 *   type: 'set_property_undefined',
 *   path: 'profile.nickname',
 *   where: { id: '1' },
 * };
 *
 * @remarks
 * The verb alters an existing property and never creates structure. A key that is already absent is left
 * absent, and a missing object on the way to it is not materialised; both outcomes are a successful no-op
 * that leaves the item untouched.
 *
 * The difference from {@link WritePayloadDeleteProperty} is invisible to most observers: an `$exists` filter
 * reads both states as absent, deep equality treats a present-`undefined` key as no key, and serialising the
 * ITEM to JSON drops it — so across any JSON boundary this verb collapses into `delete_property`. Only
 * in-memory JavaScript (`in`, `Object.keys`) sees the distinction, which is what makes it worth expressing
 * when the item stays in the process.
 */
export type WritePayloadSetPropertyUndefined<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  type: "set_property_undefined";
  /** Escaped dot-prop path to the property whose value is cleared. */
  path: DotPropPathToUndefinableProperty<W>;
  where: WhereFilterDefinition<WF>;
};

/**
 * Removes one property from every matched item: the key itself is gone afterwards.
 *
 * Use it to say "this item has no such property". `path` names the property, `where` selects the items.
 * Only paths whose key may legally be absent are offered — an optional field or any key of a record
 * qualifies; a required field does not, because the item would no longer match its own schema.
 *
 * @example
 * const dropNickname: WritePayloadDeleteProperty<User> = {
 *   type: 'delete_property',
 *   path: 'profile.nickname',
 *   where: { id: '1' },
 * };
 *
 * @remarks
 * The verb alters an existing property and never creates structure. A key that is already absent, or one
 * whose parent object is missing, is a successful no-op that leaves the item untouched.
 *
 * This is the verb to reach for whenever the item is persisted or sent anywhere, because it is the one whose
 * effect survives JSON — see {@link WritePayloadSetPropertyUndefined} for the distinction between them.
 */
export type WritePayloadDeleteProperty<
  W extends Record<string, any>,
  WF extends Record<string, any> = W,
> = {
  type: "delete_property";
  /** Escaped dot-prop path to the property that is removed. */
  path: DotPropPathToOptionalProperty<W>;
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
  | WritePayloadInc<W, WF>
  | WritePayloadSetPropertyUndefined<W, WF>
  | WritePayloadDeleteProperty<W, WF>;
/**
 * An instruction to modify an object, described as a JSON document rather than performed as a mutation.
 *
 * The `payload` names one verb and the items it applies to. `create`, `update` and `delete` are the familiar
 * three; `push`, `pull` and `add_to_set` edit an array property; `inc` moves a number by a relative amount;
 * and `set_property_undefined`/`delete_property` clear one property's value or remove the property outright.
 *
 * `array_scope` is the one that needs explaining. Rather than describing a change to a whole nested list, it
 * targets the list and applies another payload at that level, so each element is written on its own terms.
 *
 * Describing the change rather than making it is what lets an action be built in one place, stored or sent,
 * and applied in another — so every field has to survive JSON.
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
  | { type: "custom"; message?: string | undefined }
  | {
      type: "schema";
      issues: ZodIssue[];
      /** The (Zod) schema that is a jsonified `TreeNode`. `TreeNode` was replaced by JsonValueCapped because consumers (like ICollection) need the errors to be fully serialisable, and TreeNode had a) a Zod schema on it, b) a potentially-cyclical parent */
      serialised_schema?: JsonValueCapped | undefined;
    }
  | {
      type: "missing_key";
      primary_key: string | number | symbol;
    }
  | {
      /**
       * An update's `data` named the primary key with a value other than the one the matched row already
       * carries. Every row is located, reported and reconciled by that key, so an update may not move it —
       * a falsy value least of all, which would leave the row with no usable key for the rest of the batch
       * or for the caller after it. Writing the key's own current value back is no alteration, and the row
       * still reports as updated. The row's actual key travels as `item_pk` (see {@link WriteErrorContext}).
       * On create the same falsy value is `missing_key` instead: there the payload IS the item, so it has no
       * key to keep rather than one it is trying to change.
       */
      type: "update_altered_key";
      /** The name of the key the update tried to change. */
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
      where_path?: string | undefined;
      /** Why the `where` was rejected. */
      reason: "unknown_field" | "type_mismatch" | "non_finite" | "malformed";
    }
  | {
      /**
       * The action's `array_scope.scope` can never be a valid write target: a segment is
       * `__proto__`/`prototype`/`constructor` (which the runtime property reader refuses to traverse),
       * the schema declares no field at the path, or the path resolves to something other than an array
       * of objects. Caught before any mutation; the action is rejected unrecoverably and state is left
       * unchanged. Distinct from `invalid_filter` (a `where`-clause fault): the scope names the write
       * TARGET, not a match condition.
       */
      type: "invalid_scope";
      /** The rejected scope, prefix-joined from the action root when the fault is in a nested `array_scope` (e.g. `children.nope`). */
      scope: string;
      /** Why the scope cannot be written through. */
      reason: ArrayScopeRejectionReason;
    }
  | {
      /**
       * A written *data* value cannot losslessly round-trip JSON — a non-finite number (`NaN`/`±Infinity`,
       * which serialises to `null`), a non-JSON carrier (`bigint`/`symbol`/`function`/`Date`/`Map`/…), or an
       * explicit `undefined` in a create's or update's `data` (the key simply vanishes). Caught before any
       * mutation; the action is rejected unrecoverably and state is left unchanged. Distinct from `schema` (a
       * Zod constraint violation on a declared field) and `invalid_filter` (a `where`-clause fault). A value
       * can pass the Zod schema but still be non-JSON-safe because .passthrough() and .loose() preserve extra,
       * undeclared fields that the schema would otherwise miss.
       */
      type: "invalid_data_value";
      /** The dot-prop path to the offending value within the payload's data, when one can be singled out. */
      data_path?: string | undefined;
      /** Why the value cannot be persisted as JSON. */
      reason: "non_finite" | "malformed";
      /**
       * Guidance for the caller when the fault has a specific remedy, such as the verb that expresses what an
       * explicit `undefined` was reaching for. Never quotes the offending value, so the error stays safe to log.
       */
      message?: string | undefined;
    }
  | {
      /**
       * The action's `path` can never be a valid write target. For `set_property_undefined`/`delete_property`:
       * a segment is empty or `__proto__`/`prototype`/`constructor`, the schema declares no property there,
       * the path crosses an array, or the property exists but the schema will not let this verb change it
       * (a required key cannot be removed; a field that does not store `undefined` cannot be cleared). For
       * those verbs and for `inc` alike: the path names the row's primary key, which locates the row and is
       * therefore refused whatever the schema permits. Caught before any mutation; the action is rejected
       * unrecoverably and state is left unchanged. Distinct from `invalid_scope` (which names an array to
       * write INTO) and `invalid_filter` (a `where` fault): this names the single property being written.
       */
      type: "invalid_property_path";
      /**
       * The rejected path, prefix-joined from the action root when the fault is in a nested `array_scope`
       * (e.g. `children.nope`), and always spelled in the escaped dot-prop grammar — a key holding a literal
       * dot reads as `a\.b`, whichever grammar the verb's own `path` uses.
       */
      path: string;
      /** Why the property cannot be written through. */
      reason: PropertyPathRejectionReason;
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
  unrecoverable?: boolean | undefined;
  /** Don't retry until this timestamp. */
  back_off_until_ts?: number | undefined;
  /** An earlier action failed, blocking this one. */
  blocked_by_action_uuid?: string | undefined;
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
> = WriteOutcomeOkCore<T, W, WF> & { affected_items?: WriteAffectedItem<T>[] | undefined };

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
  affected_items?: WriteAffectedItem<T>[] | undefined;
  /**
   * The resolved post-merge item that violated the schema — an in-process diagnostic for logging.
   * Holds the offending value as-is (which may be non-JSON), so it never crosses a serialisation
   * boundary: the `*Core` projection drops it, and a logger redacts it when recording.
   */
  tested_item?: T | undefined;
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
  error?: { message: string } | undefined;
};
