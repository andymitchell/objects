import { z } from "zod";
import type { DotPropPathsRecord, DotPropPathsRecordWithOptionalAdditionalValues, DotPropPathsUnion, DotPropPathsUnionScalarArraySpreadingObjectArrays, DotPropPathToArraySpreadingArrays, NonObjectArrayProperty, PathValue } from "./types.ts";

it('no test just type errors', () => {
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
    // @ts-expect-error
    const b: ExampleTypedValues = { age: 'twelve' }; // Expect fail: Type 'string' is not assignable to type 'number'.

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
            // @ts-expect-error
            this.list({age: 1}) // INCORRECT ERROR / SYSTEM FAILURE. Typescript can't handle this use case with generics defined at the class level (note that Filter<T> would work with generics, as 'f' does)
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
    
    
    const i:ArrayPush<Example, 'family'> = {
        type: 'array_create', 
        path: 'family', 
        // @ts-expect-error
        value: {relation: 'uncle2'} // Expect Fail
    }
    
    
    const j: ArrayPush<Example, 'family'> = {
        type: 'array_create',
        path: 'family',
        // @ts-expect-error
        value: { name: 'grey' } // Expect Fail
    }
    

    
    type Update<T> = {
        type: 'update',
        data: Pick<Partial<T>, NonObjectArrayProperty<T>>
    };
    const aa: Update<Example> = {
        type: 'update',
        data: { address: { city: 'London' } }
    };

    const p1:DotPropPathsUnionScalarArraySpreadingObjectArrays<Example> = 'hobbies';
    const p2:DotPropPathsUnionScalarArraySpreadingObjectArrays<Example> = 'parttime_hobbies';
    
    
    const ab: Update<Example> = {
        type: 'update',
        // @ts-expect-error
        data: { family: [] } // Expect Fail
    };
    
    const ac: Update<Example> = {
        type: 'update',
        data: { hobbies: [] }
    };

    const configSchema = z.object({
        name: z.string(),
        age: z.number().optional(),
        location: z.object({
            street: z.string().optional(), 
            city: z.string().optional()
        }).optional(), 
        pets: z.array(z.string()).optional()
    });
    
    class Config<T extends Record<string, any>> {
        constructor(schema?: z.Schema<T>) {
        }
        get<P extends DotPropPathsUnion<T>>(path:P):PathValue<T, P> | undefined {
            return undefined;
        }
        set<P extends DotPropPathsUnion<T>>(path:P, value:PathValue<T, P>):void {

        }
    }
    const conf1 = new Config(configSchema);
    conf1.set('location.city', 'London');
    const val = conf1.get('location.city');
})

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