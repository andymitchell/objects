import getPropertyWithDotPropPath from "../dot-prop-paths/getPropertySimpleDot";
import isPlainObject from "../isPlainObject";
import { isLogicFilter, isValueComparisonArrayContains, isValueComparisonContains, isValueComparisonNumeric, isValueComparisonScalar, ValueComparison, ValueComparisonNumericOperators, WhereFilterDefinition } from "./types";

// TODO Optimise: isPlainObject is still expensive, and used in compareValue/etc. But if the top function (matchJavascriptObject) checks object, then all children can assume to be plain object too, avoiding the need for the test. Just check the assumption that isPlainObject does indeed check all children.

export default function matchJavascriptObject<T extends Record<string, any> = Record<string, any>>(object:T, filter:WhereFilterDefinition<T>):boolean {
    if( !isPlainObject(object) ) {
        let json: string = 'redacted';
        if( process.env.NODE_ENV==='test' ) {
            try {
                json = JSON.stringify(object);
            } catch(e) {
                json = 'unknowable'
            }

            console.warn("FAILING");
            //console.warn("typeof: "+typeof object);
            let proto = Object.getPrototypeOf(object);
            //console.warn("has proto? "+!!proto);
            console.warn("proto has the correct prototype? "+(proto===Object.prototype));
            console.warn("Object.prototype.toString.call(object) = "+Object.prototype.toString.call(object))
        }
        throw new Error("matchJavascriptObject requires plain object. Received: "+json)
    }
    //console.warn("RUNNING MATCH PASSED: "+JSON.stringify(object));
    return _matchJavascriptObject(object, filter, [filter]);
}
function _matchJavascriptObject<T extends Record<string, any> = Record<string, any>>(object:T, filter:WhereFilterDefinition, debugPath:WhereFilterDefinition[]):boolean {
    
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
        return compareValue(objectValue, filter[dotpropKey]);
    }

    
}

export function filterJavascriptObjects<T extends {} = {}>(objects:T[], filter:WhereFilterDefinition<T>):T[] {
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
        } else if( isValueComparisonArrayContains(filterValue, true ) ) {
            if( Array.isArray(value) ) {
                return value.includes(filterValue.array_contains);
            } else {
                throw new Error("A isValueComparisonArrayContains only works on an array");
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
        }
    } else {
        if( isValueComparisonScalar(filterValue) ) {
            return value===filterValue;
        }
    }
    return false;
}