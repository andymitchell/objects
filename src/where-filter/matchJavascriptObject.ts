import { Draft } from "immer";
import { getProperty, getPropertySpreadingArrays } from "../dot-prop-paths/getPropertySimpleDot";
import isPlainObject from "../utils/isPlainObject";
import { ArrayFilter, ArrayValueComparison, isArrayValueComparisonElemMatch, isLogicFilter, isValueComparisonContains, isValueComparisonNumeric, isValueComparisonScalar, isWhereFilterDefinition, LogicFilter, MatchJavascriptObject, ValueComparison, ValueComparisonNumericOperators, WhereFilterDefinition, WhereFilterLogicOperators } from "./types";
import { isEqual } from "lodash-es";

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

const matchJavascriptObject:MatchJavascriptObject = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>):boolean => {
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

function _matchJavascriptObject<T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition, debugPath:WhereFilterDefinition[]):boolean {
    
    // If there's more than 1 key on the filter, split it formally into an AND 
    const keys = Object.keys(filter) as Array<keyof typeof filter>;
    if( keys.length>1 ) {
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
        let objectValue = getProperty(object, dotpropKey, true);
        const dotpropFilter = filter[dotpropKey];
        if( objectValue===undefined ) {
            // It's possible that it's an array nested under an array (spreading), so needs to be broken down to test every combination
            const spreadArrays = getPropertySpreadingArrays(object, dotpropKey);
            if( spreadArrays && spreadArrays.length && !(spreadArrays.length===1 && spreadArrays[0].value===undefined) ) {
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

export function filterJavascriptObjects<T extends {} = {}>(objects:ObjOrDraft<T>[], filter:WhereFilterDefinition<T>):ObjOrDraft<T>[] {
    return objects.filter(x => matchJavascriptObject<T>(x, filter));
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
            } else {
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
            return isEqual(value, filterValue);
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
        return isEqual(value, filterValue);
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