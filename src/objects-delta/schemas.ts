
import { isTypeEqual } from "@andyrmitchell/utils";
import { PrimaryKeyValueSchema} from "../utils/getKeyValue.ts";
import z from "zod";
import type { ObjectsDelta, ObjectsDeltaFlexible, ObjectsDeltaFlexibleWithModifiedAt, ObjectsDeltaUsingRemovedKeys } from "./types.ts";

const itemSchema = z.record(z.any());


export const ObjectsDeltaSchema = z.object({
    added: z.array(itemSchema),
    updated: z.array(itemSchema),
    removed: z.array(itemSchema)
});

export function isObjectsDelta(x: unknown): x is ObjectsDelta {
    return ObjectsDeltaSchema.safeParse(x).success;
}

export const ObjectsDeltaUsingRemovedKeysSchema = z.object({
    added: z.array(itemSchema),
    updated: z.array(itemSchema),
    removed_keys: z.array(PrimaryKeyValueSchema),
});
export function isObjectsDeltaUsingRemovedKeys(x: unknown): x is ObjectsDeltaUsingRemovedKeys {
    return ObjectsDeltaUsingRemovedKeysSchema.safeParse(x).success;
}

isTypeEqual<z.infer<typeof ObjectsDeltaSchema>, ObjectsDelta>(true);
isTypeEqual<z.infer<typeof ObjectsDeltaUsingRemovedKeysSchema>, ObjectsDeltaUsingRemovedKeys>(true);

/**
 * A faster test, used when you're sure it's either `ObjectsDelta` or `ObjectsDeltaUsingRemovedKeys`.
 * @param x 
 * @returns 
 */
export function isObjectsDeltaUsingRemovedKeysFast(x: ObjectsDelta | ObjectsDeltaUsingRemovedKeys): x is ObjectsDeltaUsingRemovedKeys {
    return "removed_keys" in x;
}

const PartialModifiedAtSchema = z.object({'modified_at': z.number().optional()})
export const ObjectsDeltaFlexibleSchema = z.union([
    ObjectsDeltaSchema.merge(PartialModifiedAtSchema),
    ObjectsDeltaUsingRemovedKeysSchema.merge(PartialModifiedAtSchema)
])
isTypeEqual<z.infer<typeof ObjectsDeltaFlexibleSchema>, ObjectsDeltaFlexible<any>>(true); // Maintain alignment between the schema and the generic type 

export function isObjectsDeltaFlexible<T extends Record<string, any> = Record<string, any>>(x: unknown): x is ObjectsDeltaFlexible<T> {
    return ObjectsDeltaFlexibleSchema.safeParse(x).success;
}

const ModifiedAtSchema = z.object({'modified_at': z.number()})
export const ObjectsDeltaFlexibleWithModifiedAtSchema = z.union([
    ObjectsDeltaSchema.merge(ModifiedAtSchema),
    ObjectsDeltaUsingRemovedKeysSchema.merge(ModifiedAtSchema),
])
isTypeEqual<z.infer<typeof ObjectsDeltaFlexibleWithModifiedAtSchema>, ObjectsDeltaFlexibleWithModifiedAt<any>>(true);