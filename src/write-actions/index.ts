import { applyWritesToItems, DDL } from "./applyWritesToItems/index";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters";
import {  AppliedWritesOutput, WriteAction, WriteActionError, WriteActionErrorSchema, WriteActionFailures, WriteActionPayload, assertArrayScope, createWriteActionFailuresSchema, createWriteActionSchema } from "./types";

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
    AppliedWritesOutput
}
