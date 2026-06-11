import { writeToItemsArray, writeToItemsArrayPreserveInputType } from "./writeToItemsArray/index.ts";
import { deepEquals } from "./writeToItemsArray/helpers/mutations/index.ts";
import { isIUser } from "./auth/index.js";
import { assertWriteArrayScope, getWriteFailures, getWriteSuccesses, getWriteErrors } from "./helpers.ts";
import { getWrittenPaths } from "./getWrittenPaths.ts";
import { WriteErrorSchema, WriteAffectedItemSchema, WriteOutcomeOkSchema, WriteOutcomeFailedSchema, WriteOutcomeSchema, WriteOutcomeOkCoreSchema, WriteOutcomeFailedCoreSchema, WriteOutcomeCoreSchema, WriteResultSchema, makeWriteActionSchema, makeWriteOutcomeOkSchema, makeWriteOutcomeFailedSchema, makeWriteOutcomeSchema, makeWriteOutcomeOkCoreSchema, makeWriteOutcomeFailedCoreSchema, makeWriteOutcomeCoreSchema, makeWriteResultSchema, WriteActionSchema } from "./write-action-schemas.ts";

// ─── Functions ───
export {
    writeToItemsArray,
    writeToItemsArrayPreserveInputType,
    isIUser,
    /**
     * Key-order-independent structural deep-equal. Promoted to the public surface so stores can
     * canonicalise a replayed `WriteAction` against a prior one when detecting `uuid_conflict`
     * (ICollection `dec-write-uuid-idempotent`). Semantics: scalars `===` (with `NaN === NaN`);
     * objects recursive, key-order independent, `undefined` ≡ missing key; arrays order-sensitive;
     * `null` distinct from `undefined`.
     */
    deepEquals,
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

// ─── Testing ───
// Published so a stackable-collection conformance suite can run the standard write-action
// battery against a real ICollection (it supplies an adapter wrapping its own write path).
export { standardTests } from "./standardTests.ts";
export type { StandardTestConfig, AdapterFactory, WriteTestAdapter, WriteTestAdapterResult } from "./standardTests.ts";
