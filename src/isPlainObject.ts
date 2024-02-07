
// This is about 30% faster than lodash _.isPlainObject

export default function isPlainObject(value:unknown):boolean {

    
    if (value === null || typeof value !== "object") {
        return false;
    }
    let proto = Object.getPrototypeOf(value);
    return !proto || proto === Object.prototype;
    
}