import { getProperty as ldGetProperty } from "dot-prop";
import isPlainObject from "../utils/isPlainObject.js";
import { escapeDotPropPathSegment, parseDotPropPathSegments } from "./dotPropPathSegments.ts";
import { getPropertyOwn } from "./getPropertyOwn.ts";


/**
 * Resolve a dot-prop path against a runtime value, reading only OWN properties at each step.
 *
 * Speaks dot-prop's full path grammar (`a.b`, `a[0].b`, `a\.b` escapes) but, unlike dot-prop's own
 * `getProperty`, treats a segment naming an inherited member (`toString`, `valueOf`, …) as an absent
 * key. Data cannot reach `Object.prototype` members through a path, while an object genuinely holding
 * an own key spelled like one still resolves it. This is the reader the value-driven matcher shares
 * with sorting and write-actions, and own-only reads keep it in agreement with the schema-driven SQL
 * engines' path resolution.
 *
 * @param object the value to resolve against.
 * @param dotPath the dot-prop path. Denylisted segments ({@link DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED}) resolve `undefined`.
 * @param alreadyProvedIsPlainObject unused; retained for callers that pass it.
 * @returns the resolved own value, or `undefined` when any segment is not an own property of its container.
 */
export function getProperty<T extends Record<string, any> = Record<string, any>>(object: T, dotPath:string, alreadyProvedIsPlainObject?:boolean):ReturnType<typeof ldGetProperty> {

    // Cast: getPropertyOwn returns `unknown`, while this signature keeps dot-prop's declared return type
    // so existing callers' inference is unchanged. The runtime value is exactly what dot-prop would
    // return for any own-reachable path.
    return getPropertyOwn(object, dotPath) as ReturnType<typeof ldGetProperty>;

}

/**
 * Dot-paths that `getProperty` MUST resolve to `undefined` — the security + degenerate-input contract.
 * Why: prototype-pollution vectors (`__proto__`, `constructor`, `prototype`) must never reach a real
 * value, and degenerate paths (`''`, `'.'`, `'.id'`, `'*'`) have no meaning. Published from the source
 * module (not a `.test.ts`) so the where-filter conformance suite can assert the same contract without
 * importing test code.
 */
export const DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED = ['', '.', '.id', '*', '__proto__', '__proto__.polluted', 'prototype', 'constructor'];



/**
 * 8% faster than getProperty in the dot-prop package, but lacks the flexibility of that. This can only be used for paths strings split on '.'. It can't do array index notation.
 * Verified that it matches output of dot-prop's getProperty for getProperty({foo: null}, 'foo.bar') and getProperty({foo: null}, 'foo')
 * 
 * @param object 
 * @param dotPath 
 * @param alreadyProvedIsPlainObject 
 * @returns 
 */
/*
export function getPropertyFast<T extends Record<string, any> = Record<string, any>>(object: T, dotPath:string, alreadyProvedIsPlainObject?:boolean) {
    throw new Error("FAILING THE ATTACK TESTS");
    
    if( (!alreadyProvedIsPlainObject && !isPlainObject(object)) || !dotPath ) {
        return object;
    }
    
    const pathArray = dotPath.split(".");
    let count = 0; 
    for( let key of pathArray ) {
        count++;
        
        object = object[key];
        if( !object ) break;
	}

    return pathArray.length===count? object : undefined;

}
*/

/**
 * Return an array of all values at a dotPath, including iterating over any arrays in the dotPath  
 * E.g. given {log: [{id: 1}, {id: 2}]} and path 'log.id', it will return [1, 2]. A more traditional {person: {name: 'Bob'}} will also return an array with 1 entry, e.g. for 'person.name' it will return ['Bob']. 
 * It can handle paths that include nested arrays to any depth. 
 * @param object 
 * @param dotPath 
 * @returns 
 */
/*
export function getPropertySpreadingArraysFlat<T extends Record<string, any> | Record<string, any>[] = Record<string, any>>(object: T, dotPath:string):unknown[] {
    throw new Error("FAILING THE ATTACK TESTS");
    
    if( !(isPlainObject(object) || Array.isArray(object)) ) {
        // TODO This matches the logic of getProperty, but is it right? It returns the object no matter what the path is. Feels like undefined is better, but this matches dot-prop's getProperty
        return [object];
    }
    if( !dotPath ) {
        if( Array.isArray(object) ) {
            return object;
        } else {
            return [object];
        }
    }
    const result = getPropertySpreadingArrays(object, dotPath);
    return result.flatMap(x => x.value);
}
*/

/**
 * Return every value at a dot-prop path, iterating any array the path crosses, alongside the concrete path
 * each value was found at.
 *
 * A path such as `log.id` names one field per element when `log` is an array, so a single path yields many
 * values. Each result's `path` addresses exactly one of them, with an index for every array crossed, and a
 * literal dot inside a key escaped — so the path can be resolved again by {@link getProperty}.
 *
 * @param object the value to read.
 * @param dotPath the dot-prop path, where `\.` is a literal dot inside a key rather than a separator.
 * @returns one entry per value found — a present leaf surfaces its value even when that value is `null` (or
 *   otherwise falsy, e.g. `0` / `''` / `false`), so a present-but-null member is distinguishable from an
 *   absent one. A path that finds nothing yields a single entry whose `value` is `undefined`, matching
 *   `getProperty`.
 *
 * @example
 * getPropertySpreadingArrays({ log: [{ id: 1 }, { id: 2 }] }, 'log.id');
 * // [{ path: 'log[0].id', value: 1 }, { path: 'log[1].id', value: 2 }]
 *
 * @example
 * getPropertySpreadingArrays({ rows: [{ 'a.b': 'v' }] }, 'rows.a\\.b');
 * // [{ path: 'rows[0].a\\.b', value: 'v' }]
 */
export function getPropertySpreadingArrays<T extends Record<string, any> | Record<string, any>[] = Record<string, any>>(object: T, dotPath:string):{path: string, value: unknown}[] {


    if( !(isPlainObject(object) || Array.isArray(object)) || typeof dotPath!=='string' ) {
        // TODO This matches the logic of getProperty, but is it right? It returns the object no matter what the path is. Feels like undefined is better, but this matches dot-prop's getProperty
        return [{path: '', value: object}];
    }
    if( !dotPath ) {
        // Matches dot-prop
        return [{path: '', value: undefined}];
    }
    // Decode once. Splitting on raw dots inside the traversal would read a literal-dot key as two nested keys.
    const result = _getPropertySpreadingArrays(object, parseDotPropPathSegments(dotPath), '');
    return result;
}
function _getPropertySpreadingArrays<T extends Record<string, any> | Record<string, any>[] = Record<string, any>>(object: T, segments:readonly string[], traversalPath:string):{path: string, value: unknown}[] {

    const disallowedKeys = new Set([
        '__proto__',
        'prototype',
        'constructor',
    ]);

    let results:{path: string, value: unknown}[] = [];
    if( Array.isArray(object) ) {
        if( segments.length ) {
            for( let i = 0; i < object.length; i++ ) {
                // Append in place: `results = [...results, ...sub]` inside a loop re-copies the whole
                // accumulator each iteration → O(N²), turning a large array spread into a DoS.
                const sub = _getPropertySpreadingArrays(object[i], segments, traversalPath + `[${i}]`);
                for( const r of sub ) results.push(r);
            }
        } else {

            return [{path: traversalPath, value: object}]; // Leaf
        }
    } else if( isPlainObject(object) ) {
        const remaining = [...segments];
        const pathLength = remaining.length;
        let count = 0;
        while( remaining.length ) {
            count++;
            const key = remaining.shift();
            if( !key ) break;
            if( disallowedKeys.has(key) ) return [{path: '', value: undefined}];
            if( traversalPath ) traversalPath += '.';
            traversalPath += escapeDotPropPathSegment(key);

            // Own-property only: an inherited member (`toString`, `valueOf`, …) is not data; it must
            // resolve as absent exactly like `getProperty`, or the matcher's array-spreading fallback
            // would resolve it and rebuild the same filter as an $or, recursing without end.
            object = Object.hasOwn(object, key) ? object[key] : undefined;
            if( !object ) break;
            if( Array.isArray(object) ) break;
        }
        if( Array.isArray(object) ) {
            // Recurse into it
            results = [...results, ..._getPropertySpreadingArrays(object, remaining, traversalPath)];
        } else if( pathLength===count ) {
            // The whole path resolved to a leaf. Surface it whenever the final key held a value — including a
            // falsy one (`null` / `0` / `''` / `false`). A truthiness test here would drop a present-but-null
            // (or otherwise falsy) leaf and misreport it as missing, so `$exists` on an array-descended member
            // (`items.value` over `items: [{ value: null }]`) would wrongly answer false. Only `undefined` —
            // the key was absent — counts as no leaf, matching `getProperty`.
            if( object !== undefined ) {
                results.push({path: traversalPath, value: object}); // Leaf
            }
        }
    }

    if( results.length===0 ) {
        // Match dot-prop
        results = [{path: '', value: undefined}];
    }
    return results;

}