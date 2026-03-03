import { applyWritesToItems, applyWritesToItemsTyped, checkPermission } from "./applyWritesToItems/index.js";
import type {  ApplyWritesToItemsOptions, DDL, ListOrdering } from "./applyWritesToItems/index.js";
import { isIUser, type IUser } from "./auth/index.js";
import { assertArrayScope, getFailedActions, getSuccessfulActions, getAllErrors, type WriteAction, type WriteActionPayload, type WriteActionError, type WriteActionErrorContext, type WriteActionAffectedItem, type WriteActionOutcomeOk, type WriteActionOutcomeFailed, type WriteActionOutcome, type WriteResult } from "./types.ts";
import { WriteActionErrorSchema, WriteActionAffectedItemSchema, WriteActionOutcomeOkSchema, WriteActionOutcomeFailedSchema, WriteActionOutcomeSchema, WriteResultSchema, makeWriteActionSchema, makeWriteActionOutcomeOkSchema, makeWriteActionOutcomeFailedSchema, makeWriteActionOutcomeSchema, makeWriteResultSchema, WriteActionSchema } from "./write-action-schemas.ts";
import type { ApplyWritesToItemsChanges, ApplyWritesToItemsResult, WriteChangesBase } from './applyWritesToItems/types.ts';
import { convertWriteResultToLegacy } from './convertWriteResultToLegacy.ts';

// ─── Deprecated re-exports (backward compatibility) ───
import type { WriteCommonError, SuccessfulWriteAction, FailedWriteAction, FailedWriteActionAffectedItem, WriteActionsResponse, WriteActionsResponseOk, WriteActionsResponseError, ApplyWritesToItemsResponse } from './types-deprecated.ts';
import { WriteCommonErrorSchema, SuccessfulWriteActionSchema, makeSuccessfulWriteActionSchema, FailedWriteActionSchema, makeFailedWriteActionSchema, WriteActionsResponseSchema, WriteActionsResponseOkSchema, WriteActionsResponseErrorSchema } from './schemas-deprecated.ts';


/**
 * Combine the functions into the `WriteActions` namespace.
 *
 * It's helpful as a reminder of their names, but not advised as it breaks tree-shaking.
 *
 * Each item can be separately imported solo.
 */
export const WriteActions = {
    applyWritesToItems,
    applyWritesToItemsTyped,
    schemas: {
        WriteResultSchema,
        WriteActionErrorSchema,
        WriteActionOutcomeSchema,
        WriteActionOutcomeOkSchema,
        WriteActionOutcomeFailedSchema,
        WriteActionAffectedItemSchema,
        WriteActionSchema,
        makeWriteActionSchema,
        makeWriteActionOutcomeSchema,
        makeWriteActionOutcomeOkSchema,
        makeWriteActionOutcomeFailedSchema,
        makeWriteResultSchema,

        // Deprecated schema aliases
        WriteActionsResponseSchema,
        WriteActionsResponseOkSchema,
        WriteActionsResponseErrorSchema,
        WriteCommonErrorSchema,
        SuccessfulWriteActionSchema,
        makeSuccessfulWriteActionSchema,
        FailedWriteActionSchema,
        makeFailedWriteActionSchema,
    },
    assertArrayScope,
    checkPermission,
    getFailedActions,
    getSuccessfulActions,
    getAllErrors,
    convertWriteResultToLegacy,
}

// ─── New exports ───
export {
    applyWritesToItems,
    applyWritesToItemsTyped,

    // Helpers
    getFailedActions,
    getSuccessfulActions,
    getAllErrors,
    convertWriteResultToLegacy,

    // Schemas (new)
    WriteResultSchema,
    WriteActionErrorSchema,
    WriteActionOutcomeSchema,
    WriteActionOutcomeOkSchema,
    WriteActionOutcomeFailedSchema,
    WriteActionAffectedItemSchema,
    WriteActionSchema,
    makeWriteActionSchema,
    makeWriteActionOutcomeSchema,
    makeWriteActionOutcomeOkSchema,
    makeWriteActionOutcomeFailedSchema,
    makeWriteResultSchema,

    assertArrayScope,
    checkPermission,
}

// ─── Deprecated schema exports (backward compatibility) ───
export {
    WriteActionsResponseSchema,
    WriteActionsResponseOkSchema,
    WriteActionsResponseErrorSchema,
    WriteCommonErrorSchema,
    SuccessfulWriteActionSchema,
    makeSuccessfulWriteActionSchema,
    FailedWriteActionSchema,
    makeFailedWriteActionSchema,
}

export {
    isIUser
}

// ─── New type exports ───
export type {
    WriteAction,
    WriteActionPayload,
    WriteActionError,
    WriteActionErrorContext,
    WriteActionAffectedItem,
    WriteActionOutcomeOk,
    WriteActionOutcomeFailed,
    WriteActionOutcome,
    WriteResult,

    WriteChangesBase,
    ApplyWritesToItemsChanges,
    ApplyWritesToItemsResult,

    DDL,
    ListOrdering,
    ApplyWritesToItemsOptions,

    IUser
}

// ─── Deprecated type exports (backward compatibility) ───
export type {
    WriteCommonError,
    SuccessfulWriteAction,
    FailedWriteAction,
    FailedWriteActionAffectedItem,
    WriteActionsResponse,
    WriteActionsResponseOk,
    WriteActionsResponseError,
    ApplyWritesToItemsResponse,
}
