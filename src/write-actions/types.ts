import { type ZodIssue } from "zod";
import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue } from "../dot-prop-paths/types.js";
import type { UpdatingMethod, WhereFilterDefinition } from "../where-filter/types.js"
import { type PrimaryKeyValue } from "../utils/getKeyValue.js";
//import type { SerializableCommonError } from "@andyrmitchell/utils/serialize-error";

interface SerializableCommonError {
    /** The human-readable error message. */
    message: string;
    /** The underlying cause of the error, if available. Can be any type, but restricted to being serializable. */
    cause?: unknown;
    /** The stack trace at the time the error was thrown, if available. */
    stack?: string;
    /** The type or name of the error (e.g., "TypeError", "ValidationError"). */
    name?: string;
}

export const VALUE_TO_DELETE_KEY:undefined = undefined; // #VALUE_TO_DELETE_KEY If this is changed to null, change WriteActionPayloadUpdate to.... data: Nullable<Partial<T>>









type NonArrayProperty<T> = {
    [P in keyof T]: T[P] extends Array<any> ? never : P
}[keyof T];

export type WriteActionPayloadCreate<T extends Record<string, any>> = {
    type: 'create',
    data: T
}
export type WriteActionPayloadUpdate<T extends Record<string, any>> = {
    type: 'update',
    data: Partial<Pick<T, NonArrayProperty<T>>>, // Updating whole arrays is forbidden, use array_scope instead. Why? This would require the whole array to be 'set', even if its likely only a tiny part needs to change, and that makes it very hard for CRDTs to reconcile what to overwrite. One solution could be enable this by allowing it to 'diff' it against the client's current cached version to see what has changed, and convert it into array_scope actions internally. The downside, other than an additional layer of uncertainty of how a bug might sneak in (e.g. if cache is somehow not as expected at point of write), is it forces the application code to start editing arrays before passing it to an 'update' rather than directly describing the change... it's more verbose. (Also related: #VALUE_TO_DELETE_KEY).
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
type WriteActionPayloadDelete<T extends Record<string, any>> = {
    type: 'delete',
    where: WhereFilterDefinition<T>
}
export type WriteActionPayload<T extends Record<string, any>> = WriteActionPayloadCreate<T> | WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>;
/**
 * An instruction to modify an object, using CRUD-inspired verbs. 
 * 
 * The only peculiar one is `array_scope` where every nested list can be treated atomically by first targetting/scoping it, 
 * then applying the action at that level. It allows more granular behaviour.
 */
export type WriteAction<T extends Record<string, any>> = {
    type: 'write',
    ts: number,
    uuid: string,
    payload: WriteActionPayload<T>
}

export function assertArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T>>(action: WriteActionPayloadArrayScope<T, P>):WriteActionPayloadArrayScope<T,P> {
    return action;
}

export function isWriteActionArrayScopePayload<T extends Record<string, any> = Record<string, any>>(x: unknown):x is WriteActionPayloadArrayScope<T> {
    return typeof x==='object' && !!x && "type" in x && x.type==='array_scope';
}

export function isUpdateOrDeleteWriteActionPayload<T extends Record<string, any>>(x: unknown): x is WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>{
    return typeof x==='object' && !!x && 'type' in x && (x.type==='update' || x.type==='array_scope' || x.type==='delete');
}

export type WriteActionAffectedItem = {
    item_pk:PrimaryKeyValue
}
export type FailedWriteActionAffectedItem<T extends Record<string, any>> = WriteActionAffectedItem & {
    item: T,
    error_details: WriteCommonError[]
}

/**
 * The most typical errors for writing actions. 
 */
export type WriteCommonError = 
    {type: 'custom', message?: string} | 
    {
        type: 'schema',
        issues: ZodIssue[]
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
 * A single `WriteAction` that failed. 
 * 
 * 
 * If supported, it includes the items/objects it modified.
 */
export type FailedWriteAction<T extends Record<string, any> = Record<string, any>> = {
    action: WriteAction<T>,
    /**
     * The cause of the failure. There are potentially several (although this is unlikely).
     * The first entry should be the root cause of the failure. 
     */
    error_details: WriteCommonError[],

    /**
     * It's recoverable if it's a temporary problem like a network issue; and unrecoverable if it can never succeed (e.g. the update would break the owner permissions)
     */
    unrecoverable?: boolean,

    /**
     * Don't retry until this time. 
     */
    back_off_until_ts?: number,

    /**
     * Actions are applied sequentially, so a common cause of failure is that an earlier action failed (and that needs to be remedied, then this action might work). 
     * This tells you that initial failing action. 
     */
    blocked_by_action_uuid?: string,

    /**
     * Optional. The items affected by this failed action. 
     */
    affected_items?: FailedWriteActionAffectedItem<T>[]

};

/**
 * A single `WriteAction` that was successful. 
 * 
 * If supported, it includes the items/objects it modified.
 */
export type SuccessfulWriteAction<T extends Record<string, any>> = {
    action: WriteAction<T>,
    affected_items?: WriteActionAffectedItem[]
}


/**
 * Having been given multiple `WhereFilterDefinitions`, this represents the union of them.
 */
export type CombineWriteActionsWhereFiltersResponse<T extends Record<string, any>> = {status: 'ok', filter: WhereFilterDefinition<T> | undefined} | SerializableCommonError & {status: 'error', failed_actions: FailedWriteAction<T>[]};

/**
 * General success for actions. 
 * 
 * It's implied all actions succeeded.
 */
export type WriteActionsResponseOk = {
    status: 'ok'
}
/**
 * Not all actions could complete. 
 * 
 * It's expected that the combination of `successful_actions` and `failed_actions` includes _all_ actions requested.
 */
export type WriteActionsResponseError<T extends Record<string, any>> = SerializableCommonError & {
    status: 'error',
    /**
     * The actions that succeeded, if any. 
     * 
     * Note in the case of an error: 
     * - `applyWritesToItems` will always fail all subsequent actions after the first failure, to prevent them being applied out of order.
     * - It may fail all of them if any error (see `allow_partial_success` on the options)
     * 
     */
    successful_actions: SuccessfulWriteAction<T>[],

    /**
     * The actions that failed, and the reason why. 
     */
    failed_actions: FailedWriteAction<T>[]
}

/**
 * Either all actions succeeded, or there was an error (in which case it tells you if any succeeded, and which failed).
 */
export type WriteActionsResponse<T extends Record<string, any>> = WriteActionsResponseOk | WriteActionsResponseError<T>;
