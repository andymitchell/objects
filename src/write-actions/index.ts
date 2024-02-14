import applyWritesToItems from "./applyWritesToItems/index";
import { WriteAction, WriteActionPayload, createWriteActionSchema } from "./types";

export const WriteActions = {
    applyWritesToItems,
    createWriteActionSchema
}

export type {WriteAction, WriteActionPayload}
