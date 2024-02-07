import applyWritesToItems from "./applyWritesToItems";
import { WriteAction, WriteActionPayload, createWriteActionSchema } from "./types";

export const WriteActions = {
    applyWritesToItems,
    createWriteActionSchema
}

export type {WriteAction, WriteActionPayload}
