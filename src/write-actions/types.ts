import { z } from "zod";
import { DotPropPathToArraySpreadingArrays, DotPropPathToArrayInPlainObject, DotPropPathValidArrayValue, DotPropPathValidArrayValueSimple, PathValue } from "../dot-prop-paths/types";
import { UpdatingMethod, UpdatingMethodSchema, WhereFilterDefinition, WhereFilterSchema } from "../where-filter/types"


export const VALUE_TO_DELETE_KEY:undefined = undefined; // #VALUE_TO_DELETE_KEY If this is changed to null, change WriteActionPayloadUpdate to.... data: Nullable<Partial<T>>


export function createWriteActionSchema(schema: z.AnyZodObject) {
    const WriteActionPayloadCreateSchema = z.object({
        type: z.literal('create'),
        data: schema.strict()
    });

    const WriteActionPayloadUpdateSchema = z.object({
        type: z.literal('update'),
        data: schema.partial().strict(),
        where: WhereFilterSchema,
        method: UpdatingMethodSchema,
    });

    function validateValueAtPath(schema: z.ZodTypeAny, path: string, value: unknown): boolean {
        if( typeof path!=='string' ) return false;
        
        const pathParts = path.split('.');
        let currentSchema: z.ZodTypeAny = schema;
        for (const part of pathParts) {
            if (currentSchema instanceof z.ZodObject) {
                currentSchema = currentSchema.shape[part] || z.any();
            } else {
                // TODO Maybe... Handle other types (arrays, unions, etc.) as needed
                return false; // Path does not correctly correspond to the schema
            }
        }
        if( !(currentSchema instanceof z.ZodArray) ) {
            return false;
        }
        currentSchema = currentSchema.element;
        const result = currentSchema.safeParse(value);
        return result.success;
    }

    const WriteActionPayloadArrayCreateSchema = z.object({
        type: z.literal('array_create'),
        path: z.string(),
        value: z.any(), // This gets tighter control in the .refine below 
        where: WhereFilterSchema,
    }).refine((data) => {
        return validateValueAtPath(schema, data.path, data.value);
    }, {
        message: "Value does not match the schema at the specified path",
        path: ["value"]
    });

    const WriteActionPayloadDeleteSchema = z.object({
        type: z.literal('delete'),
        where: WhereFilterSchema,
    });

    const WriteActionPayloadSchema = z.union([
        WriteActionPayloadCreateSchema,
        WriteActionPayloadUpdateSchema,
        WriteActionPayloadDeleteSchema,
        WriteActionPayloadArrayCreateSchema,
    ]);

    const WriteActionSchema = z.object({
        type: z.literal('write'),
        ts: z.number(),
        payload: WriteActionPayloadSchema,
    });

    return { writeAction: WriteActionSchema, payload: WriteActionPayloadSchema };
}

type NonArrayProperty<T> = {
    [P in keyof T]: T[P] extends Array<any> ? never : P
}[keyof T];

export type WriteActionPayloadCreate<T extends Record<string, any>> = {
    type: 'create',
    data: T
}
export type WriteActionPayloadUpdate<T extends Record<string, any>> = {
    type: 'update',
    data: Pick<Partial<T>, NonArrayProperty<T>>, // Updating whole arrays is forbidden, use array_scope instead. Why? This would require the whole array to be 'set', even if its likely only a tiny part needs to change, and that makes it very hard for CRDTs to reconcile what to overwrite. One solution could be enable this by allowing it to 'diff' it against the client's current cached version to see what has changed, and convert it into array_scope actions internally. The downside, other than an additional layer of uncertainty of how a bug might sneak in (e.g. if cache is somehow not as expected at point of write), is it forces the application code to start editing arrays before passing it to an 'update' rather than directly describing the change... it's more verbose. (Also related: #VALUE_TO_DELETE_KEY).
    where: WhereFilterDefinition<T>,
    method: UpdatingMethod
}
export type WriteActionPayloadArrayScope<T extends Record<string, any>, P extends DotPropPathToArraySpreadingArrays<T> = DotPropPathToArraySpreadingArrays<T>> = {
    type: 'array_scope',
    scope: P,
    actions: WriteAction<DotPropPathValidArrayValue<T, P>>[] // FYI If you don't explicitly state the P generic, this will allow any array's values from T. 
}
/*
export type WriteActionPayloadArrayIterator<T extends Record<string, any>, P extends DotPropPathToArrayInPlainObject<T> = DotPropPathToArrayInPlainObject<T>> = {
    type: 'array_iterator',
    path: P,
    data: WriteActionPayloadArrayIterator<DotPropPathValidArrayValueSimple<T, P>> | WriteActionPayloadCreate<DotPropPathValidArrayValueSimple<T, P>> | WriteActionPayloadUpdate<DotPropPathValidArrayValueSimple<T, P>> // FYI If you don't explicitly state the P generic, this will allow any array's values from T. 
    where: WhereFilterDefinition<DotPropPathValidArrayValueSimple<T, P>>
}
*/
type WriteActionPayloadDelete<T extends Record<string, any>> = {
    type: 'delete',
    where: WhereFilterDefinition<T>
}
export type WriteActionPayload<T extends Record<string, any>> = WriteActionPayloadCreate<T> | WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>;
export type WriteAction<T extends Record<string, any>> = {
    type: 'write',
    ts: number,
    payload: WriteActionPayload<T>
}

export function isUpdateOrDeleteWriteActionPayload<T extends Record<string, any>>(x: unknown): x is WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>{
    return typeof x==='object' && !!x && 'type' in x && (x.type==='update' || x.type==='array_scope' || x.type==='delete');
}

export type AppliedWritesOutput<T extends Record<string, any>> = { added: T[], updated: T[], deleted: T[], final_items: T[] }

