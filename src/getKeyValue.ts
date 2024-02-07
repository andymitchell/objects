
export type PrimaryKeyValue = string | number;
export default function safeKeyValue(x: any):PrimaryKeyValue {
    if( !x ) throw new Error("Expected some value for the key");
    if( typeof x==='number' ) return x;
    return typeof x==='string'? x : x+'';
}
export type PrimaryKeyGetter<T> = (x:T) => PrimaryKeyValue;
export function makePrimaryKeyGetter<T>(primaryKey:keyof T):PrimaryKeyGetter<T> {
    return (x:T) => {
        return safeKeyValue(x[primaryKey]);
    }
}