

import type { DotPropPathsIncArrayUnion, DotPropPathToArraySpreadingArrays, PathValueIncDiscrimatedUnions } from '../dot-prop-paths/types.js';
import isPlainObject from "../utils/isPlainObject.js";

import type { ObjOrDraft } from "./matchJavascriptObject.js";


export const WhereFilterLogicOperators = ['AND', 'OR', 'NOT'] as const;
export type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];

export const ValueComparisonNumericOperators = ['lt', 'gt', 'lte', 'gte'] as const;
export type ValueComparisonNumericOperatorsTyped = typeof ValueComparisonNumericOperators[number];
type ValueComparisonNumeric = Partial<Record<ValueComparisonNumericOperatorsTyped, number>>;
export type ValueComparisonContains = { contains: string };
export type ValueComparison<T = any> = (T extends string? ValueComparisonContains : T extends number? ValueComparisonNumeric : never) | T;
export type ArrayValueComparisonElemMatch<T = any>  = {elem_match: T extends Record<string, any>? WhereFilterDefinition<T> : ValueComparison<T>};
export type ArrayValueComparison<T = any> = ArrayValueComparisonElemMatch<T>;

type IsAssignableTo<A, B> = A extends B ? true : false;

type ArrayElementFilter<T = any> = (T extends Record<string, any>? WhereFilterDefinition<T> :
    T extends string | number ? T : 
    never) | ArrayValueComparison<T>
export type ArrayFilter<T extends []> = ArrayElementFilter<T[number]> | T;
type PartialObjectFilter<T extends Record<string, any>> = Partial<{
    [P in DotPropPathsIncArrayUnion<T>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true
        ? ArrayFilter<PathValueIncDiscrimatedUnions<T, P>>
        : ValueComparison<PathValueIncDiscrimatedUnions<T, P>>
}>;


export type MatchJavascriptObject = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>) => boolean;




export type LogicFilter<T extends Record<string, any>> = {
    [K in WhereFilterLogicOperatorsTyped]?: WhereFilterDefinition<T>[];
}

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






/*
export function isValueComparisonArrayContains(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonArrayContains {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "array_contains" in x;
}
*/
export function isValueComparisonNumeric(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonNumeric {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && ValueComparisonNumericOperators.some(op => op in x);
}
export function isValueComparisonScalar(x:unknown): x is string | number | boolean {
    return typeof x==='string' || typeof x==='number' || typeof x==='boolean';
}


function safeJson(object:any):string | undefined {
    try {
        return JSON.stringify(object);
    } catch(e) {
        return undefined;
    }
}
    
export type UpdatingMethod = 'merge' | 'assign';


export function isLogicFilter<T extends Record<string, any>>(filter:WhereFilterDefinition<any>):filter is LogicFilter<T> {
    return WhereFilterLogicOperators.some(type => {
        return filter.hasOwnProperty(type) && Array.isArray(filter[type])
    });
}
export function getValidFilterType(filter:WhereFilterDefinition<any>, debugPath?:WhereFilterDefinition<any>[]):'logic' | 'value' | undefined {
    if( isPlainObject(filter) ) { 
        if( isLogicFilter(filter) ) {
            return 'logic';
        } else {
            if( Object.keys(filter).length!==1 ) {
                throw new Error("A WhereFilter must have a single key, or be a recursive with OR/AND/NOT arrays. Path: "+safeJson(debugPath || [filter]));
            }
            return 'value';
        }
    } else {
        throw new Error("The WhereFilter must be an object. Path: "+safeJson(debugPath || [filter]));
    }
}

