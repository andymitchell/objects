import { applyWritesToItems, DDL } from "./applyWritesToItems/index";
import { IUser } from "./auth";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters";
import {  WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, WriteAction, WriteActionError, WriteActionErrorSchema, WriteActionFailures, WriteActionPayload, assertArrayScope, createWriteActionFailuresSchema, createWriteActionSchema, WriteActionFailuresErrorDetails, WriteActionSuccesses, createWriteActionSuccessesSchema } from "./types";

export const WriteActions = {
    applyWritesToItems,
    combineWriteActionsWhereFilters,
    createWriteActionSchema,
    createWriteActionSuccessesSchema,
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
    WriteActionSuccesses,
    WriteActionFailures,
    WriteActionError,
    AppliedWritesOutput,
    WriteActionAffectedItem,
    WriteActionFailureAffectedItem,
    WriteActionFailuresErrorDetails,
    IUser
}
