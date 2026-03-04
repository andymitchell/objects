import { writeToItemsArray, writeToItemsArrayPreserveInputType, checkWritePermission } from "./applyWritesToItems/index.js";
import { isIUser } from "./auth/index.js";
import { assertWriteArrayScope, getWriteFailures, getWriteSuccesses, getWriteErrors } from "./helpers.ts";
import { WriteErrorSchema, WriteAffectedItemSchema, WriteOutcomeOkSchema, WriteOutcomeFailedSchema, WriteOutcomeSchema, WriteResultSchema, makeWriteActionSchema, makeWriteOutcomeOkSchema, makeWriteOutcomeFailedSchema, makeWriteOutcomeSchema, makeWriteResultSchema, WriteActionSchema } from "./write-action-schemas.ts";

// ─── Functions ───
export {
    writeToItemsArray,
    writeToItemsArrayPreserveInputType,
    checkWritePermission,
    isIUser,
}

// ─── Helpers ───
export {
    assertWriteArrayScope,
    getWriteFailures,
    getWriteSuccesses,
    getWriteErrors,
}

// ─── Schemas ───
export {
    WriteResultSchema,
    WriteErrorSchema,
    WriteOutcomeSchema,
    WriteOutcomeOkSchema,
    WriteOutcomeFailedSchema,
    WriteAffectedItemSchema,
    WriteActionSchema,
    makeWriteActionSchema,
    makeWriteOutcomeSchema,
    makeWriteOutcomeOkSchema,
    makeWriteOutcomeFailedSchema,
    makeWriteResultSchema,
}

// ─── Types ───
export type {
    WriteAction,
    WritePayload,
    WritePayloadAddToSet,
    WritePayloadPush,
    WritePayloadPull,
    WritePayloadInc,
    WriteError,
    CorePermissionDeniedReason,
    WriteErrorContext,
    WriteAffectedItem,
    WriteOutcomeOk,
    WriteOutcomeFailed,
    WriteOutcome,
    WriteResult,
} from "./types.ts";

export type {
    WriteChanges,
    WriteToItemsArrayChanges,
    WriteToItemsArrayResult,
    DDL,
    ListOrdering,
    WriteToItemsArrayOptions,
} from './applyWritesToItems/types.ts';

export type { IUser } from "./auth/index.js";
