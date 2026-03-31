

import type { Draft } from "immer";
import type { DotPropPathsIncArrayUnion, DotPropPathToArraySpreadingArrays, PathValueIncDiscrimatedUnions } from '../dot-prop-paths/types.js';
import type { ValueComparisonRangeOperators, WhereFilterLogicOperators } from './consts.ts';


export type ObjOrDraft<T extends Record<string, any>> = T | Draft<T>;



export type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];


export type ValueComparisonRangeOperatorsTyped = typeof ValueComparisonRangeOperators[number];
export type ValueComparisonRangeNumeric = Partial<Record<ValueComparisonRangeOperatorsTyped, number>>;
export type ValueComparisonContains = { $contains: string };
export type ValueComparisonRangeString = Partial<Record<ValueComparisonRangeOperatorsTyped, string>>;
export type ValueComparisonString = ValueComparisonRangeString | ValueComparisonContains;
export type ValueComparisonRange<T = any> = (T extends string? ValueComparisonRangeString : T extends number? ValueComparisonRangeNumeric : never);
export type ValueComparisonRangeFlexi<T = any> = (T extends string? ValueComparisonRangeString : T extends number? ValueComparisonRangeNumeric : never) | T;
export type ValueComparisonNe<T = any> = { $ne: T extends string ? string : T extends number ? number : never };
export type ValueComparisonIn<T = any> = { $in: (T extends string ? string : T extends number ? number : never)[] };
export type ValueComparisonNin<T = any> = { $nin: (T extends string ? string : T extends number ? number : never)[] };
export type ValueComparisonExists = { $exists: boolean };
export type ValueComparisonType = { $type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' };
export type ValueComparisonRegex = { $regex: string; $options?: string };
export type ValueComparisonNot<T = any> = {
    $not: ValueComparisonRange<T>
          | (T extends string ? ValueComparisonContains : never)
          | ValueComparisonNe<T>
          | ValueComparisonIn<T>
          | ValueComparisonNin<T>
          | (T extends string ? ValueComparisonRegex : never)
};

export type ValueComparisonFlexi<T = any> =
    (T extends string
        ? ValueComparisonString | ValueComparisonRegex
        : T extends number
            ? ValueComparisonRangeNumeric
            : never)
    | ValueComparisonNe<T>
    | ValueComparisonIn<T>
    | ValueComparisonNin<T>
    | ValueComparisonNot<T>
    | ValueComparisonExists
    | ValueComparisonType
    | T;
/** Internal: carries index-sig depth through recursive WhereFilterDefinition references. */
type WhereFilterCore<T extends Record<string, any>, ISD extends number> =
    PartialObjectFilter<T, ISD> | LogicFilter<T, ISD>;

export type ArrayValueComparisonElemMatch<T = any, ISD extends number = 2>  = {$elemMatch: T extends Record<string, any>? WhereFilterCore<T, ISD> : ValueComparisonFlexi<T>};
export type ArrayValueComparisonAll<T = any> = { $all: T[] };
export type ArrayValueComparisonSize = { $size: number };
export type ArrayValueComparison<T = any, ISD extends number = 2> = ArrayValueComparisonElemMatch<T, ISD> | ArrayValueComparisonAll<T> | ArrayValueComparisonSize;

type IsAssignableTo<A, B> = A extends B ? true : false;

type ArrayElementFilter<T = any, ISD extends number = 2> = (T extends Record<string, any>? WhereFilterCore<T, ISD> :
    T extends string | number ? T :
    never) | ArrayValueComparison<T, ISD>
export type ArrayFilter<T extends [], ISD extends number = 2> = ArrayElementFilter<T[number], ISD> | T;

export type PartialObjectFilter<T extends Record<string, any>, ISD extends number = 2> = Partial<{
    [P in DotPropPathsIncArrayUnion<T, ISD>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true
        ? ArrayFilter<PathValueIncDiscrimatedUnions<T, P>, ISD>
        : ValueComparisonFlexi<PathValueIncDiscrimatedUnions<T, P>>
}>;



export type MatchJavascriptObject<T extends Record<string, any> = Record<string, any>> = (object:ObjOrDraft<T>) => boolean;
export type MatchJavascriptObjectWithFilter = <T extends Record<string, any> = Record<string, any>, F extends Record<string, any> = T>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<F>) => boolean;




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
 * | **$contains** | `{ $contains: 'And' }` | Substring match. String values only (throws on numbers). |
 *
 * **Nullish behaviour**: Range/$contains on `undefined`/`null` returns `false` (like SQL NULL).
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
 * ### Compound object filter (implicit per-key OR across elements)
 * Pass a plain object with property keys. **Each key is tested independently** — it only
 * needs *some* element to satisfy each key. Different keys may be satisfied by different elements.
 * ```ts
 * // locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
 * { 'contact.locations': { city: 'London', country: 'US' } }
 * // → true: 'London' found in element 0, 'US' found in element 1
 * ```
 *
 * ### Logic filter on array elements (atomic per element, like `$elemMatch`)
 * When using $and/$or/$nor inside an array filter, each element is tested atomically
 * against the full logic filter. The criteria must be satisfied within a single element.
 * ```ts
 * // locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
 * { 'contact.locations': { $and: [{ city: 'London' }, { country: 'US' }] } }
 * // → false: no single element has both city=London and country=US
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
 * { 'contact.locations': { $elemMatch: { $contains: 'Lon' } } }
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
 * // Substring match
 * const containsFilter = { 'person.name': { $contains: 'And' } };
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






