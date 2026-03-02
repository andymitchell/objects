import type { Draft } from "immer";
import { getProperty, getPropertySpreadingArrays } from "../dot-prop-paths/getPropertySimpleDot.js";
import isPlainObject from "../utils/isPlainObject.js";
import type { ArrayFilter, MatchJavascriptObject, MatchJavascriptObjectWithFilter, ValueComparisonFlexi, WhereFilterDefinition } from "./types.js";
import deepEql from "deep-eql";
import { isArrayValueComparisonElemMatch, isArrayValueComparisonAll, isArrayValueComparisonSize, isValueComparisonContains, isValueComparisonNe, isValueComparisonIn, isValueComparisonNin, isValueComparisonNot, isValueComparisonExists, isValueComparisonType, isValueComparisonRegex, isWhereFilterDefinition } from "./schemas.ts";
import {isLogicFilter, isValueComparisonRangeFlexi, isValueComparisonScalar } from "./typeguards.ts";
import { ValueComparisonRangeOperators } from "./consts.ts";
import { safeJson } from "./safeJson.ts";
// TODO Optimise: isPlainObject is still expensive, and used in compareValue/etc. But if the top function (matchJavascriptObject) checks object, then all children can assume to be plain object too, avoiding the need for the test. Just check the assumption that isPlainObject does indeed check all children.

/*

# This is largely inspired by Mongo. 

## If multiple criteria are on a filter it's a $and...
e.g. {name: 'Bob', age: 1}, it implicitly infers its a $and across the criteria. 

## It gets a little hard to think about around arrays. 
Use $elemMatch on an array search to define the characteristics that must be found under one element. Otherwise, it does a compound search that accepts multiple elements fulfilling the criteria.
E.g. for an array 'children' [{name: 'Bob', age: 20}, name: 'Alice', age: 1], and filter {'children': {name: 'Bob', age: 1}}, it would pass.
But if you used {'children': {$elemMatch: {name: 'Bob', age: 1}}}, then it would fail.

This is counter-intuitive partly because the normal behaviour for multiple criteria is to use $and, except in compound filters.

If you use $and/$or/$nor in your compound filters, they behave atomically on each element, equivelent to $elemMatch.

## Spreading arrays will use a generous $or
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
 * const filter = { age: { $gte: 18 } };
 * matchJavascriptObject(user, filter); // true
 */
const matchJavascriptObject:MatchJavascriptObjectWithFilter = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>):boolean => {
    if( !isPlainObject(object) ) {
        let json: string = process.env.NODE_ENV==='test'? safeJson(object) : 'redacted';
        throw new Error("matchJavascriptObject requires plain object. Received: "+json)
    }
    
    if( !isWhereFilterDefinition(filter) ) {
        throw new Error("matchJavascriptObject filter was not well-defined. Received: "+safeJson(filter));
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
 * const filter = { age: { $gte: 18 } };
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
 * const filter = { age: { $gte: 18 } };
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
        // If there's more than 1 key on the filter, split it formally into a $and
        filter = {
            $and: keys.map(key => ({[key]: filter[key]}))
        }
    }

    if( isLogicFilter(filter) ) {
        // Treat it as recursive
        const subMatcher = (subFilter:WhereFilterDefinition) => _matchJavascriptObject(object, subFilter, [...debugPath, subFilter]);
        const passOr = !Array.isArray(filter.$or) || filter.$or.some(subMatcher);
        const passAnd = !Array.isArray(filter.$and) || filter.$and.every(subMatcher);
        const passNor = !Array.isArray(filter.$nor) || !filter.$nor.some(subMatcher);
        return passOr && passAnd && passNor;
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
                    $or: spreadArrays.map(x => ({[x.path]: dotpropFilter}))
                }
                return _matchJavascriptObject(object, orFilter, [...debugPath, dotpropFilter])
            }
        }

        // Handle $exists before array/scalar branching — it checks the value itself
        if (isValueComparisonExists(dotpropFilter)) {
            if (dotpropFilter.$exists) {
                return objectValue !== undefined && objectValue !== null;
            } else {
                return objectValue === undefined || objectValue === null;
            }
        }

        // Handle $type before array/scalar branching — it checks the value's runtime type
        if (isValueComparisonType(dotpropFilter)) {
            return checkJsType(objectValue, dotpropFilter.$type);
        }

        if( Array.isArray(objectValue) ) {
            return compareArray(objectValue, dotpropFilter, [...debugPath, dotpropFilter]);
        } else {
            return compareValue(objectValue, dotpropFilter);
        }
    }

    
}



/** Checks if a value matches the expected $type string. */
function checkJsType(value: any, expectedType: string): boolean {
    if (value === undefined || value === null) {
        return expectedType === 'null';
    }
    switch (expectedType) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number';
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return isPlainObject(value) && !Array.isArray(value);
        case 'null': return value === null;
        default: return false;
    }
}

type CompareFunction = <T extends number | string>(value: T, filterValue: T) => boolean;
type ValueComparisonFlexiOperatorJavascriptFunctionsTyped = {
    [K in typeof ValueComparisonRangeOperators[number]]: CompareFunction;
};
const ValueComparisonRangeOperatorsJavascriptFunctions:ValueComparisonFlexiOperatorJavascriptFunctionsTyped = {
    '$gt': (value, filterValue) => value>filterValue,
    '$lt': (value, filterValue) => value<filterValue,
    '$gte': (value, filterValue) => value>=filterValue,
    '$lte': (value, filterValue) => value<=filterValue,
}
function compareValue(value: any, filterValue: ValueComparisonFlexi):boolean {
    const filterValueIsPlainObject = isPlainObject(filterValue);

    
    if( filterValueIsPlainObject ) {
        // $ne
        if (isValueComparisonNe(filterValue, true)) {
            if (value === undefined || value === null) return true; // MongoDB: ne matches missing
            return value !== filterValue.$ne;
        }
        // $in
        if (isValueComparisonIn(filterValue, true)) {
            if (value === undefined || value === null) return false;
            return filterValue.$in.includes(value);
        }
        // $nin
        if (isValueComparisonNin(filterValue, true)) {
            if (value === undefined || value === null) return true; // MongoDB: nin matches missing
            return !filterValue.$nin.includes(value);
        }
        // $not — negate inner comparison
        if (isValueComparisonNot(filterValue, true)) {
            if (value === undefined || value === null) return true; // MongoDB: $not matches missing
            return !compareValue(value, filterValue.$not);
        }
        // $regex
        if (isValueComparisonRegex(filterValue, true)) {
            if (typeof value !== 'string') return false;
            const regex = new RegExp(filterValue.$regex, filterValue.$options);
            return regex.test(value);
        }
        // $exists and $type are handled before compareValue in _matchJavascriptObject

        if( isValueComparisonContains(filterValue, true) ) {
            if( typeof value==='string' ) {
                return value.indexOf(filterValue.$contains)>-1;
            } else if( value!==undefined ) {
                throw new Error("A ValueComparisonContains only works on a string");
            }
        } else if( isValueComparisonRangeFlexi(filterValue, true) ) {
            if( typeof value === 'number' || typeof value === 'string' ) {
                return ValueComparisonRangeOperators.filter(x => x in filterValue).every(x => {
                    const filterValueForX = filterValue[x];

                    // Narrow to string | number (also rejects mismatched types like boolean/object)
                    if (typeof filterValueForX !== 'string' && typeof filterValueForX !== 'number') {
                         throw new Error(`Range operator '${x}' requires a string or number filter value, got ${typeof filterValueForX}`);
                    }

                    // Critical Check: Ensure we aren't comparing a String to a Number
                    if (typeof filterValueForX !== typeof value) {
                         throw new Error(`Cannot compare value of type ${typeof value} with filter of type ${typeof filterValueForX}`);
                    }

                    return ValueComparisonRangeOperatorsJavascriptFunctions[x](value, filterValueForX)
                });
            } else if (!value) {
                // like SQL, we want to test against empty/null and simply return false
                return false;
            } else {
                throw new Error("A ValueComparisonContains ($gt, $lt, etc.) only works on a number or string");
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
    } else if (isValueComparisonIn(filterValue)) {
        // $in on array: at least one element must be in the list
        return filterValue.$in.some(v => value.includes(v));
    } else if (isValueComparisonNin(filterValue)) {
        // $nin on array: no element may be in the list
        return !filterValue.$nin.some(v => value.includes(v));
    } else if (isArrayValueComparisonAll(filterValue)) {
        // $all: array must contain all specified values
        return filterValue.$all.every(v => value.includes(v));
    } else if (isArrayValueComparisonSize(filterValue)) {
        // $size: array must have exactly N elements
        return value.length === filterValue.$size;
    } else if( isArrayValueComparisonElemMatch(filterValue) ) {
        // In a $elemMatch, one item in the 'value' array must match all the criteria.
        // Use element-type-based branching: the runtime type of each array element
        // determines the code path, not the filter shape. This fixes the ambiguity
        // where operator objects like {$gt: 5} would incorrectly pass isWhereFilterDefinition.
        return value.some(element => {
            if( isPlainObject(element) ) {
                // Object element: apply as WhereFilterDefinition
                return _matchJavascriptObject(element, filterValue.$elemMatch, [...debugPath, filterValue.$elemMatch]);
            } else {
                // Scalar element: apply as value comparison
                return compareValue(element, filterValue.$elemMatch);
            }
        });
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