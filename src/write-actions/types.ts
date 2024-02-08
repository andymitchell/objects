import { z } from "zod";
import { DotPropPathToArray, DotPropPathValidArrayValue } from "../dot-prop-paths/types";
import { UpdatingMethod, UpdatingMethodSchema, WhereFilterDefinition, WhereFilterSchema } from "../where-filter/types"


export const VALUE_TO_DELETE_KEY = undefined; // #VALUE_TO_DELETE_KEY If this is changed to null, change WriteActionPayloadUpdate to.... data: Nullable<Partial<T>>


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

    const WriteActionPayloadArrayPushSchema = z.object({
        type: z.literal('array_push'),
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
        WriteActionPayloadArrayPushSchema,
    ]);

    const WriteActionSchema = z.object({
        type: z.literal('write'),
        ts: z.number(),
        payload: WriteActionPayloadSchema,
    });

    return { writeAction: WriteActionSchema, payload: WriteActionPayloadSchema };
}


type WriteActionPayloadCreate<T extends Record<string, any>> = {
    type: 'create',
    data: T
}
type WriteActionPayloadUpdate<T extends Record<string, any>> = {
    type: 'update',
    data: Partial<T>, // #VALUE_TO_DELETE_KEY
    where: WhereFilterDefinition<T>,
    method: UpdatingMethod
}
type WriteActionPayloadArrayPush<T extends Record<string, any>> = {
    type: 'array_push',
    path: DotPropPathToArray<T>,
    value: DotPropPathValidArrayValue<T>,
    where: WhereFilterDefinition<T>
}
type WriteActionPayloadDelete<T extends Record<string, any>> = {
    type: 'delete',
    where: WhereFilterDefinition<T>
}
export type WriteActionPayload<T extends Record<string, any>> = WriteActionPayloadCreate<T> | WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayPush<T>;
export type WriteAction<T extends Record<string, any>> = {
    type: 'write',
    ts: number,
    payload: WriteActionPayload<T>
}

export type AppliedWritesOutput<T extends Record<string, any>> = { added: T[], updated: T[], deleted: T[], final_items: T[] }