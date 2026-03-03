import z from "zod";
import { UpdatingMethodSchema, WhereFilterSchema } from "../where-filter/schemas.ts";
import { isTypeEqual } from "@andyrmitchell/utils";
import type { WriteAction, WriteActionError, WriteActionErrorContext, WriteActionAffectedItem, WriteActionOutcomeOk, WriteActionOutcomeFailed, WriteActionOutcome, WriteResult, WriteActionPayloadArrayScope, WriteActionPayloadUpdate } from "./types.ts";
import { getZodSchemaAtSchemaDotPropPath, TreeNodeSchema } from "../dot-prop-paths/zod.ts";
import { PrimaryKeyValueSchema } from "../utils/getKeyValue.ts";


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

// ─── WriteActionError (renamed from WriteCommonError) ───

export const WriteActionErrorSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('custom'),
        message: z.string().optional()
    }).passthrough(),
    z.object({
        type: z.literal('schema'),
        issues: (z.array(z.any()) as z.ZodType<z.ZodIssue[]>),
        tested_item: z.any(),
        serialised_schema: TreeNodeSchema.optional()
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
isTypeEqual<z.infer<typeof WriteActionErrorSchema>, WriteActionError>(true);

// ─── WriteActionErrorContext ───

export function makeWriteActionErrorContextSchema<T extends Record<string, any> = Record<string, any>>() {
    return WriteActionErrorSchema.and(z.object({
        item_pk: PrimaryKeyValueSchema.optional(),
        item: (z.any() as z.ZodType<T | undefined>).optional(),
    })) as z.ZodType<WriteActionErrorContext<T>>;
}

// ─── WriteActionAffectedItem ───

export const WriteActionAffectedItemSchema = z.object({
    item_pk: PrimaryKeyValueSchema,
    item: z.any().optional(),
});
isTypeEqual<z.infer<typeof WriteActionAffectedItemSchema>, WriteActionAffectedItem<any>>(true);

// ─── WriteActionOutcome (discriminated union on `ok`) ───

export function makeWriteActionOutcomeOkSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        ok: z.literal(true),
        action: makeWriteActionSchema<T>(),
        affected_items: z.array(WriteActionAffectedItemSchema as z.ZodType<WriteActionAffectedItem<T>>).optional(),
    });
}
export const WriteActionOutcomeOkSchema = makeWriteActionOutcomeOkSchema<any>();
isTypeEqual<z.infer<typeof WriteActionOutcomeOkSchema>, WriteActionOutcomeOk<any>>(true);

export function makeWriteActionOutcomeFailedSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        ok: z.literal(false),
        action: makeWriteActionSchema<T>(),
        affected_items: z.array(WriteActionAffectedItemSchema as z.ZodType<WriteActionAffectedItem<T>>).optional(),
        errors: z.array(makeWriteActionErrorContextSchema<T>()),
        unrecoverable: z.boolean().optional(),
        back_off_until_ts: z.number().optional(),
        blocked_by_action_uuid: z.string().optional(),
    });
}
export const WriteActionOutcomeFailedSchema = makeWriteActionOutcomeFailedSchema<any>();
isTypeEqual<z.infer<typeof WriteActionOutcomeFailedSchema>, WriteActionOutcomeFailed<any>>(true);

export function makeWriteActionOutcomeSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.discriminatedUnion('ok', [
        makeWriteActionOutcomeOkSchema<T>(),
        makeWriteActionOutcomeFailedSchema<T>(),
    ]);
}
export const WriteActionOutcomeSchema = makeWriteActionOutcomeSchema<any>();
isTypeEqual<z.infer<typeof WriteActionOutcomeSchema>, WriteActionOutcome<any>>(true);

// ─── WriteResult ───

export function makeWriteResultSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        ok: z.boolean(),
        actions: z.array(makeWriteActionOutcomeSchema<T>()),
        error: z.object({ message: z.string() }).optional(),
    });
}
export const WriteResultSchema = makeWriteResultSchema<any>();
isTypeEqual<z.infer<typeof WriteResultSchema>, WriteResult<any>>(true);
