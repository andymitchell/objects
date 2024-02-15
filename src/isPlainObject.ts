
// This is about 30% faster than lodash _.isPlainObject

export default function isPlainObject(value:unknown):boolean {

    
    if (value === null || typeof value !== "object") {
        return false;
    }
    let proto = Object.getPrototypeOf(value);
    if( !proto || proto===Object.prototype ) {
        return true; 
    } else if( process.env.NODE_ENV ) {
        // structuredClone in Node appears to not have proto match Object.prototype
        // This regresses some of our performance gains, but barely, so it would be good to not have to support this workaround
        //  Is it only Jest, in which case process.env.NODE_ENV==='test' is a better test
        //  Is it something later versions of Node fix? 
        //  Can we detect if it's a structuredClone object to isolate this check?

        while (Object.getPrototypeOf(proto) !== null) {
            proto = Object.getPrototypeOf(proto);
        }

        return Object.getPrototypeOf(value) === proto

        //return Object.prototype.toString.call(value) === '[object Object]';
    }
    return false;
    
}