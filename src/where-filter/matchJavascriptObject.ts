import type { Draft } from "immer";
import { getProperty, getPropertySpreadingArrays } from "../dot-prop-paths/getPropertySimpleDot.js";
import isPlainObject from "../utils/isPlainObject.js";
import type { ArrayFilter, MatchJavascriptObject, MatchJavascriptObjectWithFilter, ValueComparison, WhereFilterDefinition } from "./types.js";
import deepEql from "deep-eql";
import { isArrayValueComparisonElemMatch, isValueComparisonContains, isWhereFilterDefinition } from "./schemas.ts";
import {isLogicFilter, isValueComparisonNumeric, isValueComparisonScalar } from "./typeguards.ts";
import { ValueComparisonNumericOperators } from "./consts.ts";
// TODO Optimise: isPlainObject is still expensive, and used in compareValue/etc. But if the top function (matchJavascriptObject) checks object, then all children can assume to be plain object too, avoiding the need for the test. Just check the assumption that isPlainObject does indeed check all children.

/*

# This is largely inspired by Mongo. 

## If multiple criteria are on a filter it's an AND... 
e.g. {name: 'Bob', age: 1}, it implicitly infers its an AND across the criteria. 

## It gets a little hard to think about around arrays. 
Use elem_match on an array search to define the characteristics that must be found under one element. Otherwise, it does a compound search that accepts multiple elements fulfilling the criteria. 
E.g. for an array 'children' [{name: 'Bob', age: 20}, name: 'Alice', age: 1], and filter {'children': {name: 'Bob', age: 1}}, it would pass. 
But if you used {'children': {elem_match: {name: 'Bob', age: 1}}}, then it would fail. 

This is counter-intuitive partly because the normal behaviour for multiple criteria is to use AND, except in compound filters. 

If you use AND/OR/NOT in your compound filters, they behave atomically on each element, equivelent to elem_match. 

## Spreading arrays will use a generous OR 
E.g. suppose you have {children: {grandchildren: {name: string}[]}[]}. I.e. arrays as elements of parent arrays. 
A criteria of {'children.grandchildren': {name: 'Bob'}} is valid. It'll analyse each leaf array (in this case, potentially multiple 'grandchildren' arrays). But the compound filter must pass within the context of one array. 

*/

export type ObjOrDraft<T extends Record<string, any>> = T | Draft<T>;

/**
 * Checks if a single JavaScript object matches a given filter condition.
 *
 * @template T - The type of the object being tested.
 * @param {ObjOrDraft<T>} object - The object to test. Must be a plain object.
 * @param {WhereFilterDefinition<T>} filter - The filter definition describing the conditions the object must meet.
 * @returns {boolean} - Returns true if the object matches the filter, false otherwise.
 *
 * @throws {Error} - Throws an error if the input is not a plain JavaScript object.
 *
 * @example
 * const user = { name: 'Alice', age: 30 };
 * const filter = { age: { gte: 18 } };
 * matchJavascriptObject(user, filter); // true
 */
const matchJavascriptObject:MatchJavascriptObjectWithFilter = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>):boolean => {
    if( !isPlainObject(object) ) {
        let json: string = 'redacted';
        if( process.env.NODE_ENV==='test' ) {
            try {
                json = JSON.stringify(object);
            } catch(e) {
                json = 'unknowable'
            }

        }
        throw new Error("matchJavascriptObject requires plain object. Received: "+json)
    }

    return _matchJavascriptObject(object, filter, [filter]);
    
}
export default matchJavascriptObject;


/**
 * Compiles a reusable matcher function from a filter definition.
 *
 * This allows you to create a function once and reuse it to test multiple objects
 * against the same filter criteria, improving readability and performance when filtering many items.
 *
 * @template T - The type of object the filter will match.
 * @param {WhereFilterDefinition<T>} filter - The filter definition describing the match criteria.
 * @returns {BasicMatchJavascriptObject<T>} - A function that takes an object and returns true if it matches the filter.
 *
 * @example
 * const filter = { age: { gte: 18 } };
 * const isAdult = compileMatchJavascriptObject(filter);
 *
 * isAdult({ name: 'Alice', age: 30 }); // true
 * isAdult({ name: 'Bob', age: 15 });   // false
 */
export const compileMatchJavascriptObject = <T extends Record<string, any>>(filter:WhereFilterDefinition<T>):MatchJavascriptObject<T> => {
    return (object:ObjOrDraft<T>) => matchJavascriptObject(object, filter);
}


/**
 * Filters an array of JavaScript objects, returning only those that match the given filter.
 *
 * @template T - The type of objects in the array.
 * @param {ObjOrDraft<T>[]} objects - An array of plain JavaScript objects to filter.
 * @param {WhereFilterDefinition<T>} filter - The filter definition used to test each object.
 * @returns {ObjOrDraft<T>[]} - An array containing only the objects that match the filter.
 *
 * @example
 * const users = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 16 }];
 * const filter = { age: { gte: 18 } };
 * filterJavascriptObjects(users, filter); // [{ name: 'Alice', age: 30 }]
 */
export function filterJavascriptObjects<T extends {} = {}>(objects:ObjOrDraft<T>[], filter:WhereFilterDefinition<T>):ObjOrDraft<T>[] {
    return objects.filter(x => matchJavascriptObject<T>(x, filter));
}


function _matchJavascriptObject<T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition, debugPath:WhereFilterDefinition[]):boolean {
    
    
    const keys = Object.keys(filter) as Array<keyof typeof filter>;
    if( keys.length===0 ) {
        // If there are no keys on the filter, there is no filter. Therefore return all. 
        return true;
        
    } else if( keys.length>1 ) {
        // If there's more than 1 key on the filter, split it formally into an AND 
        filter = {
            AND: keys.map(key => ({[key]: filter[key]}))
        }
    }

    if( isLogicFilter(filter) ) {
        // Treat it as recursive
        const subMatcher = (subFilter:WhereFilterDefinition) => _matchJavascriptObject(object, subFilter, [...debugPath, subFilter]);
        const passOr = !Array.isArray(filter.OR) || filter.OR.some(subMatcher);
        const passAnd = !Array.isArray(filter.AND) || filter.AND.every(subMatcher);
        const passNot = !Array.isArray(filter.NOT) || !filter.NOT.some(subMatcher);
        return passOr && passAnd && passNot;
    } else {
        // Test a single dotprop 

        const dotpropKey = Object.keys(filter)[0];
        if( !dotpropKey ) return false;
        let objectValue = getProperty(object, dotpropKey, true);
        const dotpropFilter = filter[dotpropKey];
        if( objectValue===undefined ) {
            // It's possible that it's an array nested under an array (spreading), so needs to be broken down to test every combination
            const spreadArrays = getPropertySpreadingArrays(object, dotpropKey);
            if( spreadArrays && spreadArrays.length && !(spreadArrays.length===1 && spreadArrays[0]!.value===undefined) ) {
                const orFilter:WhereFilterDefinition = {
                    OR: spreadArrays.map(x => ({[x.path]: dotpropFilter}))
                }
                return _matchJavascriptObject(object, orFilter, [...debugPath, dotpropFilter])
            }
        }

        if( Array.isArray(objectValue) ) {
            return compareArray(objectValue, dotpropFilter, [...debugPath, dotpropFilter]);
        } else {
            return compareValue(objectValue, dotpropFilter);
        }
    }

    
}


type ValueComparisonNumericOperatorJavascriptFunctionsTyped = {
    [K in typeof ValueComparisonNumericOperators[number]]: (value:number, filterValue: number) => boolean; 
};
const ValueComparisonNumericOperatorsJavascriptFunctions:ValueComparisonNumericOperatorJavascriptFunctionsTyped = {
    'gt': (value, filterValue) => value>filterValue,
    'lt': (value, filterValue) => value<filterValue,
    'gte': (value, filterValue) => value>=filterValue,
    'lte': (value, filterValue) => value<=filterValue,
}
function compareValue(value: any, filterValue: ValueComparison):boolean {
    const filterValueIsPlainObject = isPlainObject(filterValue);

    
    if( filterValueIsPlainObject ) {
        if( isValueComparisonContains(filterValue, true) ) {
            if( typeof value==='string' ) {
                return value.indexOf(filterValue.contains)>-1;
            } else if( value!==undefined ) {
                throw new Error("A ValueComparisonContains only works on a string");
            }
        } else if( isValueComparisonNumeric(filterValue, true) ) {
            if( typeof value==='number' ) {
                return ValueComparisonNumericOperators.filter(x => x in filterValue).every(x => {
                    const filterValueForX = filterValue[x];
                    return typeof filterValueForX==='number' && ValueComparisonNumericOperatorsJavascriptFunctions[x](value, filterValueForX)
                });
            } else if (!value) {
                // like SQL, we want to test against empty/null and simply return false
                return false;
            } else {
                throw new Error("A ValueComparisonContains only works on a number");
            }
        } else {
            return deepEql(value, filterValue);
        }
    } else {
        if( isValueComparisonScalar(filterValue) ) {
            return value===filterValue;
        }
    }
    return false;
}

function compareArray(value: any[], filterValue: ArrayFilter<any>, debugPath:WhereFilterDefinition[]):boolean {
    if( Array.isArray(filterValue) ) {
        // Two arrays = straight comparison
        return deepEql(value, filterValue);
    } else if( isArrayValueComparisonElemMatch(filterValue) ) {
        // In an elem_match, one item in the 'value' array must match all the criteria
        if( isWhereFilterDefinition(filterValue.elem_match) ) {
            return value.some(x => _matchJavascriptObject(x, filterValue.elem_match, [...debugPath, filterValue.elem_match]))
        } else {
            // It's a value comparison
            return value.some(x => compareValue(x, filterValue.elem_match))
        }
    } else {
        // it's a compound. every filter item must be satisfied by at least one element of the array 
        if( isPlainObject(filterValue) ) {
            // split it apart across its keys, where each must be satisfied
            const keys = Object.keys(filterValue) as Array<keyof typeof filterValue>;

            const result = keys.every(key => {

            
                const subFilter:WhereFilterDefinition = {[key]: filterValue[key]};
                return value.some(x => _matchJavascriptObject(x, subFilter, [...debugPath, subFilter]))
            });
            return result;
        } else {
            const result = value.indexOf(filterValue)>-1;
            return result;
        }
    }
}