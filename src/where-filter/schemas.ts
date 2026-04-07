import { z, ZodNumber, ZodOptional, type ZodSchema, type ZodTypeDef } from "zod";
import type {  ArrayValueComparisonAll, ArrayValueComparisonElemMatch, ArrayValueComparisonSize, ValueComparisonEq, ValueComparisonExists, ValueComparisonIn, ValueComparisonNe, ValueComparisonNin, ValueComparisonNot, ValueComparisonRegex, ValueComparisonType, WhereFilterDefinition } from "./types.ts";
import isPlainObject from "../utils/isPlainObject.js";
import { ValueComparisonRangeOperators } from "./consts.ts";

export const UpdatingMethodSchema = z.enum(['merge', 'assign']);

const ValueComparisonRangeNumericSchemaPartial: Record<string, ZodOptional<ZodNumber>> = {};
ValueComparisonRangeOperators.forEach(operator => ValueComparisonRangeNumericSchemaPartial[operator] = z.number().optional());
const ValueComparisonRangeNumericSchema = z.object(ValueComparisonRangeNumericSchemaPartial);
const ValueComparisonScalarSchema = z.union([z.string(), z.number()]);

// Operator schemas
const ValueComparisonEqSchema = z.object({ $eq: z.union([z.string(), z.number(), z.boolean(), z.null()]) });
const ValueComparisonNeSchema = z.object({ $ne: z.union([z.string(), z.number()]) });
const ValueComparisonInSchema = z.object({ $in: z.array(z.union([z.string(), z.number()])) });
const ValueComparisonNinSchema = z.object({ $nin: z.array(z.union([z.string(), z.number()])) });
const ValueComparisonExistsSchema = z.object({ $exists: z.boolean() });
const ValueComparisonTypeSchema = z.object({
    $type: z.enum(['string', 'number', 'bool', 'object', 'array', 'null'])
});
const ValueComparisonRegexSchema = z.object({
    $regex: z.string(),
    $options: z.string().optional()
});
const ArrayValueComparisonSizeSchema = z.object({ $size: z.number().int().min(0) });
const ValueComparisonNotSchema: ZodSchema = z.lazy(() => z.object({
    $not: z.union([
        ValueComparisonRangeNumericSchema,
        ValueComparisonEqSchema,
        ValueComparisonNeSchema,
        ValueComparisonInSchema,
        ValueComparisonNinSchema,
        ValueComparisonRegexSchema,
        ValueComparisonExistsSchema,
        ValueComparisonTypeSchema,
        ArrayValueComparisonSizeSchema,
    ])
}));

const ArrayValueComparisonAllSchema = z.object({ $all: z.array(z.union([z.string(), z.number(), z.record(z.unknown())])) });

const ValueComparisonSchema = z.union([
    ValueComparisonScalarSchema,
    ValueComparisonRangeNumericSchema,
    ValueComparisonEqSchema,
    ValueComparisonNeSchema,
    ValueComparisonInSchema,
    ValueComparisonNinSchema,
    ValueComparisonNotSchema,
    ValueComparisonExistsSchema,
    ValueComparisonTypeSchema,
    ValueComparisonRegexSchema,
]);

const ArrayValueComparisonElemMatchSchema = z.object({
    $elemMatch: z.union([ValueComparisonSchema, z.lazy(() => WhereFilterSchema)]),
});
const ArrayValueComparisonSchema = z.union([
    ArrayValueComparisonElemMatchSchema,
    ArrayValueComparisonAllSchema,
    ArrayValueComparisonSizeSchema,
]);

export const WhereFilterSchema: ZodSchema<WhereFilterDefinition<any>, ZodTypeDef, any> = z.lazy(() =>
    z.union([
        z.record(z.union([
            ValueComparisonSchema,
            ArrayValueComparisonSchema,
            WhereFilterSchema
        ])),
        z.object({
            $or: z.array(WhereFilterSchema).optional(),
            $and: z.array(WhereFilterSchema).optional(),
            $nor: z.array(WhereFilterSchema).optional(),
        }),
    ])
);


export function isWhereFilterDefinition(x: unknown):x is WhereFilterDefinition {
    return WhereFilterSchema.safeParse(x).success;
}
export function isWhereFilterArray(x:unknown): x is WhereFilterDefinition<any>[] {
    return !!x && Array.isArray(x) && x.every(x => isWhereFilterDefinition(x));
}

export function isValueComparisonEq(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonEq {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$eq" in (x as object);
}

export function isArrayValueComparisonElemMatch(x: unknown): x is ArrayValueComparisonElemMatch {
    return ArrayValueComparisonElemMatchSchema.safeParse(x).success;
}

export function isValueComparisonNe(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonNe {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$ne" in (x as object);
}
export function isValueComparisonIn(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonIn {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$in" in (x as object);
}
export function isValueComparisonNin(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonNin {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$nin" in (x as object);
}
export function isValueComparisonNot(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonNot {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$not" in (x as object);
}
export function isValueComparisonExists(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonExists {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$exists" in (x as object);
}
export function isValueComparisonType(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonType {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$type" in (x as object);
}
export function isValueComparisonRegex(x: unknown, alreadyProvedIsPlainObject?: boolean): x is ValueComparisonRegex {
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$regex" in (x as object);
}
export function isArrayValueComparisonAll(x: unknown): x is ArrayValueComparisonAll {
    return ArrayValueComparisonAllSchema.safeParse(x).success;
}
export function isArrayValueComparisonSize(x: unknown): x is ArrayValueComparisonSize {
    return ArrayValueComparisonSizeSchema.safeParse(x).success;
}