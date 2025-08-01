import { type ZodIssue } from "zod";
import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue } from "../dot-prop-paths/types.js";
import type { UpdatingMethod, WhereFilterDefinition } from "../where-filter/types.js"
import { type PrimaryKeyValue } from "../utils/getKeyValue.js";
import type { Draft } from "immer";
import type { SerializableCommonError } from "@andyrmitchell/utils/serialize-error";



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

export type FailedWriteAction<T extends Record<string, any> = Record<string, any>> = {
    action: WriteAction<T>,
    error_details: WriteCommonError[],
    unrecoverable?: boolean,
    back_off_until_ts?: number,
    blocked_by_action_uuid?: string,
    affected_items?: FailedWriteActionAffectedItem<T>[]

};

export type SuccessfulWriteAction<T extends Record<string, any>> = {
    action: WriteAction<T>,
    affected_items?: WriteActionAffectedItem[]
}


export type CombineWriteActionsWhereFiltersResponse<T extends Record<string, any>> = {status: 'ok', filter: WhereFilterDefinition<T> | undefined} | SerializableCommonError & {status: 'error', failed_actions: FailedWriteAction<T>[]};


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
    successful_actions: SuccessfulWriteAction<T>[],
    failed_actions: FailedWriteAction<T>[]
}
export type WriteActionsResponse<T extends Record<string, any>> = WriteActionsResponseOk | WriteActionsResponseError<T>;

export type ApplyWritesToItemsChanges<T extends Record<string, any>> = { added: T[], updated: T[], deleted: T[], changed: boolean, final_items: T[] | Draft<T>[] }
export type ApplyWritesToItemsResponse<T extends Record<string, any>> = WriteActionsResponseOk & {
    changes: ApplyWritesToItemsChanges<T>,

    /**
     * This is a bit of a legacy thing. `WriteActionsResponseOk` does not include it. 
     * It's now considered redundant because it can only be a success if all actions are complete. 
     */
    successful_actions: SuccessfulWriteAction<T>[],
} | WriteActionsResponseError<T> & {
    changes: ApplyWritesToItemsChanges<T>
}
