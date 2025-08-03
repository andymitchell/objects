import { isTypeEqual } from "@andyrmitchell/utils";
import type { ChangeSet, ChangeSetWithModifiedAt } from "./types.ts";
import z from "zod";
import { ObjectsDeltaSchema, ObjectsDeltaUsingRemovedKeysSchema } from "../objects-delta/schemas.ts";


export const ChangeSetSchema = z.union([
    ObjectsDeltaSchema,
    ObjectsDeltaUsingRemovedKeysSchema
])
isTypeEqual<z.infer<typeof ChangeSetSchema>, ChangeSet<any>>(true); // Maintain alignment between the schema and the generic type 

export function isChangeSet<T extends Record<string, any> = Record<string, any>>(x: unknown): x is ChangeSet<T> {
    return ChangeSetSchema.safeParse(x).success;
}

const ModifiedAtSchema = z.object({'modified_at': z.number()})
export const ChangeSetWithModifiedAtSchema = z.union([
    ObjectsDeltaSchema.merge(ModifiedAtSchema),
    ObjectsDeltaUsingRemovedKeysSchema.merge(ModifiedAtSchema),
])
isTypeEqual<z.infer<typeof ChangeSetWithModifiedAtSchema>, ChangeSetWithModifiedAt<any>>(true);