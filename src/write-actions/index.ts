import { applyWritesToItems, DDL } from "./applyWritesToItems/index";
import {  WriteAction, WriteActionError, WriteActionErrorSchema, WriteActionFailures, WriteActionPayload, createWriteActionFailuresSchema, createWriteActionSchema } from "./types";

export const WriteActions = {
    applyWritesToItems,
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
