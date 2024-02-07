import isPlainObject from "../isPlainObject";

// 8% faster than getProperty in the dot-prop package, but lacks the flexibility of that. This can only be used for paths strings split on '.'.

// Verified that it matches output of dot-prop's getProperty for getProperty({foo: null}, 'foo.bar') and getProperty({foo: null}, 'foo')

export function getProperty<T extends Record<string, any> = Record<string, any>>(object: T, dotPath:string, alreadyProvedIsPlainObject?:boolean) {
    
    if( !alreadyProvedIsPlainObject && !isPlainObject(object) ) {
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