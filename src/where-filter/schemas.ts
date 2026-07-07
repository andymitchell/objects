import { z, type ZodSchema } from "zod";
import type {  ArrayValueComparisonAll, ArrayValueComparisonElemMatch, ArrayValueComparisonSize, ValueComparisonEq, ValueComparisonExists, ValueComparisonIn, ValueComparisonNe, ValueComparisonNin, ValueComparisonNot, ValueComparisonRegex, ValueComparisonType, WhereFilterDefinition } from "./types.ts";
import isPlainObject from "../utils/isPlainObject.js";
import { ValueComparisonRangeOperators } from "./consts.ts";

export const UpdatingMethodSchema = z.enum(['merge', 'assign']);

// A filter number operand: any JS number, including NaN and ±Infinity. Zod's `z.number()` rejects the
// non-finite values, but they are legitimate operands here — the matcher defines their semantics
// (`$eq NaN` matches nothing, `$ne NaN` matches everything) and the SQL emitter maps them to JSON null
// (MONGO-DIVERGENCES #7). `$size` keeps `z.number().int().min(0)`: non-finite/float IS malformed there.
const FilterNumber = z.custom<number>((v) => typeof v === 'number', 'expected a number operand');
// A range bound is a string (lexicographic order) or a number — the type allows both.
const RangeOperand = z.union([z.string(), FilterNumber]);

const ValueComparisonRangeNumericSchemaPartial: Record<string, ReturnType<typeof RangeOperand.optional>> = {};
ValueComparisonRangeOperators.forEach(operator => ValueComparisonRangeNumericSchemaPartial[operator] = RangeOperand.optional());
// `.strict()` rejects unknown keys (so `{$mod:…}`/`{$size:-1}`/`{$in:[true]}` no longer silently strip
// down to an empty range and match), and the refine requires at least one real range operator (so `{}` —
// e.g. an empty `$not:{}` payload, or a stripped exotic operand — is not a valid range comparison).
const ValueComparisonRangeNumericSchema = z.object(ValueComparisonRangeNumericSchemaPartial).strict().refine(
    o => ValueComparisonRangeOperators.some(operator => (o as Record<string, unknown>)[operator] !== undefined),
    { message: 'a range comparison needs at least one of $gt/$lt/$gte/$lte' }
);
// Bare scalar field values. Booleans and null are first-class equality operands (`{active:true}`,
// `{secret:null}`) — they must validate here, otherwise they would only survive via the permissive
// logic arm's key-stripping (removed below), regressing every boolean/null field filter.
const ValueComparisonScalarSchema = z.union([z.string(), FilterNumber, z.boolean(), z.null()]);

// Operator schemas
const ValueComparisonEqSchema = z.object({ $eq: z.union([z.string(), FilterNumber, z.boolean(), z.null()]) });
const ValueComparisonNeSchema = z.object({ $ne: z.union([z.string(), FilterNumber]) });
const ValueComparisonInSchema = z.object({ $in: z.array(z.union([z.string(), FilterNumber])) });
const ValueComparisonNinSchema = z.object({ $nin: z.array(z.union([z.string(), FilterNumber])) });
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
        // Recursive: `$not` can wrap another `$not` (double/triple negation). Before the range schema was
        // tightened this nested case only validated by accident (the inner `{$not:…}` stripped to an empty
        // range); it must now be an explicit arm, while `$not:{}` still has no arm to match and is rejected.
        ValueComparisonNotSchema,
    ])
}));

const ArrayValueComparisonAllSchema = z.object({ $all: z.array(z.union([z.string(), z.number(), z.record(z.string(), z.unknown())])) });

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

// A filter is a single plain object that can mix logic operators and field paths (the matcher splits a
// multi-key filter into an implicit `$and`). It is modelled as one object schema, not a union of "logic" vs
// "field" arms, because a real filter may carry both at once (`{ $or:[…], 'contact.name':'Andy' }`).
//
//  - The `isPlainObject` gate rejects non-objects up front — including a `Date`, which `z.object` would
//    otherwise accept as an empty `{}` (letting an exotic operand slip through as a nested filter).
//  - `$or`/`$and`/`$nor` are known keys and MUST be arrays of sub-filters, so `{$or:'x'}` / `{$and:{…}}` are
//    rejected here rather than mis-read as a data field named `$or`.
//  - `.catchall(…)` validates every other key's value as a field comparison: a bare scalar (incl. boolean /
//    null / non-finite number), an exact-array operand, `undefined` (a field filter that never matches), a
//    value/array comparison, or a nested sub-filter.
//  - The refine rejects any remaining `$`-prefixed key (e.g. `{$mod:…}`, a top-level `{$exists:…}`): the only
//    permitted operator keys at object level are the three logic operators.
export const WhereFilterSchema: z.ZodType<WhereFilterDefinition<any>> = z.lazy(() =>
    z.custom<Record<string, unknown>>(isPlainObject, 'filter must be a plain object').pipe(
        z.object({
            $or: z.array(WhereFilterSchema).optional(),
            $and: z.array(WhereFilterSchema).optional(),
            $nor: z.array(WhereFilterSchema).optional(),
        }).catchall(z.union([
            ValueComparisonSchema,
            ArrayValueComparisonSchema,
            z.array(z.unknown()),
            z.undefined(),
            WhereFilterSchema
        ])).refine(
            o => Object.keys(o).every(k => k === '$or' || k === '$and' || k === '$nor' || !k.startsWith('$')),
            { message: 'unknown operator: keys beginning with "$" must be $or/$and/$nor' }
        )
    )
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