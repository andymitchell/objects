import { applyWritesToItems, DDL } from "./applyWritesToItems/index";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters";
import {  WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, WriteAction, WriteActionError, WriteActionErrorSchema, WriteActionFailures, WriteActionPayload, assertArrayScope, createWriteActionFailuresSchema, createWriteActionSchema, WriteActionFailuresErrorDetails } from "./types";

export const WriteActions = {
    applyWritesToItems,
    combineWriteActionsWhereFilters,
    createWriteActionSchema,
    createWriteActionFailuresSchema,
    WriteActionErrorSchema,
    assertArrayScope
}

export {
    assertArrayScope
}

export type {
    WriteAction, 
    WriteActionPayload, 
    DDL,
    WriteActionFailures,
    WriteActionError,
    AppliedWritesOutput,
    WriteActionAffectedItem,
    WriteActionFailureAffectedItem,
    WriteActionFailuresErrorDetails
}
