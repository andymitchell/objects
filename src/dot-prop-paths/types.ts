

import { EnsureRecord } from "../types";

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
    [P in keyof T]: T[P] extends Scalar ? P : never
}[keyof T];
type ObjectProperties<T> = { // Helper type to pick only non-scalar, non-array object properties
    [P in keyof T]: T[P] extends object ? (T[P] extends Array<any> ? never : P) : never
}[keyof T];
type ScalarPath<T extends Record<string, any>, Prefix extends string = ''> = T extends Scalar ? '' :
    {
        [P in keyof T]-?: P extends ScalarProperties<T> ? `${Prefix}${string & P}` :
            P extends ObjectProperties<T>
            ? `${Prefix}${string & P}.${ScalarPath<T[P]>}`
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
            ? `${Prefix}${string & P}.${ScalarPathSpreadingObjectArrays<T[P]>}`
            : P extends keyof T ? (T[P] extends Array<any> ? (T[P][number] extends object ?
                `${Prefix}${string & P}.${ScalarPathSpreadingObjectArrays<T[P][number]>}` : never) : never)
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
            ? `${Prefix}${string & P}.${ScalarPathToScalarArraySpreadingObjectArrays<T[P]>}`
            : P extends ArrayOfScalarProperties<T> ? `${Prefix}${string & P}`
            : (T[P] extends Array<any> 
                ? (T[P][number] extends object 
                    ? `${Prefix}${string & P}.${ScalarPathToScalarArraySpreadingObjectArrays<T[P][number]>}` 
                    : (T[P][number] extends Scalar 
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
            : PathValue<T[Key], Rest>
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


function test() {
    type Example = {
        name: string;
        age: number;
        address: {
            city: string;
        };
        friends?: string,
        pets: Record<string, number>;
        family: { relation: 'aunt' | 'uncle' }[],
        homes: { name: 'grey' | 'farm' }[],
        hobbies: string[],
        parttime_hobbies?: string[],
    };

    type ExamplePaths = DotPropPathsUnion<Example>;
    const examplePaths: ExamplePaths = 'address'; // OK


    type ExampleTypedValues = Partial<DotPropPathsRecord<Example>>;
    const a: ExampleTypedValues = { age: 12, 'address.city': 'New York', 'pets.somePet': 1 }; // OK
    //const b: ExampleTypedValues = { age: 'twelve' }; // Expect fail: Type 'string' is not assignable to type 'number'.

    type ValueComparisonContains = { contains: string };
    type ValueComparisonArrayContains = { array_contains: string };
    type ValueComparison = ValueComparisonContains | ValueComparisonArrayContains
    type ExampleTypedValues2 = Partial<DotPropPathsRecordWithOptionalAdditionalValues<Example, ValueComparison>>;
    const c: ExampleTypedValues2 = { 'address.city': { contains: 'Lon' } };


    type ExampleGeneric<T> = {
        name: string,
        age: number,
        address: T
    }
    type ExampleGenericTypedValues = Partial<DotPropPathsRecord<ExampleGeneric<{ city: string }>>>;
    const d: ExampleGenericTypedValues = { age: 1, 'address.city': 'New York' }; // OK
    type ExampleGenericTypedValues2 = Partial<DotPropPathsRecordWithOptionalAdditionalValues<ExampleGeneric<{ city: string }>, ValueComparison>>;
    const e: ExampleGenericTypedValues2 = { 'address.city': { contains: 'Lon' } };

    type Filter<T extends Record<string, any>> = Partial<DotPropPathsRecordWithOptionalAdditionalValues<T, ValueComparison>>
    const f: Filter<ExampleGeneric<{ city: string }>> = { age: 1, 'address.city': 'New York' }; // OK
    class ExampleClass<T> {
        constructor() {
            //this.list({age: 1}) // INCORRECT ERROR / SYSTEM FAILURE. Typescript can't handle this use case with generics defined at the class level (note that Filter<T> would work with generics, as 'f' does)
            this.list2({ age: 1 }) // OK
        }
        list(where: Filter<ExampleGeneric<T>>) {
        }
        list2(where: Filter<ExampleGeneric<{}>>) {
        }
    }


    //const g: DotPropPathToArrayInPlainObject<Example> = 'family';
    type ArrayElementType<T> = T extends (infer E)[] ? E : never;
   
    type ArrayPush<T extends Record<string, any>, P extends DotPropPathToArraySpreadingArrays<T>> = {
        type: 'array_create',
        path: P,
        value: ArrayElementType<PathValue<T, P>>
    };

    const h: ArrayPush<Example, 'family'> = {
        type: 'array_create',
        path: 'family',
        value: { relation: 'aunt' }
    }
    /*
    const i:ArrayPush<Example> = {
        type: 'array_create', 
        path: 'family', 
        value: {relation: 'uncle2'} // Expect Fail
    }
    */
    /*
    const j: ArrayPush<Example, 'family'> = {
        type: 'array_create',
        path: 'family',
        value: { name: 'grey' } // Expect Fail
    }
    */

    
    type Update<T> = {
        type: 'update',
        data: Pick<Partial<T>, NonArrayProperty<T>>
    };
    const aa: Update<Example> = {
        type: 'update',
        data: { address: { city: 'London' } }
    };

    const p1:DotPropPathsUnionScalarArraySpreadingObjectArrays<Example> = 'hobbies';
    const p2:DotPropPathsUnionScalarArraySpreadingObjectArrays<Example> = 'parttime_hobbies';
    
    /*
    const ab: Update<Example> = {
        type: 'update',
        data: { family: [] } // Expect Fail
    };
    */
}

/*
//I also tried to make AutoPath work (https://github.com/millsp/ts-toolbelt / https://millsp.github.io/ts-toolbelt/modules/function_autopath.html / https://www.reddit.com/r/typescript/comments/lbuhbt/productionready_typesafe_dotted_path_notation/), but it didn't seem to do anything. 
import {Function, String, Object} from 'ts-toolbelt';
declare function getPropp<O extends object, P extends string>(
    object: O, path: Function.AutoPath<O, P>
);

const obj:Example = {
    name: 'A', age: 1, address: {city: 'L'}, pets: {}
}
getPropp(obj, 'namee');
*/