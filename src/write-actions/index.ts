import { writeToItemsArray, writeToItemsArrayPreserveInputType } from "./writeToItemsArray/index.ts";
import { isIUser } from "./auth/index.js";
import { assertWriteArrayScope, getWriteFailures, getWriteSuccesses, getWriteErrors } from "./helpers.ts";
import { WriteErrorSchema, WriteAffectedItemSchema, WriteOutcomeOkSchema, WriteOutcomeFailedSchema, WriteOutcomeSchema, WriteResultSchema, makeWriteActionSchema, makeWriteOutcomeOkSchema, makeWriteOutcomeFailedSchema, makeWriteOutcomeSchema, makeWriteResultSchema, WriteActionSchema } from "./write-action-schemas.ts";

// ─── Functions ───
export {
    writeToItemsArray,
    writeToItemsArrayPreserveInputType,
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
    WriteToItemsArrayOptions,
} from './writeToItemsArray/types.ts';

export type { DDL, DDLRoot, ListRules, ListRulesCore } from '../ddl/types.ts';
export { resolveDdlListRules } from '../ddl/resolveDdlListRules.ts';

export type { IUser } from "./auth/index.js";

export type { OwnershipRule } from "../ownership/types.ts";
