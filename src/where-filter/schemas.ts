import { z, ZodNumber, ZodOptional, type ZodSchema, type ZodTypeDef } from "zod";
import { ValueComparisonNumericOperators, type ArrayValueComparisonElemMatch, type ValueComparisonContains, type WhereFilterDefinition } from "./types.ts";
import isPlainObject from "../utils/isPlainObject.js";

export const WhereFilterSchema: ZodSchema<WhereFilterDefinition<any>, ZodTypeDef, any> = z.lazy(() =>
    z.union([
        z.record(z.union([
            ValueComparisonSchema,
            ArrayValueComparisonSchema,
            WhereFilterSchema
        ])),
        z.object({
            OR: z.array(WhereFilterSchema).optional(),
            AND: z.array(WhereFilterSchema).optional(),
            NOT: z.array(WhereFilterSchema).optional(),
        }),
    ])
);

export const UpdatingMethodSchema = z.enum(['merge', 'assign']);

const ValueComparisonNumericSchemaPartial: Record<string, ZodOptional<ZodNumber>> = {};
ValueComparisonNumericOperators.forEach(operator => ValueComparisonNumericSchemaPartial[operator] = z.number().optional());
const ValueComparisonNumericSchema = z.object(ValueComparisonNumericSchemaPartial);
const ValueComparisonContainsSchema = z.object({
    contains: z.union([z.string(), z.number()]),
});
/*
const ValueComparisonArrayContainsSchema = z.object({
    array_contains: z.union([z.string(), z.number()]),
});
*/
const ValueComparisonScalarSchema = z.union([z.string(), z.number()]);

const ValueComparisonSchema = z.union([
    ValueComparisonScalarSchema,
    ValueComparisonContainsSchema,
    //ValueComparisonArrayContainsSchema,
    ValueComparisonNumericSchema,
]);

const ArrayValueComparisonElemMatchSchema = z.object({
    elem_match: z.union([ValueComparisonSchema, WhereFilterSchema]),
});
const ArrayValueComparisonSchema = ArrayValueComparisonElemMatchSchema;


export function isWhereFilterDefinition(x: unknown):x is WhereFilterDefinition {
    return WhereFilterSchema.safeParse(x).success;
}
export function isWhereFilterArray(x:unknown): x is WhereFilterDefinition<any>[] {
    return !!x && Array.isArray(x) && x.every(x => isWhereFilterDefinition(x));
}

export function isValueComparisonContains(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonContains {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "contains" in x;
}

export function isArrayValueComparisonElemMatch(x: unknown): x is ArrayValueComparisonElemMatch {
    return ArrayValueComparisonElemMatchSchema.safeParse(x).success;
}