
import { z, ZodNumber, ZodOptional, ZodSchema, type ZodTypeDef } from "zod";
import type { DotPropPathsIncArrayUnion, DotPropPathToArraySpreadingArrays, PathValue } from '../dot-prop-paths/types.js';
import isPlainObject from "../utils/isPlainObject.js";

import type { ObjOrDraft } from "./matchJavascriptObject.js";


export const WhereFilterLogicOperators = ['AND', 'OR', 'NOT'] as const;
export type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];

export const ValueComparisonNumericOperators = ['lt', 'gt', 'lte', 'gte'] as const;
export type ValueComparisonNumericOperatorsTyped = typeof ValueComparisonNumericOperators[number];
type ValueComparisonNumeric = Partial<Record<ValueComparisonNumericOperatorsTyped, number>>;
type ValueComparisonContains = { contains: string };
export type ValueComparison<T = any> = (T extends string? ValueComparisonContains : T extends number? ValueComparisonNumeric : never) | T;
export type ArrayValueComparisonElemMatch<T = any>  = {elem_match: T extends Record<string, any>? WhereFilterDefinition<T> : ValueComparison<T>};
export type ArrayValueComparison<T = any> = ArrayValueComparisonElemMatch<T>;

type IsAssignableTo<A, B> = A extends B ? true : false;

type ArrayElementFilter<T = any> = (T extends Record<string, any>? WhereFilterDefinition<T> :
    T extends string | number ? T : 
    never) | ArrayValueComparison<T>
export type ArrayFilter<T extends []> = ArrayElementFilter<T[number]> | T;
type PartialObjectFilter<T extends Record<string, any>> = Partial<{
    [P in DotPropPathsIncArrayUnion<T>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true
        ? ArrayFilter<PathValue<T, P>>
        : ValueComparison<PathValue<T, P>>
}>;


export type MatchJavascriptObject = <T extends Record<string, any> = Record<string, any>>(object:ObjOrDraft<T>, filter:WhereFilterDefinition<T>) => boolean;
//export type MatchJavascriptObjectInTesting = <T extends Record<string, any> = Record<string, any>>(object: Parameters<MatchJavascriptObject>[0], filter: Parameters<MatchJavascriptObject>[1], schema: z.AnyZodObject) => ReturnType<MatchJavascriptObject> | undefined;
export type MatchJavascriptObjectInTesting = <T extends Record<string, any> = Record<string, any>>(obj: T, filter:WhereFilterDefinition<T>, schema: z.ZodSchema<T>) => Promise<ReturnType<MatchJavascriptObject> | undefined>;


export type LogicFilter<T extends Record<string, any>> = {
    [K in WhereFilterLogicOperatorsTyped]?: WhereFilterDefinition<T>[];
}

export type WhereFilterDefinition<T extends Record<string, any> = any> =
    PartialObjectFilter<T>
    |
    LogicFilter<T>;



/*
type ExampleGeneric<T> = {
    name: string, 
    age: number,
    address: T
}
const a:WhereFilterDefinition<ExampleGeneric<{city: string}>> = {
    age: 1
};
class Bob<T> {
    constructor() {
        this.list({})
    }
    list(where: WhereFilterDefinition<ExampleGeneric<T>>) {

    }
}
*/

    

// Recursive definition of WhereFilter
// The 3rd 'any' is to stop TypeScript panicking "Type instantiation is excessively deep and possibly infinite.": https://github.com/colinhacks/zod/issues/577
export const WhereFilterSchema: ZodSchema<WhereFilterDefinition<any>, ZodTypeDef, any> = z.lazy(() =>
    z.union([
        z.record(z.union([
            ValueComparisonSchema,
            ArrayValueComparisonSchema,
            WhereFilterSchema
        ])),
        z.object({
            OR: z.array(WhereFilterSchema).optional(),
            AND: z.array(WhereFilterSchema).optional(),
            NOT: z.array(WhereFilterSchema).optional(),
        }),
    ])
);


const ValueComparisonNumericSchemaPartial: Record<string, ZodOptional<ZodNumber>> = {};
ValueComparisonNumericOperators.forEach(operator => ValueComparisonNumericSchemaPartial[operator] = z.number().optional());
const ValueComparisonNumericSchema = z.object(ValueComparisonNumericSchemaPartial);
const ValueComparisonContainsSchema = z.object({
    contains: z.union([z.string(), z.number()]),
});
/*
const ValueComparisonArrayContainsSchema = z.object({
    array_contains: z.union([z.string(), z.number()]),
});
*/
const ValueComparisonScalarSchema = z.union([z.string(), z.number()]);

const ValueComparisonSchema = z.union([
    ValueComparisonScalarSchema,
    ValueComparisonContainsSchema,
    //ValueComparisonArrayContainsSchema,
    ValueComparisonNumericSchema,
]);

const ArrayValueComparisonElemMatchSchema = z.object({
    elem_match: z.union([ValueComparisonSchema, WhereFilterSchema]),
});
const ArrayValueComparisonSchema = ArrayValueComparisonElemMatchSchema;

//type WhereFilterValue = z.infer<typeof ValueComparison>;


/*
const WhereFilterSchema2 = <T>(schema: ZodType<T, any, any>) => z.union([
    z.record(ValueComparison),
    z.object({
        OR: z.array(WhereFilterSchema2(schema)).optional(),
        AND: z.array(WhereFilterSchema2(schema)).optional(),
        NOT: z.array(WhereFilterSchema2(schema)).optional(),
    }),
]);
*/


  

export function isWhereFilterDefinition(x: unknown):x is WhereFilterDefinition {
    return WhereFilterSchema.safeParse(x).success;
}
export function isWhereFilterArray(x:unknown): x is WhereFilterDefinition<any>[] {
    return !!x && Array.isArray(x) && x.every(x => isWhereFilterDefinition(x));
}

export function isValueComparisonContains(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonContains {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "contains" in x;
}

export function isArrayValueComparisonElemMatch(x: unknown): x is ArrayValueComparisonElemMatch {
    return ArrayValueComparisonElemMatchSchema.safeParse(x).success;
}

/*
export function isValueComparisonArrayContains(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonArrayContains {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "array_contains" in x;
}
*/
export function isValueComparisonNumeric(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonNumeric {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && ValueComparisonNumericOperators.some(op => op in x);
}
export function isValueComparisonScalar(x:unknown): x is string | number | boolean {
    return typeof x==='string' || typeof x==='number' || typeof x==='boolean';
}


function safeJson(object:any):string | undefined {
    try {
        return JSON.stringify(object);
    } catch(e) {
        return undefined;
    }
}
    
export type UpdatingMethod = 'merge' | 'assign';
export const UpdatingMethodSchema = z.enum(['merge', 'assign']);

export function isLogicFilter<T extends Record<string, any>>(filter:WhereFilterDefinition<any>):filter is LogicFilter<T> {
    return WhereFilterLogicOperators.some(type => {
        return filter.hasOwnProperty(type) && Array.isArray(filter[type])
    });
}
export function getValidFilterType(filter:WhereFilterDefinition<any>, debugPath?:WhereFilterDefinition<any>[]):'logic' | 'value' | undefined {
    if( isPlainObject(filter) ) { 
        if( isLogicFilter(filter) ) {
            return 'logic';
        } else {
            if( Object.keys(filter).length!==1 ) {
                throw new Error("A WhereFilter must have a single key, or be a recursive with OR/AND/NOT arrays. Path: "+safeJson(debugPath || [filter]));
            }
            return 'value';
        }
    } else {
        throw new Error("The WhereFilter must be an object. Path: "+safeJson(debugPath || [filter]));
    }
}

