
import { z, ZodNumber, ZodOptional, ZodType } from "zod";
import { DotPropPathsRecordWithOptionalAdditionalValues } from '../dot-prop-paths/types';
import isPlainObject from "../isPlainObject";


export const WhereFilterLogicOperators = ['AND', 'OR', 'NOT'] as const;
export type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];

export const ValueComparisonNumericOperators = ['lt', 'gt', 'lte', 'gte'] as const;
export type ValueComparisonNumericOperatorsTyped = typeof ValueComparisonNumericOperators[number];
type ValueComparisonNumeric = Partial<Record<ValueComparisonNumericOperatorsTyped, number>>;
type ValueComparisonContains = { contains: string };
type ValueComparisonArrayContains = { array_contains: string };
export type ValueComparison = ValueComparisonContains | ValueComparisonArrayContains | ValueComparisonNumeric



type PartialObjectFilter<T extends Record<string, any>> = Partial<DotPropPathsRecordWithOptionalAdditionalValues<T, ValueComparison>>;
type LogicFilter<T extends Record<string, any>> = {
    OR?: WhereFilterDefinition<T>[],
    AND?: WhereFilterDefinition<T>[],
    NOT?: WhereFilterDefinition<T>[]
}
export type WhereFilterDefinition<T extends Record<string, any> = any> =
    PartialObjectFilter<T>
    |
    LogicFilter<T>

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

    


const ValueComparisonNumericSchemaPartial: Record<string, ZodOptional<ZodNumber>> = {};
ValueComparisonNumericOperators.forEach(operator => ValueComparisonNumericSchemaPartial[operator] = z.number().optional());
const ValueComparisonNumericSchema = z.object(ValueComparisonNumericSchemaPartial);
const ValueComparisonContainsSchema = z.object({
    contains: z.union([z.string(), z.number()]),
});
const ValueComparisonArrayContainsSchema = z.object({
    array_contains: z.union([z.string(), z.number()]),
});
const ValueComparisonScalarSchema = z.union([z.string(), z.number()]);

const ValueComparison = z.union([
    ValueComparisonScalarSchema,
    ValueComparisonContainsSchema,
    ValueComparisonArrayContainsSchema,
    ValueComparisonNumericSchema,
]);

//type WhereFilterValue = z.infer<typeof ValueComparison>;

// Recursive definition of WhereFilter
export const WhereFilterSchema: ZodType<WhereFilterDefinition<any>, any> = z.lazy(() =>
    z.union([
        z.record(ValueComparison),
        z.object({
            OR: z.array(WhereFilterSchema).optional(),
            AND: z.array(WhereFilterSchema).optional(),
            NOT: z.array(WhereFilterSchema).optional(),
        }),
    ])
);

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


  


export function isWhereFilterArray(x:unknown): x is WhereFilterDefinition<any>[] {
    return !!x && Array.isArray(x) && x.every(x => isPlainObject(x));
}

export function isValueComparisonContains(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonContains {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "contains" in x;
}

export function isValueComparisonArrayContains(x:unknown, alreadyProvedIsPlainObject?:boolean): x is ValueComparisonArrayContains {
    // @ts-ignore
    return (alreadyProvedIsPlainObject || isPlainObject(x)) && "array_contains" in x;
}
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

