import { z } from "zod";
import type {
  WriteAction,
  WriteError,
  WriteErrorContext,
  WriteOutcomeFailed,
} from "../../types.ts";
import type { ListRules } from "../../../ddl/types.ts";
import deepEql from "deep-eql";
import {
  type PrimaryKeyGetter,
  makePrimaryKeyGetter,
} from "../../../utils/getKeyValue.ts";
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import {
  cloneDeepScalarValues,
  type JsonValueCapped,
} from "@andyrmitchell/utils/deep-clone-scalar-values";

/** Error kinds an action can never recover from, however many times it is retried. */
function isUnrecoverable(type: WriteError["type"]): boolean {
  switch (type) {
    case "schema":
    case "missing_key":
    case "create_duplicated_key":
    case "uuid_conflict":
    case "update_altered_key":
    case "permission_denied":
    case "invalid_filter":
      return true;
    case "custom":
    case "blocked":
      return false;
  }
}

export default class WriteActionFailuresTracker<
  T extends Record<string, any>,
> {
  private schema: z.ZodType<T>;
  private failures: WriteOutcomeFailed<T>[];
  private pk: PrimaryKeyGetter<T>;

  // `schema` is `z.ZodType<T>`, not `z.ZodType<T, any, any>`: the 3-arg form does not infer `T`
  // from a passed schema under zod v4 (it falls back to `Record<string, any>`), which would strip
  // per-field item typing from callers that rely on inference. The 1-arg form infers `T` from the
  // schema's output.
  constructor(schema: z.ZodType<T>, rules: ListRules<T>) {
    this.schema = schema;
    this.failures = [];
    this.pk = makePrimaryKeyGetter(rules.primary_key);
  }

  shouldHalt(): boolean {
    return this.length() > 0;
  }

  /** Locate the open failure record for `action`, if one exists. */
  private findAction(
    action: WriteAction<T>,
  ): WriteOutcomeFailed<T> | undefined {
    return this.failures.find((x) => deepEql(x.action, action));
  }

  /**
   * Add `errorDetails` (scoped to `item`) to the failure record for `action`, opening the
   * record if this is its first error. Opening it together with that first error is what
   * keeps `errors` non-empty. Identical errors and identical affected items are de-duplicated.
   */
  private record(
    action: WriteAction<T>,
    item: T,
    errorDetails: WriteError,
  ): void {
    const itemPk = this.pk(item, true);
    const errorContext: WriteErrorContext<T> = {
      ...errorDetails,
      item_pk: itemPk,
      item,
    };

    let failedAction = this.findAction(action);
    if (failedAction) {
      if (!failedAction.errors.some((x) => deepEql(x, errorContext))) {
        failedAction.errors.push(errorContext);
      }
    } else {
      failedAction = {
        ok: false,
        action,
        errors: [errorContext],
        affected_items: [],
      };
      this.failures.push(failedAction);
    }

    // Register the affected item. A no-usable-pk item yields an empty-string pk, so match
    // it by value instead — re-checks of the same item then de-dup.
    if (!failedAction.affected_items) failedAction.affected_items = [];
    const itemKnown = failedAction.affected_items.some((x) =>
      itemPk ? itemPk === x.item_pk : deepEql(x.item, item),
    );
    if (!itemKnown) failedAction.affected_items.push({ item_pk: itemPk, item });

    if (isUnrecoverable(errorDetails.type)) failedAction.unrecoverable = true;
  }

  testSchema(action: WriteAction<T>, item: T): boolean {
    const result = this.schema.safeParse(item);
    if (!result.success) {
      let serialisedSchema: JsonValueCapped | undefined;
      try {
        const serialisedSchemaResult = cloneDeepScalarValues(
          convertSchemaToDotPropPathTree(this.schema, { union_aware: true }).root,
          { skip_circular: true, skip_symbols: true },
        );

        serialisedSchema = JSON.parse(JSON.stringify(serialisedSchemaResult));
      } catch (e) {
        // Serialising the schema is best-effort: a failure here leaves serialised_schema
        // undefined but must never block reporting the schema error itself.
        console.warn(
          "WriteActionFailuresTracker: failed to serialise schema for error reporting",
          e,
        );
      }

      this.record(action, item, {
        type: "schema",
        issues: result.error.issues,
        tested_item: item,
        serialised_schema: serialisedSchema,
      });
    }
    return result.success;
  }

  report(action: WriteAction<T>, item: T, errorDetails: WriteError): void {
    this.record(action, item, errorDetails);
  }

  /**
   * Report an action-level failure that is not tied to a specific item — e.g. an invalid `where`
   * clause, which is rejected before any item is matched (an invalid `where` matches nothing, so
   * there is no item to attach). Mirrors `blocked()`: opens a failure record with no
   * `affected_items`, de-duplicating identical errors.
   */
  reportActionError(action: WriteAction<T>, errorDetails: WriteError): void {
    const errorContext: WriteErrorContext<T> = { ...errorDetails };
    let failedAction = this.findAction(action);
    if (failedAction) {
      if (!failedAction.errors.some((x) => deepEql(x, errorContext))) {
        failedAction.errors.push(errorContext);
      }
    } else {
      failedAction = {
        ok: false,
        action,
        errors: [errorContext],
        affected_items: [],
      };
      this.failures.push(failedAction);
    }
    if (isUnrecoverable(errorDetails.type)) failedAction.unrecoverable = true;
  }

  /**
   * Mark `action` as blocked by an earlier action's failure. A blocked-only action opens a
   * failure record holding a single `blocked` error; re-blocking updates that error and the
   * `blocked_by_action_uuid` field in place, so the latest blocker always wins.
   */
  blocked(action: WriteAction<T>, blocked_by_action_uuid: string): void {
    let failedAction = this.findAction(action);
    if (failedAction) {
      const blockedError = failedAction.errors.find(
        (e) => e.type === "blocked",
      );
      if (blockedError?.type === "blocked") {
        blockedError.blocked_by_action_uuid = blocked_by_action_uuid;
      } else {
        failedAction.errors.push({ type: "blocked", blocked_by_action_uuid });
      }
    } else {
      failedAction = {
        ok: false,
        action,
        errors: [{ type: "blocked", blocked_by_action_uuid }],
        affected_items: [],
      };
      this.failures.push(failedAction);
    }
    failedAction.blocked_by_action_uuid = blocked_by_action_uuid;
  }

  /**
   * Fold a scoped sub-write's failures (e.g. from an `array_scope` recursion) onto the parent action. An
   * item-scoped sub-error re-attaches to its affected item so the parent reports which items failed; an
   * itemless sub-error (no `item_pk` — e.g. an `invalid_filter` from a runtime-throwing filter the scoped
   * recursion caught before matching any element) is recorded at the parent action level so it is propagated
   * rather than dropped.
   */
  mergeUnderAction(
    action: WriteAction<T>,
    failedActions: WriteOutcomeFailed<any>[],
  ): void {
    for (const subAction of failedActions) {
      for (const subItem of subAction.affected_items ?? []) {
        if (!subItem.item) continue;
        // Errors scoped to this item.
        for (const error of subAction.errors) {
          if (error.item_pk === subItem.item_pk) {
            const { item_pk: _ipk, item: _item, ...errorBase } = error;
            this.record(action, subItem.item, errorBase);
          }
        }
        // Errors with no item context apply to every merged item.
        for (const error of subAction.errors) {
          if (error.item_pk === undefined) {
            const { item_pk: _ipk, item: _item, ...errorBase } = error;
            this.record(action, subItem.item, errorBase);
          }
        }
      }
      // A sub-failure with no affected items has no item to attach to; record its itemless errors at the
      // parent action level so a scoped invalid_filter still fails the parent.
      if (!subAction.affected_items?.length) {
        for (const error of subAction.errors) {
          if (error.item_pk === undefined) {
            const { item_pk: _ipk, item: _item, ...errorBase } = error;
            this.reportActionError(action, errorBase);
          }
        }
      }
    }
  }

  length(): number {
    return this.failures.length;
  }

  get(): WriteOutcomeFailed<T>[] {
    // Snapshot is JSON-normalised so callers cannot reach tracker state through it.
    // Circular references in stored items are resolved first so serialisation cannot throw.
    return JSON.parse(
      JSON.stringify(
        cloneDeepScalarValues(this.failures, {
          skip_circular: true,
          skip_symbols: true,
        }),
      ),
    );
  }
}
