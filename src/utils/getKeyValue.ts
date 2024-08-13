import { isTypeEqual } from "@andyrmitchell/utils";
import { z } from "zod";


export const PrimaryKeyValueSchema = z.union([z.string(), z.number()]);
export type PrimaryKeyValue = string | number;
isTypeEqual<z.infer<typeof PrimaryKeyValueSchema>, PrimaryKeyValue>(true);

export default function safeKeyValue(x: any, allowMissing?: boolean, debugPrimaryKey?:string | symbol | number):PrimaryKeyValue {
    if( !x ) {
        if( allowMissing ) return '';
        throw new Error(`Expected some value for the key ${debugPrimaryKey?.toString() ?? ''}`);
    }
    if( typeof x==='number' ) return x;
    return typeof x==='string'? x : x+'';
}
export type PrimaryKeyGetter<T> = (x:T, allowMissing?: boolean) => PrimaryKeyValue;
export function makePrimaryKeyGetter<T>(primaryKey:keyof T):PrimaryKeyGetter<T> {
    return (x:T, allowMissing?: boolean) => {
        return safeKeyValue(x[primaryKey], allowMissing, primaryKey);
    }
}