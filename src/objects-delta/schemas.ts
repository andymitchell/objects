
import { isTypeEqual } from "@andyrmitchell/utils";
import { PrimaryKeyValueSchema} from "../utils/getKeyValue.ts";
import z from "zod";
import type { ObjectsDelta, ObjectsDeltaUsingRemovedKeys } from "./types.ts";

const itemSchema = z.record(z.any());


export const ObjectsDeltaSchema = z.object({
    added: z.array(itemSchema),
    updated: z.array(itemSchema),
    removed: z.array(itemSchema)
});

export const ObjectsDeltaUsingRemovedKeysSchema = z.object({
    added: z.array(itemSchema),
    updated: z.array(itemSchema),
    removed_keys: z.array(PrimaryKeyValueSchema),
});

isTypeEqual<z.infer<typeof ObjectsDeltaSchema>, ObjectsDelta>(true);
isTypeEqual<z.infer<typeof ObjectsDeltaUsingRemovedKeysSchema>, ObjectsDeltaUsingRemovedKeys>(true);
