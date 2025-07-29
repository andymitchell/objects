import isPlainObject from "../utils/isPlainObject.ts";
import { ValueComparisonNumericOperators, WhereFilterLogicOperators } from "./consts.ts";
import { safeJson } from "./safeJson.ts";
import type {  LogicFilter, PartialObjectFilter, ValueComparisonNumeric, WhereFilterDefinition } from "./types.ts";

export function isLogicFilter<T extends Record<string, any>>(filter:WhereFilterDefinition<T>):filter is LogicFilter<T> {
    return WhereFilterLogicOperators.some(type => {
        return filter.hasOwnProperty(type) && Array.isArray((filter as WhereFilterDefinition<any>)[type])
    });
}
export function isPartialObjectFilter<T extends Record<string, any>>(filter:WhereFilterDefinition<T>):filter is PartialObjectFilter<T> {
    const filterType = getValidFilterType(filter);
    return filterType==='value';
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

export function isValueComparisonNumeric(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonNumeric {
    
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && ValueComparisonNumericOperators.some(op => op in (x as object));
}
export function isValueComparisonScalar(x:unknown): x is string | number | boolean {
    return typeof x==='string' || typeof x==='number' || typeof x==='boolean';
}


