import { z } from "zod";
import { isTypeEqual } from "@andyrmitchell/utils";
import type { OwnerIdFormat, OwnershipProperty } from "./types.ts";

export const OwnerIdFormatSchema = z.union([z.literal('uuid'), z.literal('email')]);

export const OwnershipPropertySchema = z.union([
    z.object({
        property_type: z.literal('id'),
        path: z.string(),
        format: OwnerIdFormatSchema,
        transferring_to_path: z.string().optional(),
    }),
    z.object({
        property_type: z.literal('id_in_scalar_array'),
        path: z.string(),
        format: OwnerIdFormatSchema,
    }),
]);

export const OwnershipRuleSchema = z.union([
    z.object({
        type: z.literal('basic'),
    }).and(OwnershipPropertySchema),
    z.object({
        type: z.literal('none'),
    }),
]);

isTypeEqual<z.infer<typeof OwnerIdFormatSchema>, OwnerIdFormat>(true);
isTypeEqual<z.infer<typeof OwnershipPropertySchema>['property_type'], OwnershipProperty<any>['property_type']>(true);
