import z from "zod";
import { UpdatingMethodSchema, WhereFilterSchema } from "../where-filter/schemas.ts";
import { isTypeEqual } from "@andyrmitchell/utils";
import type { WriteAction, WriteError, WriteErrorContext, WriteAffectedItem, WriteOutcomeOk, WriteOutcomeFailed, WriteOutcome, WriteResult, WritePayloadArrayScope, WritePayloadUpdate } from "./types.ts";
import { getZodSchemaAtSchemaDotPropPath, TreeNodeSchema } from "../dot-prop-paths/zod.ts";
import { PrimaryKeyValueSchema } from "../utils/getKeyValue.ts";


export function makeWriteActionSchema<T extends Record<string, any> = Record<string, any>>(objectSchema?: z.AnyZodObject):z.ZodType<WriteAction<T>> {
    return makeWriteActionAndPayloadSchema(objectSchema).writeAction;
}
export function makeWritePayloadSchema(objectSchema?: z.AnyZodObject) {
    return makeWriteActionAndPayloadSchema(objectSchema).payload;
}

function makeWriteActionAndPayloadSchema(objectSchema?: z.AnyZodObject) {
    const schema:z.ZodTypeAny = objectSchema ?? z.record(z.any());
    const WritePayloadCreateSchema = z.object({
        type: z.literal('create'),
        data: objectSchema? objectSchema.strict() : schema
    });

    const WritePayloadUpdateSchema = z.object({
        type: z.literal('update'),
        data: objectSchema? objectSchema.partial().strict() : schema,
        where: WhereFilterSchema,
        method: UpdatingMethodSchema.optional(),
    });
    isTypeEqual<z.infer<typeof WritePayloadUpdateSchema>['where'], WritePayloadUpdate<any>['where']>(true);
    isTypeEqual<z.infer<typeof WritePayloadUpdateSchema>['method'], WritePayloadUpdate<any>['method']>(true);

    const WritePayloadArrayCreateSchema = z.object({
        type: z.literal('array_scope'),
        scope: z.string(),
        action: z.record(z.any()), // This gets tighter control in the .refine below
        where: WhereFilterSchema,
    }).refine((data) => {
        const result = checkArrayScopeAction(schema, data as WritePayloadArrayScope<any>);
        return result;
    }, {
        message: "Value does not match the schema at the specified path",
        path: ["value"]
    });



    const WritePayloadDeleteSchema = z.object({
        type: z.literal('delete'),
        where: WhereFilterSchema,
    });

    const WritePayloadAddToSetSchema = z.object({
        type: z.literal('add_to_set'),
        path: z.string(),
        items: z.array(z.any()),
        unique_by: z.enum(['deep_equals', 'pk']),
        where: WhereFilterSchema,
    });

    const WritePayloadPushSchema = z.object({
        type: z.literal('push'),
        path: z.string(),
        items: z.array(z.any()),
        where: WhereFilterSchema,
    });

    const WritePayloadPullSchema = z.object({
        type: z.literal('pull'),
        path: z.string(),
        items_where: z.union([WhereFilterSchema, z.array(z.any())]),
        where: WhereFilterSchema,
    });

    const WritePayloadIncSchema = z.object({
        type: z.literal('inc'),
        path: z.string(),
        amount: z.number(),
        where: WhereFilterSchema,
    });

    const WritePayloadSchema = z.union([
        WritePayloadCreateSchema,
        WritePayloadUpdateSchema,
        WritePayloadDeleteSchema,
        WritePayloadArrayCreateSchema,
        WritePayloadAddToSetSchema,
        WritePayloadPushSchema,
        WritePayloadPullSchema,
        WritePayloadIncSchema,
    ]);

    const WriteActionSchema = z.object({
        type: z.literal('write'),
        ts: z.number(),
        uuid: z.string(),
        payload: WritePayloadSchema,
    }) as z.ZodType<WriteAction<any>>;

    return { writeAction: WriteActionSchema, payload: WritePayloadSchema }
}

export const WriteActionSchema = makeWriteActionSchema<any>();
isTypeEqual<z.infer<typeof WriteActionSchema>, WriteAction<any>>(true);


function checkArrayScopeAction(schema:z.ZodTypeAny, data: WritePayloadArrayScope<any>):boolean {
    const subSchema = getZodSchemaAtSchemaDotPropPath(schema, data.scope);
    if( !(subSchema instanceof z.ZodObject) ) {
        return false;
    }
    const subActionSchema = makeWriteActionAndPayloadSchema(subSchema);
    const result = subActionSchema.payload.safeParse(data.action).success;
    return result;

}

// ─── WriteError (renamed from WriteCommonError) ───

export const WriteErrorSchema = z.discriminatedUnion('type', [
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
        reason: z.string()
    })
])
isTypeEqual<z.infer<typeof WriteErrorSchema>, WriteError>(true);

// ─── WriteErrorContext ───

export function makeWriteErrorContextSchema<T extends Record<string, any> = Record<string, any>>() {
    return WriteErrorSchema.and(z.object({
        item_pk: PrimaryKeyValueSchema.optional(),
        item: (z.any() as z.ZodType<T | undefined>).optional(),
    })) as z.ZodType<WriteErrorContext<T>>;
}

// ─── WriteAffectedItem ───

export const WriteAffectedItemSchema = z.object({
    item_pk: PrimaryKeyValueSchema,
    item: z.any().optional(),
});
isTypeEqual<z.infer<typeof WriteAffectedItemSchema>, WriteAffectedItem<any>>(true);

// ─── WriteOutcome (discriminated union on `ok`) ───

export function makeWriteOutcomeOkSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        ok: z.literal(true),
        action: makeWriteActionSchema<T>(),
        affected_items: z.array(WriteAffectedItemSchema as z.ZodType<WriteAffectedItem<T>>).optional(),
    });
}
export const WriteOutcomeOkSchema = makeWriteOutcomeOkSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeOkSchema>, WriteOutcomeOk<any>>(true);

export function makeWriteOutcomeFailedSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        ok: z.literal(false),
        action: makeWriteActionSchema<T>(),
        affected_items: z.array(WriteAffectedItemSchema as z.ZodType<WriteAffectedItem<T>>).optional(),
        errors: z.array(makeWriteErrorContextSchema<T>()),
        unrecoverable: z.boolean().optional(),
        back_off_until_ts: z.number().optional(),
        blocked_by_action_uuid: z.string().optional(),
    });
}
export const WriteOutcomeFailedSchema = makeWriteOutcomeFailedSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeFailedSchema>, WriteOutcomeFailed<any>>(true);

export function makeWriteOutcomeSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.discriminatedUnion('ok', [
        makeWriteOutcomeOkSchema<T>(),
        makeWriteOutcomeFailedSchema<T>(),
    ]);
}
export const WriteOutcomeSchema = makeWriteOutcomeSchema<any>();
isTypeEqual<z.infer<typeof WriteOutcomeSchema>, WriteOutcome<any>>(true);

// ─── WriteResult ───

export function makeWriteResultSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.object({
        ok: z.boolean(),
        actions: z.array(makeWriteOutcomeSchema<T>()),
        error: z.object({ message: z.string() }).optional(),
    });
}
export const WriteResultSchema = makeWriteResultSchema<any>();
isTypeEqual<z.infer<typeof WriteResultSchema>, WriteResult<any>>(true);
