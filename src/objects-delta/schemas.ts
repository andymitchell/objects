
import { isTypeEqual } from "@andyrmitchell/utils";
import { PrimaryKeyValueSchema} from "../utils/getKeyValue.ts";
import z from "zod";
import type { ObjectsDelta, ObjectsDeltaApplicable} from "./types.ts";
import { FlexibleTimestampSchema } from "@andyrmitchell/composite-timestamps";

const itemSchema = z.record(z.any());


export const ObjectsDeltaSchema = z.object({
    insert: z.array(itemSchema),
    update: z.array(itemSchema),
    remove_keys: z.array(PrimaryKeyValueSchema),
    created_at: FlexibleTimestampSchema
});
isTypeEqual<z.infer<typeof ObjectsDeltaSchema>, ObjectsDelta>(true);

export function isObjectsDelta(x: unknown): x is ObjectsDelta {
    return ObjectsDeltaSchema.safeParse(x).success;
}


export const ObjectsDeltaApplicableSchema = ObjectsDeltaSchema.partial().merge(z.object({
    upsert: z.array(itemSchema),
}));
isTypeEqual<z.infer<typeof ObjectsDeltaApplicableSchema>, ObjectsDeltaApplicable>(true);

export function isObjectsDeltaApplicable(x: unknown): x is ObjectsDeltaApplicable {
    return ObjectsDeltaApplicableSchema.safeParse(x).success;
}


