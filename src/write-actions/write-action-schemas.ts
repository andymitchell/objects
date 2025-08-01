import z from "zod";
import { UpdatingMethodSchema, WhereFilterSchema } from "../where-filter/schemas.ts";
import { isTypeEqual } from "@andyrmitchell/utils";
import type { WriteAction, FailedWriteAction, FailedWriteActionAffectedItem, WriteActionPayloadArrayScope, WriteActionPayloadUpdate, WriteActionsResponseError, WriteActionsResponseOk, SuccessfulWriteAction, WriteCommonError } from "./types.ts";
import { getZodSchemaAtSchemaDotPropPath } from "../dot-prop-paths/zod.ts";
import { PrimaryKeyValueSchema } from "../utils/getKeyValue.ts";
import { SerializableCommonErrorSchema } from "@andyrmitchell/utils/serialize-error";


export function makeWriteActionSchema<T extends Record<string, any> = Record<string, any>>(objectSchema?: z.AnyZodObject):z.ZodType<WriteAction<T>> {
    return makeWriteActionAndPayloadSchema(objectSchema).writeAction;
}
export function makeWriteActionPayloadSchema(objectSchema?: z.AnyZodObject) {
    return makeWriteActionAndPayloadSchema(objectSchema).payload;
}

function makeWriteActionAndPayloadSchema(objectSchema?: z.AnyZodObject) {
    const schema:z.ZodTypeAny = objectSchema ?? z.record(z.any());
    const WriteActionPayloadCreateSchema = z.object({
        type: z.literal('create'),
        data: objectSchema? objectSchema.strict() : schema
    });

    const WriteActionPayloadUpdateSchema = z.object({
        type: z.literal('update'),
        data: objectSchema? objectSchema.partial().strict() : schema,
        where: WhereFilterSchema,
        method: UpdatingMethodSchema.optional(),
    });
    isTypeEqual<z.infer<typeof WriteActionPayloadUpdateSchema>['where'], WriteActionPayloadUpdate<any>['where']>(true);
    isTypeEqual<z.infer<typeof WriteActionPayloadUpdateSchema>['method'], WriteActionPayloadUpdate<any>['method']>(true);

    const WriteActionPayloadArrayCreateSchema = z.object({
        type: z.literal('array_scope'),
        scope: z.string(),
        action: z.record(z.any()), // This gets tighter control in the .refine below 
        where: WhereFilterSchema,
    }).refine((data) => {
        const result = checkArrayScopeAction(schema, data as WriteActionPayloadArrayScope<any>);
        return result;
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
        uuid: z.string(),
        payload: WriteActionPayloadSchema,
    }) as z.ZodType<WriteAction<any>>;

    return { writeAction: WriteActionSchema, payload: WriteActionPayloadSchema }
}

export const WriteActionSchema = makeWriteActionSchema<any>();
isTypeEqual<z.infer<typeof WriteActionSchema>, WriteAction<any>>(true);


function checkArrayScopeAction(schema:z.ZodTypeAny, data: WriteActionPayloadArrayScope<any>):boolean {
    const subSchema = getZodSchemaAtSchemaDotPropPath(schema, data.scope);
    if( !(subSchema instanceof z.ZodObject) ) {
        return false;
    }
    const subActionSchema = makeWriteActionAndPayloadSchema(subSchema);
    const result = subActionSchema.payload.safeParse(data.action).success;
    return result;
    
}

export const WriteCommonErrorSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('custom'),
        message: z.string().optional()
    }).passthrough(),
    z.object({
        type: z.literal('schema'),
        issues: (z.array(z.any()) as z.ZodType<z.ZodIssue[]>)
    }),
    z.object({
        type: z.literal('missing_key'),
        primary_key: z.union([z.string(), z.number(), z.symbol()])
    }),
    z.object({
        type: z.literal('create_duplicated_key'),
        primary_key: z.union([z.string(), z.number(), z.symbol()])
    }),
    z.object({
        type: z.literal('update_altered_key'),
        primary_key: z.union([z.string(), z.number(), z.symbol()])
    }),
    z.object({
        type: z.literal('permission_denied'),
        reason: z.union([z.literal('no-owner-id'), z.literal('not-owner'), z.literal('unknown-permission'), z.literal('invalid-permissions'), z.literal('expected-owner-email'), z.literal('not-authenticated')])
    })
])
isTypeEqual<z.infer<typeof WriteCommonErrorSchema>, WriteCommonError>(true);

const WriteActionAffectedItemSchema = z.object({
    item_pk:PrimaryKeyValueSchema
})
const FailedWriteActionAffectedItemSchema = WriteActionAffectedItemSchema.merge(z.object({
    item: z.any(),
    error_details: z.array(WriteCommonErrorSchema)
}))
isTypeEqual<z.infer<typeof FailedWriteActionAffectedItemSchema>, FailedWriteActionAffectedItem<any>>(true);

export function makeFailedWriteActionSchema<T extends Record<string, any> = Record<string, any>>() {
    const error_details = z.array(WriteCommonErrorSchema);
    return z.object({
        action: makeWriteActionSchema<T>(),
        error_details,
        unrecoverable: z.boolean().optional(),
        back_off_until_ts: z.number().optional(),
        blocked_by_action_uuid: z.string().optional(),
        affected_items: z.array(FailedWriteActionAffectedItemSchema as z.ZodType<FailedWriteActionAffectedItem<T>>).optional()
    });
}
export const FailedWriteActionSchema = makeFailedWriteActionSchema();
isTypeEqual<z.infer<typeof FailedWriteActionSchema>, FailedWriteAction<any>>(true);



export function makeSuccessfulWriteActionSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        action: makeWriteActionSchema<T>(),
        affected_items: z.array(WriteActionAffectedItemSchema).optional()
    })
}
export const SuccessfulWriteActionSchema = makeSuccessfulWriteActionSchema<any>();
isTypeEqual<z.infer<typeof SuccessfulWriteActionSchema>, SuccessfulWriteAction<any>>(true);


export const WriteActionsResponseOkSchema = z.object({
    status: z.literal('ok')
})
isTypeEqual<z.infer<typeof WriteActionsResponseOkSchema>, WriteActionsResponseOk>(true);

export const WriteActionsResponseErrorSchema = z.object({
    status: z.literal('error'),
    successful_actions: z.array(SuccessfulWriteActionSchema),
    failed_actions: z.array(FailedWriteActionSchema)
}).merge(SerializableCommonErrorSchema);
isTypeEqual<z.infer<typeof WriteActionsResponseErrorSchema>, WriteActionsResponseError<any>>(true);

export const WriteActionsResponseSchema = z.discriminatedUnion('status', [
    WriteActionsResponseOkSchema,
    WriteActionsResponseErrorSchema
]);

