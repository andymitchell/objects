import { applyWritesToItems, ApplyWritesToItemsOptions, checkPermission, DDL, ListOrdering } from "./applyWritesToItems/index";
import { isIUser, IUser } from "./auth";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters";
import {  WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, WriteAction, WriteActionError, WriteActionErrorSchema, WriteActionFailures, WriteActionPayload, assertArrayScope, createWriteActionFailuresSchema, createWriteActionSchema, WriteActionFailuresErrorDetails, WriteActionSuccesses, createWriteActionSuccessesSchema, AppliedWritesOutputResponse } from "./types";

export const WriteActions = {
    applyWritesToItems,
    combineWriteActionsWhereFilters,
    createWriteActionSchema,
    createWriteActionSuccessesSchema,
    createWriteActionFailuresSchema,
    WriteActionErrorSchema,
    assertArrayScope,
    checkPermission
}

export {
    assertArrayScope,
    isIUser
}

export type {
    WriteAction, 
    WriteActionPayload, 
    DDL,
    ListOrdering,
    ApplyWritesToItemsOptions,
    WriteActionSuccesses,
    WriteActionFailures,
    WriteActionError,
    AppliedWritesOutput,
    AppliedWritesOutputResponse,
    WriteActionAffectedItem,
    WriteActionFailureAffectedItem,
    WriteActionFailuresErrorDetails,
    IUser
}
