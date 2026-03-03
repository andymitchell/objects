import { type ZodIssue } from "zod";
import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, NonObjectArrayProperty } from "../dot-prop-paths/types.js";
import type { UpdatingMethod, WhereFilterDefinition } from "../where-filter/types.js"
import { type PrimaryKeyValue } from "../utils/getKeyValue.js";
import type { TreeNode } from "../dot-prop-paths/zod.ts";





export type WriteActionPayloadCreate<T extends Record<string, any>> = {
    type: 'create',
    data: T
}
export type WriteActionPayloadUpdate<T extends Record<string, any>> = {
    type: 'update',
    data: Partial<Pick<T, NonObjectArrayProperty<T>>>, // Updating whole arrays is forbidden, use array_scope instead. Why? This would require the whole array to be 'set', even if its likely only a tiny part needs to change, and that makes it very hard for CRDTs to reconcile what to overwrite. One solution could be enable this by allowing it to 'diff' it against the client's current cached version to see what has changed, and convert it into array_scope actions internally. The downside, other than an additional layer of uncertainty of how a bug might sneak in (e.g. if cache is somehow not as expected at point of write), is it forces the application code to start editing arrays before passing it to an 'update' rather than directly describing the change... it's more verbose. (Also related: #VALUE_TO_DELETE_KEY).
    where: WhereFilterDefinition<T>,
    method?: UpdatingMethod
}
export type WriteActionPayloadArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T> = DotPropPathToObjectArraySpreadingArrays<T>> = {
    type: 'array_scope',
    scope: P,
    // IS IT FAILING TO SPOT TYPES? YOU MUST SPECIFY THE 'P' GENERIC IN THE TYPE, OR IT FAILS. IT CANNOT PROPERLY INFER FROM 'scope'. OR USE HELPER assertArrayScope
    action: WriteActionPayload<DotPropPathValidArrayValue<T, P>>,
    where: WhereFilterDefinition<T>
}
export type WriteActionPayloadDelete<T extends Record<string, any>> = {
    type: 'delete',
    where: WhereFilterDefinition<T>
}
export type WriteActionPayload<T extends Record<string, any>> = WriteActionPayloadCreate<T> | WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>;
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
export type WriteAction<T extends Record<string, any>> = {
    type: 'write',
    ts: number,
    uuid: string,
    payload: WriteActionPayload<T>
}


// ─── Error Types ───

/**
 * Categorised error from a write action. Discriminated union on `type`.
 *
 * @example
 * if (error.type === 'schema') console.log(error.issues);
 */
export type WriteActionError =
    {type: 'custom', message?: string} |
    {
        type: 'schema',
        issues: ZodIssue[],
        /** The item that was tested in the schema. It should be the same as the reported failed_item, but this removes doubt. */
        tested_item?: any,
        serialised_schema?: TreeNode
    } |
    {
        type: 'missing_key',
        primary_key: string | number | symbol
    } |
    {
        type: 'update_altered_key',
        primary_key: string | number | symbol
    } |
    {
        type: 'create_duplicated_key',
        primary_key: string | number | symbol
    } |
    {
        type: 'permission_denied',
        reason: 'no-owner-id' | 'not-owner' | 'unknown-permission' | 'invalid-permissions' | 'expected-owner-email' | 'not-authenticated'
    };

/**
 * A `WriteActionError` enriched with the item context where the error occurred.
 *
 * @example
 * const ctx: WriteActionErrorContext<MyItem> = { type: 'missing_key', primary_key: 'id', item_pk: '123', item: myItem };
 */
export type WriteActionErrorContext<T extends Record<string, any> = Record<string, any>> = WriteActionError & {
    item_pk?: PrimaryKeyValue;
    item?: T;
};

// ─── Affected Items ───

/**
 * An item affected by a write action. Unified type for both success and failure outcomes.
 *
 * @example
 * const affected: WriteActionAffectedItem<MyItem> = { item_pk: '123', item: myItem };
 */
export type WriteActionAffectedItem<T extends Record<string, any> = Record<string, any>> = {
    item_pk: PrimaryKeyValue;
    item?: T;
};

// ─── Per-Action Outcomes (discriminated union on `ok`) ───

/**
 * A write action that completed successfully.
 *
 * @example
 * if (outcome.ok) outcome.affected_items?.[0]?.item_pk;
 */
export type WriteActionOutcomeOk<T extends Record<string, any> = Record<string, any>> = {
    ok: true;
    action: WriteAction<T>;
    affected_items?: WriteActionAffectedItem<T>[];
};

/**
 * A write action that failed. `errors` is always present with at least one entry.
 *
 * @example
 * if (!outcome.ok) outcome.errors[0].type; // fully narrowed
 */
export type WriteActionOutcomeFailed<T extends Record<string, any> = Record<string, any>> = {
    ok: false;
    action: WriteAction<T>;
    affected_items?: WriteActionAffectedItem<T>[];
    /** At least one error that caused the failure. */
    errors: WriteActionErrorContext<T>[];
    /** True if the action can never succeed (e.g. schema violation, permission denied). */
    unrecoverable?: boolean;
    /** Don't retry until this timestamp. */
    back_off_until_ts?: number;
    /** An earlier action failed, blocking this one. */
    blocked_by_action_uuid?: string;
};

/**
 * Outcome of a single write action. Discriminated union on `ok`.
 *
 * @example
 * if (!outcome.ok) outcome.errors[0].type; // narrowed to WriteActionOutcomeFailed
 */
export type WriteActionOutcome<T extends Record<string, any> = Record<string, any>> =
    WriteActionOutcomeOk<T> | WriteActionOutcomeFailed<T>;

// ─── Top-Level Result ───

/**
 * Result of applying write actions. NOT a discriminated union — `actions` and other data
 * are always accessible. `ok` is informational.
 *
 * Use `getFailedActions()` / `getSuccessfulActions()` for filtered, narrowed access.
 *
 * @example
 * if (!result.ok) console.log(result.error?.message);
 * result.actions.forEach(a => { if (!a.ok) a.errors[0].type; });
 */
export type WriteResult<T extends Record<string, any> = Record<string, any>> = {
    ok: boolean;
    /** All action outcomes in execution order. */
    actions: WriteActionOutcome<T>[];
    /** Lightweight summary; only present when `ok` is false. */
    error?: { message: string };
};

