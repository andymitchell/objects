import { isTypeEqual } from "@andyrmitchell/utils";
import { z } from "zod";


export const PrimaryKeyValueSchema = z.union([z.string(), z.number()]);
export type PrimaryKeyValue = string | number;

export const FullPrimaryKeyValueSchema = z.union([z.string(), z.number(), z.symbol()]);
export type FullPrimaryKeyValue = string | number | symbol;

isTypeEqual<z.infer<typeof PrimaryKeyValueSchema>, PrimaryKeyValue>(true);
isTypeEqual<z.infer<typeof FullPrimaryKeyValueSchema>, FullPrimaryKeyValue>(true);

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

export function isPrimaryKeyValue(x: unknown): x is PrimaryKeyValue {
    return typeof x==='string' || typeof x==='number';
}
export function isFullPrimaryKeyValue(x: unknown): x is FullPrimaryKeyValue {
    return typeof x==='string' || typeof x==='number' || typeof x==='symbol';
}