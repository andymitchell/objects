

import type { Draft } from "immer";
import type { ZodType } from "zod";
import type { DotPropPathsIncArrayUnion, DotPropPathToArraySpreadingArrays, PathValueIncDiscrimatedUnions } from '../dot-prop-paths/types.js';
import type { ValueComparisonRangeOperators, WhereFilterLogicOperators } from './consts.ts';


export type ObjOrDraft<T extends Record<string, any>> = T | Draft<T>;



export type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];


export type ValueComparisonRangeOperatorsTyped = typeof ValueComparisonRangeOperators[number];
export type ValueComparisonRangeNumeric = Partial<Record<ValueComparisonRangeOperatorsTyped, number>>;
export type ValueComparisonRangeString = Partial<Record<ValueComparisonRangeOperatorsTyped, string>>;
export type ValueComparisonRange<T = any> = (T extends string? ValueComparisonRangeString : T extends number? ValueComparisonRangeNumeric : never);
export type ValueComparisonRangeFlexi<T = any> = (T extends string? ValueComparisonRangeString : T extends number? ValueComparisonRangeNumeric : never) | T;

/** True only when `T` is exactly `any` — short-circuits {@link JsonCompatible} so it doesn't distribute over every branch. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Decrement table for {@link JsonCompatible}'s recursion-depth cap: `Prev[6]` is `5` … `Prev[1]` is `0`. */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6];

/**
 * Narrows `T` to its JSON-serialisable subset, mapping any non-JSON carrier to `never`.
 *
 * Carriers with no portable JSON form — `bigint`, `symbol`, functions, `Date`, `RegExp`,
 * `Map`/`Set`/`WeakMap`/`WeakSet`, `Promise` — collapse to `never`; plain objects and arrays recurse
 * (preserving `readonly` and optional modifiers via a homomorphic mapped type); scalars pass through.
 *
 * @remarks
 * Mirrors the runtime serialisable-subset gate at the type level, but is a strict subset of it: a
 * structurally-plain class instance is indistinguishable from a plain object in the type system, so only the
 * runtime gate catches those. Recursion is capped at `Depth` levels; beyond the cap `T` passes through unchanged
 * (a residual hole for pathologically deep or self-referential schemas). `any` passes through unchanged. Tuples
 * are treated as arrays — positional structure is flattened to the element union.
 */
export type JsonCompatible<T, Depth extends number = 6> =
    IsAny<T> extends true
        ? T
        : Depth extends 0
            ? T
            : T extends bigint | symbol | Function
                ? never
                : T extends Date | RegExp | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any> | Promise<any>
                    ? never
                    : T extends readonly (infer U)[]
                        ? T extends unknown[]
                            ? JsonCompatible<U, Prev[Depth]>[]
                            : readonly JsonCompatible<U, Prev[Depth]>[]
                        : T extends object
                            ? { [K in keyof T]: JsonCompatible<T[K], Prev[Depth]> }
                            : T;

export type ValueComparisonEq<T = any> = { $eq: T extends string ? string : T extends number ? number : T extends boolean ? boolean : never };
export type ValueComparisonNe<T = any> = { $ne: T extends string ? string : T extends number ? number : never };
export type ValueComparisonIn<T = any> = { $in: (T extends string ? string : T extends number ? number : T extends boolean ? boolean : never)[] };
export type ValueComparisonNin<T = any> = { $nin: (T extends string ? string : T extends number ? number : T extends boolean ? boolean : never)[] };
export type ValueComparisonExists = { $exists: boolean };
export type ValueComparisonType = { $type: 'string' | 'number' | 'bool' | 'object' | 'array' | 'null' };
export type ValueComparisonRegex = { $regex: string; $options?: string };
export type ValueComparisonNot<T = any> = {
    $not: ValueComparisonRange<T>
          | ValueComparisonEq<T>
          | ValueComparisonNe<T>
          | ValueComparisonIn<T>
          | ValueComparisonNin<T>
          | (T extends string ? ValueComparisonRegex : never)
          | ValueComparisonExists
          | ValueComparisonType
          | ArrayValueComparisonSize
};

/**
 * Every value-operator payload that may condition one field, parameterised by the type of the value being
 * compared.
 *
 * A scalar field compares its own value, so `T` is the field's type. An array field compares each ELEMENT in
 * turn (the field matches when any one element satisfies the payload), so there `T` is the element type — the
 * same vocabulary, applied one level down. Operators that cannot express a given `T` collapse to `never`:
 * `$regex` exists only for strings, `$ne` only for strings and numbers.
 *
 * @remarks
 * Mirrors the runtime gate, which admits this operator set on any field regardless of the field's shape.
 */
type ValueComparisonOperators<T = any> =
    ValueComparisonRange<T>
    | (T extends string ? ValueComparisonRegex : never)
    | ValueComparisonEq<T>
    | ValueComparisonNe<T>
    | ValueComparisonIn<T>
    | ValueComparisonNin<T>
    | ValueComparisonNot<T>
    | ValueComparisonExists
    | ValueComparisonType;

export type ValueComparisonFlexi<T = any> =
    ValueComparisonOperators<T>
    // Bare value, narrowed to its JSON-serialisable subset. Non-JSON carriers — `bigint`, `symbol`, `Date`,
    // `Map`/`Set`, functions — cannot round-trip JSON, so the runtime gate rejects them (MONGO-DIVERGENCES.md #9)
    // and `JsonCompatible` collapses them to `never` here too, recursively (a nested `Date` inside an object
    // operand is rejected). Structurally-plain class instances remain a type-level hole caught only at runtime.
    | JsonCompatible<T>;
/** Internal: carries index-sig depth through recursive WhereFilterDefinition references. */
type WhereFilterCore<T extends Record<string, any>, ISD extends number> =
    PartialObjectFilter<T, ISD> | LogicFilter<T, ISD>;

export type ArrayValueComparisonElemMatch<T = any, ISD extends number = 2>  = {$elemMatch: T extends Record<string, any>? WhereFilterCore<T, ISD> : ValueComparisonFlexi<T>};
// `$all` operands are DATA, and share the bare value's JSON-serialisable domain: non-JSON carriers as elements
// collapse to `never` via `JsonCompatible` (see {@link ValueComparisonFlexi} and DECISIONS.md).
export type ArrayValueComparisonAll<T = any> = { $all: JsonCompatible<T>[] };
/**
 * `$size` matches an array of exactly `n` elements. The type is a plain `number`, but the runtime gate
 * enforces a non-negative integer — a float or negative `$size` is rejected as malformed (§25), a constraint
 * TypeScript cannot express in the type.
 */
export type ArrayValueComparisonSize = { $size: number };
export type ArrayValueComparison<T = any, ISD extends number = 2> = ArrayValueComparisonElemMatch<T, ISD> | ArrayValueComparisonAll<T> | ArrayValueComparisonSize;

type IsAssignableTo<A, B> = A extends B ? true : false;

// A scalar element takes the full value-operator vocabulary, read element-wise, plus the bare element as a
// containment test. An OBJECT element deliberately does not take the comparison family ($eq/$ne/range/$regex):
// its filter arm is `PartialObjectFilter`, whose keys are all optional, and TypeScript disables the excess-
// property check on a union as soon as a key is known in ANY member — so admitting `$eq` beside it would let
// an arbitrary unchecked operand through (`{addresses: {$eq: 5}}`). The runtime gate rejects an object operand
// for those operators anyway; an object element is filtered with a sub-document filter or `$elemMatch`.
type ArrayElementFilter<T = any, ISD extends number = 2> =
    (T extends Record<string, any>
        ? PartialObjectFilter<T, ISD> | ValueComparisonIn<T> | ValueComparisonNin<T> | ValueComparisonNot<T> | ValueComparisonExists | ValueComparisonType
        : (T extends string | number | boolean ? T : never) | ValueComparisonOperators<T>)
    | ArrayValueComparison<T, ISD>;
export type ArrayFilter<T extends [], ISD extends number = 2> = ArrayElementFilter<T[number], ISD> | T;

export type PartialObjectFilter<T extends Record<string, any>, ISD extends number = 2> = Partial<{
    [P in DotPropPathsIncArrayUnion<T, ISD>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true
        ? ArrayFilter<PathValueIncDiscrimatedUnions<T, P>, ISD>
        : ValueComparisonFlexi<PathValueIncDiscrimatedUnions<T, P>>
}>;


// ---- Strict variant: rejects logic operators at every depth ----
// Mirrors the WhereFilterCore → ArrayValueComparisonElemMatch → ArrayValueComparison
// → ArrayElementFilter → ArrayFilter → PartialObjectFilter chain, but every
// recursion target is the strict variant so $and/$or/$nor cannot appear anywhere.

type ArrayValueComparisonElemMatchStrict<T = any, ISD extends number = 2> = {
    $elemMatch: T extends Record<string, any> ? PartialObjectFilterStrict<T, ISD> : ValueComparisonFlexi<T>
};

type ArrayValueComparisonStrict<T = any, ISD extends number = 2> =
    ArrayValueComparisonElemMatchStrict<T, ISD> | ArrayValueComparisonAll<T> | ArrayValueComparisonSize;

type ArrayElementFilterStrict<T = any, ISD extends number = 2> =
    (T extends Record<string, any>
        ? PartialObjectFilterStrict<T, ISD> | ValueComparisonIn<T> | ValueComparisonNin<T> | ValueComparisonNot<T> | ValueComparisonExists | ValueComparisonType
        : (T extends string | number | boolean ? T : never) | ValueComparisonOperators<T>)
    | ArrayValueComparisonStrict<T, ISD>;

type ArrayFilterStrict<T extends [], ISD extends number = 2> = ArrayElementFilterStrict<T[number], ISD> | T;

/**
 * Like {@link PartialObjectFilter}, but rejects the logic operators
 * (`$and` / `$or` / `$nor`) at every depth — including inside `$elemMatch` and
 * inside compound-object-filter-on-array.
 *
 * Why: for consumers whose downstream matcher does not register compound
 * operators (notably CASL's default `createMongoAbility`, where top-level
 * boolean operators silently never match — the worst failure mode for an
 * access-control library). Use this in place of `PartialObjectFilter` /
 * `WhereFilterDefinition` when you need a compile error rather than a
 * silent runtime no-op.
 *
 * Field-level operators (`$in`, `$nin`, `$gt`, `$elemMatch`, etc.) are still
 * allowed — only the compound-logic shapes are excluded.
 *
 * @example
 * // OK — field operators only
 * const ok: PartialObjectFilterStrict<Doc> = { name: 'Andy', age: { $gte: 18 } };
 *
 * @example
 * // OK — $elemMatch with field operators inside
 * const ok2: PartialObjectFilterStrict<Doc> = {
 *     contacts: { $elemMatch: { city: 'London', country: 'UK' } }
 * };
 *
 * @example
 * // Compile error — top-level $or
 * // @ts-expect-error — $or rejected by PartialObjectFilterStrict
 * const bad1: PartialObjectFilterStrict<Doc> = { $or: [{ name: 'Andy' }] };
 *
 * @example
 * // Compile error — $or nested in $elemMatch
 * // @ts-expect-error — $or inside $elemMatch rejected by PartialObjectFilterStrict
 * const bad2: PartialObjectFilterStrict<Doc> = {
 *     contacts: { $elemMatch: { $or: [{ city: 'London' }] } }
 * };
 */
export type PartialObjectFilterStrict<T extends Record<string, any>, ISD extends number = 2> = Partial<{
    [P in DotPropPathsIncArrayUnion<T, ISD>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true
        ? ArrayFilterStrict<PathValueIncDiscrimatedUnions<T, P>, ISD>
        : ValueComparisonFlexi<PathValueIncDiscrimatedUnions<T, P>>
}>;



export type MatchJavascriptObject<T extends Record<string, any> = Record<string, any>> = (object:ObjOrDraft<T>) => boolean;

/**
 * Opt-in conformance options for `matchJavascriptObject`. When supplied, the value-driven matcher is held to
 * the same lowest-common-denominator contract as the schema-driven SQL emitter: a shape-ambiguous
 * (`scalar | array`) schema is rejected, and the object is validated against the schema before matching.
 */
export type UniversalSchemaConformance<T extends Record<string, any> = Record<string, any>> = {
    /** The Zod schema the object must conform to (and that must not be shape-ambiguous). */
    schema: ZodType<T>;
    /** Default `false`. `true` asserts the object is already validated, skipping the per-object check (perf bypass) — the shape-ambiguity check always runs. */
    objectValidatedAgainstSchema?: boolean;
};

/** Options bag for `matchJavascriptObject`'s optional third argument. */
export type MatchJavascriptObjectOptions<T extends Record<string, any> = Record<string, any>> = {
    universalSchemaConformance?: UniversalSchemaConformance<T>;
};

export type MatchJavascriptObjectWithFilter = <T extends Record<string, any> = Record<string, any>, F extends Record<string, any> = T>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<F>, options?:MatchJavascriptObjectOptions<T>) => boolean;




export type LogicFilter<T extends Record<string, any>, ISD extends number = 2> = {
    [K in WhereFilterLogicOperatorsTyped]?: WhereFilterCore<T, ISD>[];
}

/**
 * Defines a serialisable JSON query for filtering plain JavaScript objects, similar to a
 * WHERE clause in database queries. Loosely inspired by MongoDB query syntax.
 *
 * Use `matchJavascriptObject(object, filter)` to evaluate a filter against an object, or
 * `compileMatchJavascriptObject(filter)` to create a reusable matcher function.
 *
 * ---
 * ## Spec
 *
 * A `WhereFilterDefinition` is one of two forms:
 *
 * ### 1. Partial Object Filter
 *
 * An object whose keys are **property paths** and whose values are **value comparisons**.
 * Use dot notation for nested properties.
 *
 * ```ts
 * { 'contact.name': 'Andy' }
 * { 'contact.age': { $gte: 18 } }
 * ```
 *
 * **Implicit $and**: When multiple keys are present, all must match (treated as $and).
 * ```ts
 * { 'contact.name': 'Andy', 'contact.age': 100 }
 * // equivalent to: { $and: [{ 'contact.name': 'Andy' }, { 'contact.age': 100 }] }
 * ```
 *
 * ### 2. Logic Filter
 *
 * An object with one or more logic operator keys, each containing an array of
 * sub-filters (WhereFilterDefinition[]).
 *
 * | Operator | Semantics                                      |
 * |----------|-------------------------------------------------|
 * | `$and`   | All sub-filters must match (`every`)            |
 * | `$or`    | At least one sub-filter must match (`some`)     |
 * | `$nor`   | No sub-filter must match (negated `some`)       |
 *
 * Multiple operators on one object are ANDed together:
 * ```ts
 * { $and: [...], $nor: [...] }  // both the $and and $nor clauses must pass
 * ```
 *
 * ---
 * ## Value Comparisons (scalar properties)
 *
 * | Form | Example | Behaviour |
 * |------|---------|-----------|
 * | **Exact scalar** | `'Andy'`, `100`, `true` | Strict equality (`===`) for string, number, boolean |
 * | **Deep object equality** | `{ name: 'Andy', age: 30 }` | Deep equality (all keys must match) |
 * | **Range operators** | `{ $gt: 10, $lte: 100 }` | `$gt`, `$lt`, `$gte`, `$lte`. Multiple operators are ANDed. Works on numbers (numeric) and strings (lexicographic / JS code-point order, case-sensitive). |
 * | **$eq** | `{ $eq: 'Andy' }` | Explicit equality (`===`). `{ $eq: null }` matches null/missing. |
 * | **$regex** | `{ $regex: 'And', $options: 'i' }` | Regex match. String values only. |
 *
 * **Multiple operators on one field are ANDed** (Mongo's implicit `$and`): `{ $gte: 18, $ne: 30 }` matches
 * when *every* operator matches — identical to `{ $and: [{ field: { $gte: 18 } }, { field: { $ne: 30 } }] }`.
 * Each operator keeps its own single-operator semantics, including missing-field behaviour
 * (`$ne`/`$nin`/`$not`/`$exists:false` match a missing field; range/`$regex`/`$in` on a missing field are
 * `false`). `$regex` + `$options` count as one predicate. The result is order-independent.
 *
 * **Nullish behaviour**: Range/$regex on `undefined`/`null` returns `false` (like SQL NULL).
 *
 * **Type safety**: Range comparison throws if the filter type differs from the value type
 * (e.g. comparing a number value against a string filter).
 *
 * ---
 * ## Array Filtering
 *
 * When the resolved property is an array, there are several matching modes:
 *
 * ### Exact array match
 * Pass an array literal; uses deep equality.
 * ```ts
 * { 'contact.locations': ['London', 'NYC'] }
 * ```
 *
 * ### Scalar element match (implicit `indexOf`)
 * Pass a scalar; returns true if any element equals it.
 * ```ts
 * { 'contact.locations': 'London' }
 * ```
 *
 * ### Value comparison (element-wise)
 * A value operator on an array field is applied to each element in turn, and the field matches when **any
 * one** element satisfies it — the operator descends into the array rather than comparing the array itself.
 * The operand is therefore the ELEMENT's type, and the full value vocabulary is available (`$eq`, `$ne`,
 * ranges, `$regex`, `$in`, `$nin`, `$not`, `$exists`, `$type`).
 * ```ts
 * // tags: ['ann', 'bob']
 * { tags: { $eq: 'ann' } }        // → true: an element equals it
 * { tags: { $regex: '^a' } }      // → true: an element matches the pattern
 * { tags: { $not: { $eq: 'ann' } } }  // → false: the exact complement — NO element may equal it
 * ```
 * `$not` complements the whole element-wise question, so it excludes an array that holds the operand — which
 * is why `$ne` on an array means "no element equals it", not "some element differs from it".
 *
 * Each bound of a multi-operator payload is applied independently, so different elements may satisfy
 * different bounds. `$elemMatch` asks the stricter question — one single element must satisfy the whole body.
 * ```ts
 * // nums: [1, 5]
 * { nums: { $gt: 2, $lt: 4 } }                  // → true: 5 satisfies $gt:2, 1 satisfies $lt:4
 * { nums: { $elemMatch: { $gt: 2, $lt: 4 } } }  // → false: no ONE element satisfies both
 * ```
 * An array of OBJECTS takes a compound object filter or `$elemMatch` instead of the comparison family (an
 * object element has no meaningful `$eq`/range/`$regex` operand).
 *
 * ### Compound object filter (exact document match — Mongo semantics)
 * Pass a plain object with property keys. A **single element** must satisfy **all** keys.
 * ```ts
 * // locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
 * { 'contact.locations': { city: 'London', country: 'UK' } }
 * // → true: element 0 satisfies both keys
 * { 'contact.locations': { city: 'London', country: 'US' } }
 * // → false: no single element has both city=London and country=US
 * ```
 *
 * To match keys across different elements, use dot-prop spreading:
 * ```ts
 * { 'contact.locations.city': 'London', 'contact.locations.country': 'US' }
 * // → true: city=London in element 0, country=US in element 1
 * ```
 *
 * ### `$elemMatch` (explicit single-element matching)
 * Requires that **one** array element satisfies all criteria.
 * ```ts
 * // For object arrays — value is a WhereFilterDefinition applied to each element:
 * { 'contact.locations': { $elemMatch: { city: 'London', country: 'UK' } } }
 *
 * // For scalar arrays — value is a scalar or value comparison:
 * { 'contact.locations': { $elemMatch: 2 } }
 * { 'contact.locations': { $elemMatch: { $regex: 'Lon' } } }
 * ```
 *
 * ---
 * ## Spreading Arrays (nested arrays in dot paths)
 *
 * When a dot-notation path crosses through multiple arrays
 * (e.g. `'children.grandchildren'` where both are arrays), intermediate arrays are expanded
 * and combined with **$or semantics**. The compound filter must pass within the context of
 * one leaf array.
 * ```ts
 * // children: [{ grandchildren: [{name: 'Rita'}] }, { grandchildren: [{name: 'Bob'}] }]
 * { 'children.grandchildren': { grandchild_name: 'Rita' } }
 * // → true: found in the first child's grandchildren array
 * ```
 *
 * ---
 * ## Operand domain & structural validity
 *
 * **Operand domain — the portable (JSON) value subset.** Data and operand positions (a bare scalar, an
 * `$eq`/range/`$in` operand, an exact-array element, an `$all` element) accept `string | number | boolean
 * | null` and plain objects/arrays thereof, plus non-finite numbers (`NaN`/`±Infinity`) as the one
 * documented exception (accepted as operands, but lossy through SQL storage). A non-JSON carrier —
 * `Date`, `bigint`, `Symbol`, `Map`, `Set`, or an explicit `undefined` element — is **rejected at the
 * validity gate** (`isWhereFilterDefinition`), so the matcher throws rather than silently mis-evaluating
 * (the JS matcher deep-equals a `Date`; SQL's `JSON.stringify` morphs it to an ISO string or throws on a
 * `bigint`). See MONGO-DIVERGENCES.md #9 (and #7 for the accepted-but-lossy non-finite numbers).
 *
 * **Present-undefined is malformed.** An explicitly-`undefined` operator or logic value is rejected —
 * `{ age: { $gt: undefined } }`, `{ age: { $lt: 5, $gt: undefined } }`, `{ $or: undefined }`,
 * `{ name: { $regex: 'a', $options: undefined } }` — as is an unknown operator riding a known one
 * (`{ age: { $eq: 5, $mod: 3 } }`). A bare `{ field: undefined }` field value stays valid but matches
 * nothing (see Edge Cases).
 *
 * ---
 * ## Edge Cases
 *
 * | Filter | Result | Reason |
 * |--------|--------|--------|
 * | `{}` | matches all | No conditions to fail |
 * | `{ $or: [] }` | matches nothing | No conditions to succeed (`some` on empty = false) |
 * | `{ $and: [] }` | matches all | No conditions to fail (`every` on empty = true) |
 * | `{ 'x': undefined }` | `false` | Undefined filter value never matches |
 *
 * ---
 *
 * @example
 * // Simple filter on a top-level property
 * const filterById = { id: '123' };
 *
 * @example
 * // Filter using dot notation for a nested property
 * const filterByNestedChildName = { 'person.child.name': 'Alice' };
 *
 * @example
 * // Logic operator ($or)
 * const logicalFilter = {
 *   $or: [
 *     { isPriority: true },
 *     { status: 'completed' }
 *   ]
 * };
 *
 * @example
 * // Range comparison
 * const numericFilter = { 'person.age': { $gt: 30 } };
 *
 * @example
 * // Regex match
 * const regexFilter = { 'person.name': { $regex: 'And' } };
 *
 * @example
 * // $elemMatch on an array of objects
 * const elemMatchFilter = {
 *   'contact.locations': {
 *     $elemMatch: { city: 'London', country: 'UK' }
 *   }
 * };
 *
 * @note It is loosely inspired by MongoDB query syntax.
 *
 * @note When using `WhereFilterDefinition` as a function parameter, TypeScript may have trouble
 * inferring whether it's a logic filter or a partial object filter. To resolve this,
 * you can use type guards like `isLogicFilter` or `isPartialObjectFilter` to narrow
 * the type before accessing its properties.
 *
 * ---
 * ## Index-signature depth limit
 *
 * When your schema contains index-signature types (e.g. `Record<string, X>`,
 * `{[key: string]: JsonValue}`), dot-prop paths through those types are limited to
 * **2 levels** of depth. This prevents IDE hangs caused by infinite template literal
 * expansion (e.g. `${string}.${string}.${string}...`).
 *
 * If you get a type error on a deeply nested path through an index-signature type,
 * you have two options:
 *
 * 1. Use `WhereFilterDefinitionDeep<T>` which defaults to 6 levels of index-sig depth,
 *    or `WhereFilterDefinitionDeep<T, 4>` for a custom depth. Be aware that higher
 *    depths may slow IDE responsiveness for schemas with recursive index-sig types
 *    (e.g. `JsonValue`).
 *
 * 2. Use `// @ts-expect-error` to suppress the error on that line (weaker, as it
 *    won't catch future regressions if the path becomes valid).
 *
 * Normal (non-index-sig) properties are always traversed to the full depth of 6
 * regardless of this limit.
 */
export type WhereFilterDefinition<T extends Record<string, any> = any> =
    PartialObjectFilter<T>
    |
    LogicFilter<T>;

/**
 * Like {@link WhereFilterDefinition}, but allows deeper dot-prop paths through
 * index-signature types (e.g. `Record<string, X>`, `{[key: string]: JsonValue}`).
 *
 * The second generic `IndexSigDepth` controls how many levels deep paths can go
 * through index signatures (default: 6). Higher values give more precise typing
 * but may slow IDE responsiveness for schemas with recursive index-sig types.
 *
 * @example
 * // Default deep (6 levels through index sigs)
 * const filter: WhereFilterDefinitionDeep<MySchema> = { 'data.nested.deep.path': 'value' };
 *
 * @example
 * // Custom depth (4 levels)
 * const filter: WhereFilterDefinitionDeep<MySchema, 4> = { 'data.nested.path': 'value' };
 */
export type WhereFilterDefinitionDeep<
    T extends Record<string, any> = any,
    IndexSigDepth extends number = 6
> = WhereFilterCore<T, IndexSigDepth>;

export type UpdatingMethod = 'merge' | 'assign';






/*
type ExampleGeneric<T> = {
    name: string, 
    age: number,
    address: T
}
const a:WhereFilterDefinition<ExampleGeneric<{city: string}>> = {
    age: 1
};
class Bob<T> {
    constructor() {
        this.list({})
    }
    list(where: WhereFilterDefinition<ExampleGeneric<T>>) {

    }
}
*/

    

// Recursive definition of WhereFilter
// The 3rd 'any' is to stop TypeScript panicking "Type instantiation is excessively deep and possibly infinite.": https://github.com/colinhacks/zod/issues/577






