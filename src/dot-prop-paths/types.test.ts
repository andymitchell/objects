import { describe, test, expectTypeOf } from "vitest";
import { z } from "zod";
import type { ArrayProperty, DotPropPathsRecord, DotPropPathsRecordWithOptionalAdditionalValues, DotPropPathsUnion, DotPropPathsUnionScalarArraySpreadingObjectArrays, DotPropPathToArraySpreadingArrays, DotPropPathToObjectArraySpreadingArrays, NonArrayProperty, NonObjectArrayProperty, NumberProperty, PathValue, PrimaryKeyProperties, ScalarProperties } from "./types.ts";

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

/**
 * The key-filter utilities answer "which keys of `T` qualify?" — and nothing else.
 *
 * Every answer is a union of literal keys. `undefined` is not a key, so it must never appear in one:
 * downstream types index a mapped type by these unions, and an `undefined` member resolves to
 * `unknown`, which silently swallows whatever union it lands in.
 *
 * The fixture carries every awkward declaration shape at once — required, optional, explicitly
 * undefinable, null-only, and arrays in each of those flavours — so a filter that mis-sorts any one
 * of them fails here rather than downstream.
 */
describe('key filters answer with literal keys only', () => {

    type Mixed = {
        id: string;
        score: number;
        label?: string;
        count: number | undefined;
        nullOnly: null;
        tags?: string[];
        rows: { rid: string }[];
        maybe_rows?: { rid: string }[];
        undefinable_rows: { rid: string }[] | undefined;
    };

    /** Keys that may be written wholesale, in any of the declaration flavours. */
    type MixedNonArrayKeys = 'id' | 'score' | 'label' | 'count' | 'nullOnly';

    test('an array key is an array key however it is declared', () => {
        expectTypeOf<ArrayProperty<Mixed>>().toEqualTypeOf<'tags' | 'rows' | 'maybe_rows' | 'undefinable_rows'>();
    });

    test('a number key is a number key even when it may hold undefined', () => {
        expectTypeOf<NumberProperty<Mixed>>().toEqualTypeOf<'score' | 'count'>();
    });

    test('scalar keys cover every scalar flavour and no array', () => {
        expectTypeOf<ScalarProperties<Mixed>>().toEqualTypeOf<MixedNonArrayKeys>();
    });

    test('an optional or undefinable array is still an array, so it is not wholesale-writable', () => {
        expectTypeOf<NonArrayProperty<Mixed>>().toEqualTypeOf<MixedNonArrayKeys>();
    });

    test('a null-only key stays wholesale-writable', () => {
        // `NonNullable<null>` is `never`, and `never` satisfies every constraint including `Array<any>`,
        // so a key whose only value is `null` needs deciding before the array question is asked.
        expectTypeOf<NonArrayProperty<{ id: string; nullOnly: null }>>().toEqualTypeOf<'id' | 'nullOnly'>();
    });

    test('arrays of scalars join the wholesale-writable keys; arrays of objects do not', () => {
        expectTypeOf<NonObjectArrayProperty<Mixed>>().toEqualTypeOf<MixedNonArrayKeys | 'tags'>();
    });

    test('only an always-present string or number key can identify an item', () => {
        expectTypeOf<PrimaryKeyProperties<Mixed>>().toEqualTypeOf<'id' | 'score'>();
    });
});

/**
 * The array-path unions offer exactly the paths the runtime resolves.
 *
 * `convertSchemaToDotPropPathTree` unwraps an optional, nullable or defaulted wrapper at every step
 * of a walk, so a path is resolvable whether or not the objects along it are guaranteed to be there.
 * The type half has to agree: a path the types withhold is one no caller can write, and a path the
 * types invent is one the runtime will reject.
 */
describe('array paths are offered wherever the runtime can walk to them', () => {

    type Mixed = {
        id: string;
        label?: string;
        tags?: string[];
        rows: { rid: string }[];
        maybe_rows?: { rid: string }[];
        undefinable_rows: { rid: string }[] | undefined;
    };

    /** An array whose only route is through a parent that may be absent. */
    type OptParent = { id: string; box?: { rows: { rid: string }[] } };

    test('every array is reachable, in any declaration flavour, and nothing else is', () => {
        expectTypeOf<DotPropPathToArraySpreadingArrays<Mixed>>()
            .toEqualTypeOf<'tags' | 'rows' | 'maybe_rows' | 'undefinable_rows'>();
    });

    test('an array under an optional parent is reachable through that parent', () => {
        expectTypeOf<DotPropPathToObjectArraySpreadingArrays<OptParent>>().toEqualTypeOf<'box.rows'>();
        expectTypeOf<DotPropPathToArraySpreadingArrays<OptParent>>().toEqualTypeOf<'box.rows'>();
    });
});

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