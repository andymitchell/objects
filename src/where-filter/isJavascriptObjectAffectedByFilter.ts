import { hasProperty } from "dot-prop";
import {  UpdatingMethod, WhereFilter, WhereFilterLogicOperators, getValidFilterType, isLogicFilter } from "./types";

/**
 * Does the filter relate to any key in the object? 
 * 
 * Reveals if a filter is worth applying to the object.
 * The logical paths do not matter.
 * 
 * @param object The object to test to see if the filter touches any key in it
 * @param filter 
 * @returns 
 */
export function isJavascriptObjectAffectedByFilter<T = any>(object:object, filter:WhereFilter<T>):boolean {
    return _isJavascriptObjectAffectedByFilter(object, filter, false, [filter]);
}
export function isResultingJavascriptObjectAffectedByFilter<T = any>(partialObject: object, filter: WhereFilter<T>, method: UpdatingMethod):boolean {
    /**
     *  Scenario: You have a View/Collection defined by a WhereFilter to decide what items to include. You're updating one of those items. You want to know if the resulting object will have changed in such a way as to need to be re-evaluated by the WhereFilter.
     *      Initial set up: 
     *          View WhereFilter: {'person.name': 'Andy}
     *          View Item (not included in this function, but what we want to know if it'll be affected): {person: {name: 'Andy'}, goal: 'fly'}
     *          PartialObject (the update): {person: {age: 100}}
     *      In a merge strategy:
     *          Because merge only works with the leaf nodes, and WhereFilter only allows scalar comparisons, we only need to compare the exact dotProp. 
     *              The Resulting Object will be {person: {name: 'Andy', age: 100}, goal: 'fly'}
     *              In this case, 'person.name' is not included in the PartialObject, so it'll have no effect on the Resulting Object.
     *      In an assign strategy:
     *          Assign will wipe out the entire structure provided. 
     *              The Resulting Object will be {person: {age: 100}, goal: 'fly'}
     *              In this case, while 'person.name' is not included in the PartialObject, 'person' (and therefore 'person.name') is changed on the Resulting Object, so it needs to have evaluated every part of the dotProp on the Partial Object to know that. 
     */
    

    if( method==='merge' ) {
        return _isJavascriptObjectAffectedByFilter(partialObject, filter, false, [filter]);
    } else if( method==='assign' ) {
        return _isJavascriptObjectAffectedByFilter(partialObject, filter, true, [filter]);
    } else {
        throw new Error("Unknown Updating Method");
    }
}
function _isJavascriptObjectAffectedByFilter<T>(object:object, filter:WhereFilter<T>, testDotPropParents: boolean, debugPath:WhereFilter<T>[]):boolean {
    if( isLogicFilter(filter) ) {
        // Treat it as recursive
        return WhereFilterLogicOperators.some(operator => {
            const subFilters = filter[operator];
            if( Array.isArray(subFilters) ) {
                return subFilters.some(subFilter => {
                    return _isJavascriptObjectAffectedByFilter(object, subFilter, testDotPropParents, [...debugPath, subFilter]);
                });
            }
        })
    } else {
        // Test a single dotprop 
        const dotpropKey = Object.keys(filter)[0];

        if( testDotPropParents ) {
            const dotPropKeyElements = dotpropKey.split('.');
            // Turn ['a', 'b', 'c'] into ['a', 'a.b', 'a.b.c']:
            const dotPropHierarchy = dotPropKeyElements.map((el, idx, array) => {
                return array.slice(0, idx + 1).join('.');
            });
            return dotPropHierarchy.some(partialDotPropKey => hasProperty(object, partialDotPropKey));
        } else {
            return hasProperty(object, dotpropKey);
        }
    }
    
}