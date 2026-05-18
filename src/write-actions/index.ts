import { writeToItemsArray, writeToItemsArrayPreserveInputType } from "./writeToItemsArray/index.ts";
import { isIUser } from "./auth/index.js";
import { assertWriteArrayScope, getWriteFailures, getWriteSuccesses, getWriteErrors } from "./helpers.ts";
import { getWrittenPaths } from "./getWrittenPaths.ts";
import { WriteErrorSchema, WriteAffectedItemSchema, WriteOutcomeOkSchema, WriteOutcomeFailedSchema, WriteOutcomeSchema, WriteOutcomeOkCoreSchema, WriteOutcomeFailedCoreSchema, WriteOutcomeCoreSchema, WriteResultSchema, makeWriteActionSchema, makeWriteOutcomeOkSchema, makeWriteOutcomeFailedSchema, makeWriteOutcomeSchema, makeWriteOutcomeOkCoreSchema, makeWriteOutcomeFailedCoreSchema, makeWriteOutcomeCoreSchema, makeWriteResultSchema, WriteActionSchema } from "./write-action-schemas.ts";

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
    getWrittenPaths,
}

// ─── Schemas ───
export {
    WriteResultSchema,
    WriteErrorSchema,
    WriteOutcomeSchema,
    WriteOutcomeOkSchema,
    WriteOutcomeFailedSchema,
    WriteOutcomeCoreSchema,
    WriteOutcomeOkCoreSchema,
    WriteOutcomeFailedCoreSchema,
    WriteAffectedItemSchema,
    WriteActionSchema,
    makeWriteActionSchema,
    makeWriteOutcomeSchema,
    makeWriteOutcomeOkSchema,
    makeWriteOutcomeFailedSchema,
    makeWriteOutcomeCoreSchema,
    makeWriteOutcomeOkCoreSchema,
    makeWriteOutcomeFailedCoreSchema,
    makeWriteResultSchema,
}

// ─── Types ───
export type {
    WriteAction,
    WritePayload,
    WritePayloadCreate,
    WritePayloadUpdate,
    WritePayloadDelete,
    WritePayloadArrayScope,
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
    WriteOutcomeOkCore,
    WriteOutcomeFailedCore,
    WriteOutcomeCore,
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
