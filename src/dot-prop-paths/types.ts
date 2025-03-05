


import type { EnsureRecord } from "../types.js";
import type { PrimaryKeyValue } from "../utils/getKeyValue.js";

export type DotPropPathsRecord<T extends Record<string, any>> = {
    [P in DotPropPathsUnion<T> as string & P]: PathValue<T, P>
};


export type DotPropPathsRecordWithOptionalAdditionalValues<T extends Record<string, any>, EV> = {
    [P in DotPropPathsUnion<T> as string & P]: PathValue<T, P> | EV
};


type Path<T> = T extends Array<any>
    ? never
    : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
        ? `${string & K}` | `${string & K}.${Path<T[K]>}`
        : never;
    }[keyof T]
    : '';


export type RemoveTrailingDot<T> = T extends `${infer S}.` ? never : T;
export type DotPropPathsUnion<T> = { [K in Path<T>]: RemoveTrailingDot<K> }[Path<T>];
export type DotPropPathsIncArrayUnion<T extends Record<string,any>> = DotPropPathToObjectArraySpreadingArrays<T> | DotPropPathsUnion<T>;



type Scalar = string | number | boolean | null | undefined;

export type ScalarProperties<T> = { // Helper type to pick only scalar properties of an object
    [P in keyof T]: NonNullable<T[P]> extends Scalar ? P : never
}[keyof T];
export type PrimaryKeyProperties<T> = { // Helper type to pick only string/number properties of an object
    [P in keyof T]: T[P] extends PrimaryKeyValue ? P : never
}[keyof T];
type ObjectProperties<T> = { // Helper type to pick only non-scalar, non-array object properties
    [P in keyof T]: NonNullable<T[P]> extends object ? (NonNullable<T[P]> extends Array<any> ? never : P) : never
}[keyof T];
type ScalarPath<T extends Record<string, any>, Prefix extends string = ''> = T extends Scalar ? '' :
    {
        [P in keyof T]-?: P extends ScalarProperties<T> ? `${Prefix}${string & P}` :
            P extends ObjectProperties<T>
            ? `${Prefix}${string & P}.${ScalarPath<NonNullable<T[P]>>}`
            : never;
    }[keyof T];
type ScalarPathSpreadingObjectArrays<T extends Record<string, any>, Prefix extends string = ''> = T extends Scalar ? '' :
    T extends Array<infer U>
    ? U extends object
        ? `${Prefix}${ScalarPathSpreadingObjectArrays<U>}`
        : never
    : {
        [P in keyof T]-?: P extends ScalarProperties<T> ? `${Prefix}${string & P}` :
            P extends ObjectProperties<T>
            ? `${Prefix}${string & P}.${ScalarPathSpreadingObjectArrays<NonNullable<T[P]>>}`
            : P extends keyof T ? (NonNullable<T[P]> extends Array<any> ? (NonNullable<T[P]>[number] extends object ?
                `${Prefix}${string & P}.${ScalarPathSpreadingObjectArrays<NonNullable<T[P]>[number]>}` : never) : never)
            : never;
    }[keyof T];
type ArrayOfScalarProperties<T> = {
    [P in keyof T]: NonNullable<T[P]> extends Array<infer U> ? U extends Scalar ? P : never : never
}[keyof T];
type ScalarPathToScalarArraySpreadingObjectArrays<T extends Record<string, any>, Prefix extends string = ''> = T extends Scalar ? '' :
    T extends Array<infer U>
    ? U extends object
        ? `${Prefix}${ScalarPathToScalarArraySpreadingObjectArrays<U>}`
        : never
    : {
        [P in keyof T]-?: P extends ScalarProperties<T> ? never :
            P extends ObjectProperties<T>
            ? `${Prefix}${string & P}.${ScalarPathToScalarArraySpreadingObjectArrays<NonNullable<T[P]>>}`
            : P extends ArrayOfScalarProperties<T> ? `${Prefix}${string & P}`
            : (NonNullable<T[P]> extends Array<any> 
                ? (NonNullable<T[P]>[number] extends object 
                    ? `${Prefix}${string & P}.${ScalarPathToScalarArraySpreadingObjectArrays<NonNullable<T[P]>[number]>}` 
                    : (NonNullable<T[P]>[number] extends Scalar 
                        ? `${Prefix}${string & P}` 
                        : never))
                : never);
                
    }[keyof T];

export type DotPropPathsUnionScalar<T  extends Record<string, any>> = { [K in ScalarPath<T>]: RemoveTrailingDot<K> }[ScalarPath<T>];
export type DotPropPathsUnionScalarSpreadingObjectArrays<T  extends Record<string, any>> = { [K in ScalarPathSpreadingObjectArrays<T>]: RemoveTrailingDot<K> }[ScalarPathSpreadingObjectArrays<T>];
export type DotPropPathsUnionScalarArraySpreadingObjectArrays<T  extends Record<string, any>> = { [K in ScalarPathToScalarArraySpreadingObjectArrays<T>]: RemoveTrailingDot<K> }[ScalarPathToScalarArraySpreadingObjectArrays<T>];

export type NonArrayProperty<T> = {
    [P in keyof T]: T[P] extends Array<any> ? never : P
}[keyof T];


/*
export type PathValue<T extends Record<string, any>, P> = P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
        ? NonNullable<T[Key]> extends Array<infer U>
            ? PathValue<EnsureRecord<U>, Rest>
            : PathValue<T[Key], Rest>
        : never
    : P extends keyof T
        ? T[P]
        : never;
*/
export type PathValue<T extends Record<string, any>, P> = P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
        ? NonNullable<T[Key]> extends Array<infer U>
            ? PathValue<EnsureRecord<U>, Rest>
            : PathValue<NonNullable<T[Key]>, Rest>
        : never
    : P extends keyof T
        ? NonNullable<T[P]>
        : never;


// Helper type to decrement depth
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, ...0[]];

export type DotPropPathToArraySpreadingArrays<T extends Record<string, any>, Depth extends number = 8, Prefix extends string = ''> =  Depth extends 0 ? never : T extends object ? {
    [K in keyof T]?: K extends string 
        ? NonNullable<T[K]> extends Array<infer U> // NonNullable handles optional property here
            ? U extends object
                ? `${Prefix}${K}.${DotPropPathToArraySpreadingArrays<U, Prev[Depth], ''>}` | `${Prefix}${K}`
                : `${Prefix}${K}`
            : T[K] extends object
                ? `${Prefix}${K}.${DotPropPathToArraySpreadingArrays<T[K], Prev[Depth], ''>}`
                : never
        : never;
}[keyof T] : '';

export type DotPropPathToObjectArraySpreadingArrays<T extends Record<string, any>, Depth extends number = 8, Prefix extends string = ''> =  Depth extends 0 ? never : T extends object ? {
    [K in keyof T]-?: K extends string 
        ? NonNullable<T[K]> extends Array<infer U> // NonNullable handles optional property here
            ? U extends object // Check if the elements of array are objects
                ? `${Prefix}${K}.${DotPropPathToObjectArraySpreadingArrays<U, Prev[Depth], ''>}` | `${Prefix}${K}`
                : never // Exclude if the elements are not objects
            : T[K] extends object
                ? `${Prefix}${K}.${DotPropPathToObjectArraySpreadingArrays<T[K], Prev[Depth], ''>}`
                : never
        : never;
}[keyof T] : '';




export type DotPropPathValidArrayValue<T extends Record<string, any>, P extends DotPropPathToArraySpreadingArrays<T> = DotPropPathToArraySpreadingArrays<T>> = PathValue<T, P> extends Array<infer ElementType> ? EnsureRecord<ElementType> : never;

