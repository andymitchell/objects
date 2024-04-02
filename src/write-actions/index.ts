import { applyWritesToItems, DDL } from "./applyWritesToItems/index";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters";
import {  WriteAction, WriteActionError, WriteActionErrorSchema, WriteActionFailures, WriteActionPayload, createWriteActionFailuresSchema, createWriteActionSchema } from "./types";

export const WriteActions = {
    applyWritesToItems,
    combineWriteActionsWhereFilters,
    createWriteActionSchema,
    createWriteActionFailuresSchema,
    WriteActionErrorSchema
}

export type {
    WriteAction, 
    WriteActionPayload, 
    DDL,
    WriteActionFailures,
    WriteActionError
}
