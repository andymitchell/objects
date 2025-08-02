

import type { DotPropPathsIncArrayUnion, DotPropPathToArraySpreadingArrays, PathValueIncDiscrimatedUnions } from '../dot-prop-paths/types.js';
import type { ValueComparisonNumericOperators, WhereFilterLogicOperators } from './consts.ts';


import type { ObjOrDraft } from "./matchJavascriptObject.js";



export type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];


export type ValueComparisonNumericOperatorsTyped = typeof ValueComparisonNumericOperators[number];
export type ValueComparisonNumeric = Partial<Record<ValueComparisonNumericOperatorsTyped, number>>;
export type ValueComparisonContains = { contains: string };
export type ValueComparison<T = any> = (T extends string? ValueComparisonContains : T extends number? ValueComparisonNumeric : never) | T;
export type ArrayValueComparisonElemMatch<T = any>  = {elem_match: T extends Record<string, any>? WhereFilterDefinition<T> : ValueComparison<T>};
export type ArrayValueComparison<T = any> = ArrayValueComparisonElemMatch<T>;

type IsAssignableTo<A, B> = A extends B ? true : false;

type ArrayElementFilter<T = any> = (T extends Record<string, any>? WhereFilterDefinition<T> :
    T extends string | number ? T : 
    never) | ArrayValueComparison<T>
export type ArrayFilter<T extends []> = ArrayElementFilter<T[number]> | T;

export type PartialObjectFilter<T extends Record<string, any>> = Partial<{
    [P in DotPropPathsIncArrayUnion<T>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true
        ? ArrayFilter<PathValueIncDiscrimatedUnions<T, P>>
        : ValueComparison<PathValueIncDiscrimatedUnions<T, P>>
}>;



export type MatchJavascriptObject<T extends Record<string, any> = Record<string, any>> = (object:ObjOrDraft<T>) => boolean;
export type MatchJavascriptObjectWithFilter = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>) => boolean;




export type LogicFilter<T extends Record<string, any>> = {
    [K in WhereFilterLogicOperatorsTyped]?: WhereFilterDefinition<T>[];
}

/**
 * Defines a query for filtering objects, similar to a WHERE clause in database queries.
 * It allows for filtering based on an object's properties, including those that are nested.
 *
 * You can define a filter in two primary ways:
 * 1.  **Partial Object Filter**: Specify the properties and the values you want to match. Use dot notation to access nested properties.
 * 2.  **Logic Filter**: Combine multiple filters using logical operators like `AND`, `OR`, and `NOT`.
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
 * // Filter for objects where the 'tags' array contains 'typescript'
 * const filterByTag = { 'tags.elem_match': { $in: ['typescript'] } };
 *
 * @example
 * // A filter using the 'OR' logical operator to find objects that are either
 * // high priority or have a status of 'completed'.
 * const logicalFilter = {
 *   OR: [
 *     { isPriority: true },
 *     { status: 'completed' }
 *   ]
 * };
 *
 * @example
 * // A filter for a numeric property, finding objects where 'age' is greater than 30.
 * const numericFilter = { 'person.age': { gt: 30 } };
 *
 * 
 * @note It is loosely inspired by Mongo 
 * 
 * @note When using `WhereFilterDefinition` as a function parameter, TypeScript may have trouble
 * inferring whether it's a logic filter or a partial object filter. To resolve this,
 * you can use type guards like `isLogicFilter` or `isPartialObjectFilter` to narrow
 * the type before accessing its properties.
 */
export type WhereFilterDefinition<T extends Record<string, any> = any> =
    PartialObjectFilter<T>
    |
    LogicFilter<T>;

    
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







