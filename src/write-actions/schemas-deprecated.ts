/**
 * Deprecated schema aliases mapping old names to new schemas.
 * All re-exported from index.ts for backward compatibility.
 */
import {
    WriteActionErrorSchema,
    WriteActionOutcomeOkSchema,
    WriteActionOutcomeFailedSchema,
    WriteResultSchema,
    makeWriteActionOutcomeOkSchema,
    makeWriteActionOutcomeFailedSchema,
} from './write-action-schemas.ts';

/** @deprecated Use `WriteActionErrorSchema` instead. */
export const WriteCommonErrorSchema = WriteActionErrorSchema;

/** @deprecated Use `WriteActionOutcomeOkSchema` instead. */
export const SuccessfulWriteActionSchema = WriteActionOutcomeOkSchema;

/** @deprecated Use `makeWriteActionOutcomeOkSchema<T>()` instead. */
export const makeSuccessfulWriteActionSchema = makeWriteActionOutcomeOkSchema;

/** @deprecated Use `WriteActionOutcomeFailedSchema` instead. */
export const FailedWriteActionSchema = WriteActionOutcomeFailedSchema;

/** @deprecated Use `makeWriteActionOutcomeFailedSchema<T>()` instead. */
export const makeFailedWriteActionSchema = makeWriteActionOutcomeFailedSchema;

/** @deprecated Use `WriteResultSchema` instead. */
export const WriteActionsResponseSchema = WriteResultSchema;

/** @deprecated Eliminated. Use `WriteResultSchema` instead. */
export const WriteActionsResponseOkSchema = WriteResultSchema;

/** @deprecated Eliminated. Use `WriteResultSchema` instead. */
export const WriteActionsResponseErrorSchema = WriteResultSchema;
