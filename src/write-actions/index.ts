import { applyWritesToItems, checkPermission } from "./applyWritesToItems/index.js";
import type {  ApplyWritesToItemsOptions, DDL, ListOrdering } from "./applyWritesToItems/index.js";
import { isIUser, type IUser } from "./auth/index.js";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters.js";
import {  WriteActionErrorSchema,  assertArrayScope, createWriteActionFailuresSchema, createWriteActionSchema, createWriteActionSuccessesSchema } from "./types.js";
import type {  WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, WriteAction, WriteActionError, WriteActionFailures, WriteActionPayload, WriteActionFailuresErrorDetails, WriteActionSuccesses, AppliedWritesOutputResponse } from "./types.js";

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
