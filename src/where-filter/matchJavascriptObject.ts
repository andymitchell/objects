import { Draft } from "immer";
import getPropertyWithDotPropPath from "../dot-prop-paths/getPropertySimpleDot";
import isPlainObject from "../isPlainObject";
import { ArrayFilter, ArrayValueComparison, isArrayValueComparisonElemMatch, isLogicFilter, isValueComparisonContains, isValueComparisonNumeric, isValueComparisonScalar, isWhereFilterDefinition, LogicFilter, ValueComparison, ValueComparisonNumericOperators, WhereFilterDefinition, WhereFilterLogicOperators } from "./types";
import { isEqual } from "lodash-es";

// TODO Optimise: isPlainObject is still expensive, and used in compareValue/etc. But if the top function (matchJavascriptObject) checks object, then all children can assume to be plain object too, avoiding the need for the test. Just check the assumption that isPlainObject does indeed check all children.

export type ObjOrDraft<T extends Record<string, any>> = T | Draft<T>;

export default function matchJavascriptObject<T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>):boolean {
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
        const objectValue = getPropertyWithDotPropPath(object, dotpropKey, true);

        if( Array.isArray(objectValue) ) {
            return compareArray(objectValue, filter[dotpropKey], [...debugPath, filter[dotpropKey]]);
        } else {
            return compareValue(objectValue, filter[dotpropKey]);
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
            /*
        } else if( isValueComparisonArrayContains(filterValue, true ) ) {
            if( Array.isArray(value) ) {
                return value.includes(filterValue.array_contains);
            } else {
                throw new Error("A isValueComparisonArrayContains only works on an array");
            }
            */
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
        // every filter item must be satisfied by some part of the array
        const wrappedFilter:LogicFilter<any> = isWhereFilterDefinition(filterValue) && filterValue.AND? filterValue : {AND: [filterValue]};
        return wrappedFilter.AND!.every(subFilter => value.some(x => _matchJavascriptObject(x, subFilter, [...debugPath, subFilter])));
    }
}