import isPlainObject from "../isPlainObject";

// 8% faster than getProperty in the dot-prop package, but lacks the flexibility of that. This can only be used for paths strings split on '.'.

// Verified that it matches output of dot-prop's getProperty for getProperty({foo: null}, 'foo.bar') and getProperty({foo: null}, 'foo')

export function getProperty<T extends Record<string, any> = Record<string, any>>(object: T, dotPath:string, alreadyProvedIsPlainObject?:boolean) {
    
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

export default getProperty;


/**
 * Return an array of all values at a dotPath, including iterating over any arrays in the dotPath  
 * E.g. given {log: [{id: 1}, {id: 2}]} and path 'log.id', it will return [1, 2]. A more traditional {person: {name: 'Bob'}} will also return an array with 1 entry, e.g. for 'person.name' it will return ['Bob']. 
 * It can handle paths that include nested arrays to any depth. 
 * @param object 
 * @param dotPath 
 * @returns 
 */
export function getPropertySpreadingArraysFlat<T extends Record<string, any> | Record<string, any>[] = Record<string, any>>(object: T, dotPath:string):unknown[] {

    
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

/**
 * Return an array of all specific-paths and values at dotPath, including iterating over any arrays in the dotPath. 
 * E.g. Given {log: [{id: 1}, {id: 2}]} and a dotPath of 'log.id' it'll return [{"path":"log[0].id","value":1},{"path":"log[1].id","value":2}].
 * @param object 
 * @param dotPath 
 * @returns 
 */
export function getPropertySpreadingArrays<T extends Record<string, any> | Record<string, any>[] = Record<string, any>>(object: T, dotPath:string):{path: string, value: unknown}[] {

    
    if( !(isPlainObject(object) || Array.isArray(object)) || !dotPath ) {
        // TODO This matches the logic of getProperty, but is it right? It returns the object no matter what the path is. Feels like undefined is better, but this matches dot-prop's getProperty
        return [{path: '', value: object}];
    }
    const result = _getPropertySpreadingArrays(object, dotPath, '');
    return result;
}
function _getPropertySpreadingArrays<T extends Record<string, any> | Record<string, any>[] = Record<string, any>>(object: T, dotPath:string, traversalPath:string):{path: string, value: unknown}[] {
    

    let results:{path: string, value: unknown}[] = [];
    if( Array.isArray(object) ) {
        if( dotPath ) {
            for( let i = 0; i < object.length; i++ ) {
                results = [...results, ..._getPropertySpreadingArrays(object[i], dotPath, traversalPath + `[${i}]`)];
            }
        } else {
            console.log("Returning ", {path: traversalPath, value: object});
            return [{path: traversalPath, value: object}]; // Leaf
        }
    } else if( isPlainObject(object) ) {
        const pathArray = dotPath.split(".");
        const pathLength = pathArray.length;
        let count = 0; 
        while( pathArray.length ) {
            count++;
            const key = pathArray.shift();
            if( traversalPath ) traversalPath += '.';
            traversalPath += key;

            object = object[key];
            if( !object ) break;
            if( Array.isArray(object) ) break;
        }
        if( Array.isArray(object) ) {
            // Recurse into it
            results = [...results, ..._getPropertySpreadingArrays(object, pathArray.join('.'), traversalPath)];
        } else if( pathLength===count ) {
            if( object ) {
                results.push({path: traversalPath, value: object}); // Leaf
            }
        }
    }

    return results;

}