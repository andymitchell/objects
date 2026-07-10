import { z, type ZodSchema } from "zod";
import type {  ArrayValueComparisonAll, ArrayValueComparisonElemMatch, ArrayValueComparisonSize, ValueComparisonEq, ValueComparisonExists, ValueComparisonIn, ValueComparisonNe, ValueComparisonNin, ValueComparisonNot, ValueComparisonRegex, ValueComparisonType, WhereFilterDefinition } from "./types.ts";
import isPlainObject from "../utils/isPlainObject.js";
import { WhereFilterLogicOperators } from "./consts.ts";

export const UpdatingMethodSchema = z.enum(['merge', 'assign']);

// A filter number operand: any JS number, including NaN and ±Infinity. Zod's `z.number()` rejects the
// non-finite values, but they are legitimate operands here — the matcher defines their semantics
// (`$eq NaN` matches nothing, `$ne NaN` matches everything) and the SQL emitter maps them to JSON null
// (MONGO-DIVERGENCES #7). `$size` keeps `z.number().int().min(0)`: non-finite/float IS malformed there.
const FilterNumber = z.custom<number>((v) => typeof v === 'number', 'expected a number operand');
// A range bound is a string (lexicographic order) or a number — the type allows both.
const RangeOperand = z.union([z.string(), FilterNumber]);

// Operand domain for array-DATA positions (an exact-array operand and each `$all` element). The JSON-
// serialisable value subset: string, any number (incl. NaN/±Inf — the FilterNumber principle), boolean,
// null, and plain objects/arrays thereof. `$`-prefixed keys are permitted here as literal DATA. Non-JSON
// carriers (Date/Map/Set/RegExp/class instance, bigint, Symbol, undefined) are rejected: the SQL emitters
// serialise operands with JSON.stringify, which corrupts a Date to an ISO string and throws on a bigint, so
// admitting them would be a silent cross-engine divergence. `isFilterDataObject` mirrors findNonJsonValues.ts:66
// (a plain object is Object.prototype- or null-prototyped) — deliberately NOT utils/isPlainObject.ts, whose
// NODE_ENV branch is looser.
const isFilterDataObject = (v: unknown): v is Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};
export const FilterDataValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
    z.string(), FilterNumber, z.boolean(), z.null(),
    z.array(FilterDataValueSchema),
    z.custom<Record<string, unknown>>(isFilterDataObject).pipe(z.record(z.string(), FilterDataValueSchema)),
]));

// Bare scalar field values. Booleans and null are first-class equality operands (`{active:true}`,
// `{secret:null}`) — they must validate here, otherwise a boolean/null field filter would be rejected.
const ValueComparisonScalarSchema = z.union([z.string(), FilterNumber, z.boolean(), z.null()]);

// Per-operator operands (each optional in the combined payloads below).
const EqOperand = z.union([z.string(), FilterNumber, z.boolean(), z.null()]);
const ScalarOperand = z.union([z.string(), FilterNumber]);              // $ne
const ScalarListOperand = z.array(z.union([z.string(), FilterNumber])); // $in / $nin (null stays excluded)
const TypeOperand = z.enum(['string', 'number', 'bool', 'object', 'array', 'null']);

// `$size`: an integer ≥ 0 — non-finite/float/negative IS malformed. `.strict()` so a piggybacked key
// (`{$size:1,$mod:2}`) inside a `$not` is rejected, not silently stripped.
const ArrayValueComparisonSizeSchema = z.object({ $size: z.number().int().min(0) }).strict();

// A payload's own keys must all be DEFINED: a present-but-undefined operator (`{$gt:5,$lt:undefined}`) is
// malformed — JS throws on it, the SQL emitters silently drop the bound. Checked on the RAW input because
// Zod's treatment of explicit-undefined optional keys is an undocumented internal we do not depend on.
const noPresentUndefinedKeys = (v: unknown): boolean =>
    isPlainObject(v) && Object.keys(v as object).every(k => (v as Record<string, unknown>)[k] !== undefined);

// A SCALAR (value) field condition: one plain object carrying one or more value operators; several means
// their conjunction (Mongo AND). `.strict()` rejects an unknown operator riding alongside a known one; the
// refines require at least one operator and pair `$options` with `$regex`. `$not` wraps a value payload or a
// bare `$size` (recursive: `$not` can negate another `$not`).
// Exported for `ast/operators.test.ts`, which pins that this payload admits exactly the registry's value
// operators (the gate ⟷ operator-registry drift guard). Not part of the package's public surface.
export const ValueOpsPayloadSchema: ZodSchema = z.lazy(() =>
    z.custom<Record<string, unknown>>(noPresentUndefinedKeys).pipe(
        z.object({
            $eq: EqOperand.optional(),
            $ne: ScalarOperand.optional(),
            $in: ScalarListOperand.optional(),
            $nin: ScalarListOperand.optional(),
            $not: z.union([ValueOpsPayloadSchema, ArrayValueComparisonSizeSchema]).optional(),
            $exists: z.boolean().optional(),
            $type: TypeOperand.optional(),
            $regex: z.string().optional(),
            $options: z.string().optional(),
            $gt: RangeOperand.optional(),
            $gte: RangeOperand.optional(),
            $lt: RangeOperand.optional(),
            $lte: RangeOperand.optional(),
        }).strict()
            .refine(o => Object.keys(o).length >= 1, { message: 'a value comparison needs at least one operator' })
            .refine(o => !('$options' in o) || '$regex' in o, { message: '$options requires $regex' })
    )
);

// `$all` accepts the widened JSON operand domain (booleans / null / non-finite numbers / plain objects were
// wrongly rejected before). Kept as its own schema so the `isArrayValueComparisonAll` guard — which the JS
// matcher dispatches on — widens in lock-step with the gate, with zero matcher edits.
const ArrayValueComparisonAllSchema = z.object({ $all: z.array(FilterDataValueSchema) });

// A `$elemMatch` body: a scalar operand, a value-operator payload, or a nested sub-filter (a field-path
// object). Array-category operators inside `$elemMatch` were rejected before — preserved by excluding them.
const ElemMatchBodySchema = z.union([ValueComparisonScalarSchema, ValueOpsPayloadSchema, z.lazy(() => WhereFilterSchema)]);
const ArrayValueComparisonElemMatchSchema = z.object({ $elemMatch: ElemMatchBodySchema });

// An ARRAY field condition: one plain object carrying one or more array operators (AND). `$in`/`$nin`/`$not`/
// `$exists`/`$type` are SHARED with the value payload (meaningful on arrays too); `$elemMatch`/`$all`/`$size`
// are array-only. A payload mixing an array-only operator with a value-only one (`{$size:2,$gt:5}`) fails
// this strict schema AND the value payload's strict schema → rejected as cross-category, matching the type.
// Exported for the gate ⟷ operator-registry drift guard — see {@link ValueOpsPayloadSchema}.
export const ArrayOpsPayloadSchema: ZodSchema = z.lazy(() =>
    z.custom<Record<string, unknown>>(noPresentUndefinedKeys).pipe(
        z.object({
            $elemMatch: ElemMatchBodySchema.optional(),
            $all: z.array(FilterDataValueSchema).optional(),
            $size: z.number().int().min(0).optional(),
            $in: ScalarListOperand.optional(),
            $nin: ScalarListOperand.optional(),
            $not: z.union([ValueOpsPayloadSchema, ArrayValueComparisonSizeSchema]).optional(),
            $exists: z.boolean().optional(),
            $type: TypeOperand.optional(),
        }).strict()
            .refine(o => Object.keys(o).length >= 1, { message: 'an array comparison needs at least one operator' })
    )
);

// The value a non-logic (field-path) key may hold: a bare scalar, a value- or array-operator payload, an
// exact-array operand (JSON subset), `undefined` (a field filter that never matches), or a nested sub-filter.
// Exported for the validator, which localises a malformed field condition by parsing against exactly this.
export const WhereFilterFieldConditionSchema: ZodSchema = z.union([
    ValueComparisonScalarSchema,
    ValueOpsPayloadSchema,
    ArrayOpsPayloadSchema,
    z.array(FilterDataValueSchema),
    z.undefined(),
    z.lazy(() => WhereFilterSchema),
]);

// A filter is a single plain object that can mix logic operators and field paths (the matcher splits a
// multi-key filter into an implicit `$and`). It is modelled as one object schema, not a union of "logic" vs
// "field" arms, because a real filter may carry both at once (`{ $or:[…], 'contact.name':'Andy' }`).
//
//  - The pre-gate rejects non-objects up front — including a `Date`, which `z.object` would otherwise accept
//    as an empty `{}` — AND a present-but-undefined logic operator (`{$or:undefined}`), checked on raw input
//    (a matcher would treat `$or:undefined` as a data path and silently never match).
//  - `$or`/`$and`/`$nor` are known keys and MUST be arrays of sub-filters, so `{$or:'x'}` / `{$and:{…}}` are
//    rejected here rather than mis-read as a data field named `$or`.
//  - `.catchall(…)` validates every other key's value as a field condition (see WhereFilterFieldConditionSchema).
//  - The refine rejects any remaining `$`-prefixed key (e.g. `{$mod:…}`, a top-level `{$exists:…}`): the only
//    permitted operator keys at object level are the three logic operators.
export const WhereFilterSchema: z.ZodType<WhereFilterDefinition<any>> = z.lazy(() =>
    z.custom<Record<string, unknown>>(
        v => isPlainObject(v) && WhereFilterLogicOperators.every(k => !(k in (v as object)) || (v as Record<string, unknown>)[k] !== undefined),
        'filter must be a plain object with no present-undefined logic operator'
    ).pipe(
        z.object({
            $or: z.array(WhereFilterSchema).optional(),
            $and: z.array(WhereFilterSchema).optional(),
            $nor: z.array(WhereFilterSchema).optional(),
        }).catchall(WhereFilterFieldConditionSchema).refine(
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