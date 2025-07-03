

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


export type MatchJavascriptObject = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>) => boolean;




export type LogicFilter<T extends Record<string, any>> = {
    [K in WhereFilterLogicOperatorsTyped]?: WhereFilterDefinition<T>[];
}

/**
 * Define a search term using either the (nestable) keys of an object or boolean logic filters. 
 * 
 * Note if you use this as a parameter in a function, TypeScript cannot infer whether it's a logic filter or partial object filter and will claim it has no properties. 
 * In this case, use isLogicFilter or isPartialObjectFilter to first narrow it, then you can use it.
 */
export type WhereFilterDefinition<T extends Record<string, any> = any> =
    PartialObjectFilter<T>
    |
    LogicFilter<T>;



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







    
export type UpdatingMethod = 'merge' | 'assign';



