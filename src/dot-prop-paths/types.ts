

type PathValue<T, P extends string> = P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
    ? PathValue<T[Key], Rest>
    : never
    : P extends keyof T
    ? T[P]
    : never;

export type DotPropPathsRecord<T> = {
    [P in DotPropPathsUnion<T> as string & P]: PathValue<T, P>
};


export type DotPropPathsRecordWithOptionalAdditionalValues<T, EV> = {
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


type RemoveTrailingDot<T> = T extends `${infer S}.` ? never : T;
export type DotPropPathsUnion<T> = { [K in Path<T>]: RemoveTrailingDot<K> }[Path<T>];


type DotPropPathsRecordExplicitValues<T, EV> = {
    [P in DotPropPathsUnion<T> as string & P]: EV
};


export type DotPropPathToArray<T> = {
    [P in DotPropPathsUnion<T>]: PathValue<T, P> extends Array<any> ? P : never
}[DotPropPathsUnion<T>];
export type DotPropPathValidArrayValue<T> = PathValue<T, DotPropPathToArray<T>> extends Array<infer ElementType> ? ElementType : never;

function test() {
    type Example = {
        name: string;
        age: number;
        address: {
            city: string;
        };
        friends?: string,
        pets: Record<string, number>;
        family: {relation: 'aunt' | 'uncle'}[],
        homes: {name: 'grey' | 'farm'}[]
    };

    type ExamplePaths = DotPropPathsUnion<Example>;
    const examplePaths: ExamplePaths = 'address'; // OK


    type ExampleTypedValues = Partial<DotPropPathsRecord<Example>>;
    const a: ExampleTypedValues = { age: 12, 'address.city': 'New York', 'pets.somePet': 1 }; // OK
    //const b: ExampleTypedValues = { age: 'twelve' }; // Correct Error: Type 'string' is not assignable to type 'number'.

    type ValueComparisonContains = { contains: string };
    type ValueComparisonArrayContains = { array_contains: string };
    type ValueComparison = ValueComparisonContains | ValueComparisonArrayContains
    type ExampleTypedValues2 = Partial<DotPropPathsRecordWithOptionalAdditionalValues<Example, ValueComparison>>;
    const c: ExampleTypedValues2 = { 'address.city': {contains: 'Lon'}};


    type ExampleGeneric<T> = {
        name: string, 
        age: number,
        address: T
    }
    type ExampleGenericTypedValues = Partial<DotPropPathsRecord<ExampleGeneric<{city: string}>>>;
    const d: ExampleGenericTypedValues = { age: 1, 'address.city': 'New York' }; // OK
    type ExampleGenericTypedValues2 = Partial<DotPropPathsRecordWithOptionalAdditionalValues<ExampleGeneric<{city: string}>, ValueComparison>>;
    const e: ExampleGenericTypedValues2 = { 'address.city': {contains: 'Lon'}};

    type Filter<T> = Partial<DotPropPathsRecordWithOptionalAdditionalValues<T, ValueComparison>>
    const f: Filter<ExampleGeneric<{city: string}>> = { age: 1, 'address.city': 'New York' }; // OK
    class ExampleClass<T> {
        constructor() {
            //this.list({age: 1}) // INCORRECT ERROR / SYSTEM FAILURE. Typescript can't handle this use case with generics defined at the class level (note that Filter<T> would work with generics, as 'f' does)
            this.list2({age: 1}) // OK
        }
        list(where: Filter<ExampleGeneric<T>>) {
        }
        list2(where: Filter<ExampleGeneric<{}>>) {
        }
    }


    const g:DotPropPathToArray<Example> = 'family';
    type ArrayPush<T> = {
        type: 'array_push',
        path: DotPropPathToArray<T>,
        value: DotPropPathValidArrayValue<T>
    };
    const h:ArrayPush<Example> = {
        type: 'array_push', 
        path: 'family', 
        value: {relation: 'aunt'}
    }
    /*
    const i:ArrayPush<Example> = {
        type: 'array_push', 
        path: 'family', 
        value: {relation: 'uncle2'} // Expect Fail
    }
    */
    const j:ArrayPush<Example> = {
        type: 'array_push', 
        path: 'family', 
        value: {name: 'grey'} // TODO This shouldn't really be allowed. Ideally it will keep in sync with 'path'. 
    }
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