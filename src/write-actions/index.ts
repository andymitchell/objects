import { applyWritesToItems, checkPermission } from "./applyWritesToItems/index.js";
import type {  ApplyWritesToItemsOptions, DDL, ListOrdering } from "./applyWritesToItems/index.js";
import { isIUser, type IUser } from "./auth/index.js";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters.js";
import { assertArrayScope,  type FailedWriteAction, type FailedWriteActionAffectedItem, type SuccessfulWriteAction, type WriteAction, type WriteActionAffectedItem, type WriteActionPayload, type WriteActionsResponse, type WriteActionsResponseError, type WriteActionsResponseOk, type WriteCommonError } from "./types.ts";
import {  FailedWriteActionSchema, makeFailedWriteActionSchema, makeSuccessfulWriteActionSchema, makeWriteActionSchema, SuccessfulWriteActionSchema, WriteActionSchema, WriteActionsResponseErrorSchema, WriteActionsResponseOkSchema, WriteActionsResponseSchema, WriteCommonErrorSchema } from "./write-action-schemas.ts";
import type {ApplyWritesToItemsChanges, ApplyWritesToItemsResponse} from './applyWritesToItems/types.ts';


/**
 * Combine the functions into the `WriteActions` namespace. 
 * 
 * It's helpful as a reminder of their names, but not advised as it breaks tree-shaking. 
 * 
 * Each item can be separately imported solo. 
 */
export const WriteActions = {
    applyWritesToItems,
    combineWriteActionsWhereFilters,
    schemas: {
        
        WriteActionsResponseSchema,
        WriteActionsResponseOkSchema,
        WriteActionsResponseErrorSchema,

        WriteCommonErrorSchema,

        WriteActionSchema,
        makeWriteActionSchema,

        SuccessfulWriteActionSchema,
        makeSuccessfulWriteActionSchema,
        FailedWriteActionSchema,
        makeFailedWriteActionSchema
        
    },
    assertArrayScope,
    checkPermission
}

export {
    applyWritesToItems,
    combineWriteActionsWhereFilters,
    WriteActionsResponseSchema,
    WriteActionsResponseOkSchema,
    WriteActionsResponseErrorSchema,

    WriteCommonErrorSchema,

    WriteActionSchema,
    makeWriteActionSchema,

    SuccessfulWriteActionSchema,
    makeSuccessfulWriteActionSchema,
    FailedWriteActionSchema,
    makeFailedWriteActionSchema,
    assertArrayScope,
    checkPermission
}

export {
    isIUser
}

export type {
    WriteAction, 
    WriteActionPayload, 

    DDL,
    ListOrdering,
    ApplyWritesToItemsOptions,

    WriteActionsResponse,
    WriteActionsResponseOk,
    WriteActionsResponseError,

    SuccessfulWriteAction,
    FailedWriteAction,
    WriteCommonError,

    ApplyWritesToItemsChanges,
    ApplyWritesToItemsResponse,

    WriteActionAffectedItem,
    FailedWriteActionAffectedItem,
    
    IUser
}

export * from './index-old-types.ts';