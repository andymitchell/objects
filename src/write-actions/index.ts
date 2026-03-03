import { applyWritesToItems, applyWritesToItemsTyped, checkPermission } from "./applyWritesToItems/index.js";
import { isIUser } from "./auth/index.js";
import { assertArrayScope, getFailedActions, getSuccessfulActions, getAllErrors } from "./helpers.ts";
import { WriteActionErrorSchema, WriteActionAffectedItemSchema, WriteActionOutcomeOkSchema, WriteActionOutcomeFailedSchema, WriteActionOutcomeSchema, WriteResultSchema, makeWriteActionSchema, makeWriteActionOutcomeOkSchema, makeWriteActionOutcomeFailedSchema, makeWriteActionOutcomeSchema, makeWriteResultSchema, WriteActionSchema } from "./write-action-schemas.ts";

// ─── Functions ───
export {
    applyWritesToItems,
    applyWritesToItemsTyped,
    checkPermission,
    isIUser,
}

// ─── Helpers ───
export {
    assertArrayScope,
    getFailedActions,
    getSuccessfulActions,
    getAllErrors,
}

// ─── Schemas ───
export {
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
}

// ─── Types ───
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
} from "./types.ts";

export type {
    WriteChangesBase,
    ApplyWritesToItemsChanges,
    ApplyWritesToItemsResult,
    DDL,
    ListOrdering,
    ApplyWritesToItemsOptions,
} from './applyWritesToItems/types.ts';

export type { IUser } from "./auth/index.js";
