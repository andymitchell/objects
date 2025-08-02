import { isTypeEqual } from "@andyrmitchell/utils";
import type { ChangeSet } from "./types.ts";
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