import { ZodIssueCode, z } from "zod";
import { DotPropPathToArraySpreadingArrays, DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, PathValue } from "../dot-prop-paths/types";
import { UpdatingMethod, UpdatingMethodSchema, WhereFilterDefinition, WhereFilterSchema } from "../where-filter/types"
import { getZodSchemaAtSchemaDotPropPath } from "../dot-prop-paths/zod";
import isTypeEqual from "../utils/isTypeEqual";
import { PrimaryKeyValue, PrimaryKeyValueSchema } from "../utils/getKeyValue";
import { Draft } from "immer";



export const VALUE_TO_DELETE_KEY:undefined = undefined; // #VALUE_TO_DELETE_KEY If this is changed to null, change WriteActionPayloadUpdate to.... data: Nullable<Partial<T>>



function checkArrayScopeAction(schema:z.ZodTypeAny, data: WriteActionPayloadArrayScope<any>):boolean {
    const subSchema = getZodSchemaAtSchemaDotPropPath(schema, data.scope);
    if( !(subSchema instanceof z.ZodObject) ) {
        return false;
    }
    const subActionSchema = createWriteActionSchema(subSchema);
    const result = subActionSchema.payload.safeParse(data.action).success;
    return result;
    
}


export function createWriteActionSchema(objectSchema?: z.AnyZodObject) {
    const schema:z.ZodTypeAny = objectSchema ?? z.record(z.any());
    const WriteActionPayloadCreateSchema = z.object({
        type: z.literal('create'),
        data: objectSchema? objectSchema.strict() : schema
    });

    const WriteActionPayloadUpdateSchema = z.object({
        type: z.literal('update'),
        data: objectSchema? objectSchema.partial().strict() : schema,
        where: WhereFilterSchema,
        method: UpdatingMethodSchema,
    });

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

const writeActionSchema = createWriteActionSchema().writeAction;
isTypeEqual<z.infer<typeof writeActionSchema>, WriteAction<any>>(true);




type NonArrayProperty<T> = {
    [P in keyof T]: T[P] extends Array<any> ? never : P
}[keyof T];

export type WriteActionPayloadCreate<T extends Record<string, any>> = {
    type: 'create',
    data: T
}
export type WriteActionPayloadUpdate<T extends Record<string, any>> = {
    type: 'update',
    data: Partial<Pick<T, NonArrayProperty<T>>>, // Updating whole arrays is forbidden, use array_scope instead. Why? This would require the whole array to be 'set', even if its likely only a tiny part needs to change, and that makes it very hard for CRDTs to reconcile what to overwrite. One solution could be enable this by allowing it to 'diff' it against the client's current cached version to see what has changed, and convert it into array_scope actions internally. The downside, other than an additional layer of uncertainty of how a bug might sneak in (e.g. if cache is somehow not as expected at point of write), is it forces the application code to start editing arrays before passing it to an 'update' rather than directly describing the change... it's more verbose. (Also related: #VALUE_TO_DELETE_KEY).
    where: WhereFilterDefinition<T>,
    method?: UpdatingMethod
}
export type WriteActionPayloadArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T> = DotPropPathToObjectArraySpreadingArrays<T>> = {
    type: 'array_scope',
    scope: P,
    // IS IT FAILING TO SPOT TYPES? YOU MUST SPECIFY THE 'P' GENERIC IN THE TYPE, OR IT FAILS. IT CANNOT PROPERLY INFER FROM 'scope'. OR USE HELPER assertArrayScope
    action: WriteActionPayload<DotPropPathValidArrayValue<T, P>>,
    where: WhereFilterDefinition<T>
}
type WriteActionPayloadDelete<T extends Record<string, any>> = {
    type: 'delete',
    where: WhereFilterDefinition<T>
}
export type WriteActionPayload<T extends Record<string, any>> = WriteActionPayloadCreate<T> | WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>;
export type WriteAction<T extends Record<string, any>> = {
    type: 'write',
    ts: number,
    uuid: string,
    payload: WriteActionPayload<T>
}

export function assertArrayScope<T extends Record<string, any>, P extends DotPropPathToObjectArraySpreadingArrays<T>>(action: WriteActionPayloadArrayScope<T, P>):WriteActionPayloadArrayScope<T,P> {
    return action;
}
/*
export function createWriteActionPayloadArrayScope<T extends Record<string, any>>() {
    return function<P extends DotPropPathToObjectArraySpreadingArrays<T>>(scope: P, action: WriteActionPayload<DotPropPathValidArrayValue<T, P>>, where: WhereFilterDefinition<T>):WriteActionPayloadArrayScope<T> {
        return {
            type: 'array_scope',
            scope,
            action,
            where
        };
    };
}
*/

export function isWriteActionArrayScopePayload<T extends Record<string, any> = Record<string, any>>(x: unknown):x is WriteActionPayloadArrayScope<T> {
    return typeof x==='object' && !!x && "type" in x && x.type==='array_scope';
}

export function isUpdateOrDeleteWriteActionPayload<T extends Record<string, any>>(x: unknown): x is WriteActionPayloadUpdate<T> | WriteActionPayloadDelete<T> | WriteActionPayloadArrayScope<T>{
    return typeof x==='object' && !!x && 'type' in x && (x.type==='update' || x.type==='array_scope' || x.type==='delete');
}

export type WriteActionAffectedItem = {
    item_pk:PrimaryKeyValue
}
export type WriteActionFailureAffectedItem<T extends Record<string, any> = Record<string, any>> = WriteActionAffectedItem & {
    item: T,
    error_details: WriteActionFailuresErrorDetails[]
}

export function createWriteActionFailuresSchema<T extends Record<string, any> = Record<string, any>>() {
    const error_details = z.array(z.union([
        z.record(z.any()).and(z.object({type: z.literal('custom')})),
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
        })
    ]));
    return z.array(z.object({
        action: (createWriteActionSchema().writeAction as z.ZodType<WriteAction<T>>),
        error_details,
        unrecoverable: z.boolean().optional(),
        back_off_until_ts: z.number().optional(),
        blocked_by_action_uuid: z.string().optional(),
        affected_items: z.array(z.object({
            item_pk: PrimaryKeyValueSchema,
            item: (z.record(z.any()) as z.ZodType<T>),
            error_details
        }))
    }));
}
const WriteActionFailuresSchema = createWriteActionFailuresSchema();
export type WriteActionFailuresErrorDetails = Record<string, any> & {type: 'custom'} | 
    {
        type: 'schema',
        issues: z.ZodIssue[]
    } | 
    {
        type: 'missing_key',
        primary_key: string | number | symbol
    } | 
    {
        type: 'update_altered_key',
        primary_key: string | number | symbol
    } | 
    {
        type: 'create_duplicated_key',
        primary_key: string | number | symbol
    }
export type WriteActionFailures<T extends Record<string, any> = Record<string, any>> = {
    action: WriteAction<T>,
    error_details: WriteActionFailuresErrorDetails[],
    unrecoverable?: boolean,
    back_off_until_ts?: number,
    blocked_by_action_uuid?: string,
    affected_items: WriteActionFailureAffectedItem<T>[]

}[];
isTypeEqual<z.infer<typeof WriteActionFailuresSchema>, WriteActionFailures<any>>(true);
/*
Clever type system for making it generic, BUT, it's not equivalent to WriteActionFailures, or even other WriteActionFailuresGeneric of same T.. it's a very complex inference. 
function inferWriteActionFailures<T extends Record<string, any>>() {
    return createWriteActionFailuresSchema<T>();
}
export type WriteActionFailuresGeneric<T extends Record<string, any> = Record<string, any>> = z.infer<ReturnType<typeof inferWriteActionFailures<T>>>;
*/

export function createWriteActionSuccessesSchema<T extends Record<string, any> = Record<string, any>>() {
    return z.array(z.object({
        action: (createWriteActionSchema().writeAction as z.ZodType<WriteAction<T>>),
        affected_items: z.array(z.object({
            item_pk: PrimaryKeyValueSchema,
        }))
    }))
}
export type WriteActionSuccess<T extends Record<string, any>> = {
    action: WriteAction<T>,
    affected_items: WriteActionAffectedItem[]
}
export type WriteActionSuccesses<T extends Record<string, any> = Record<string, any>> = WriteActionSuccess<T>[];
const WriteActionSuccessesSchema = createWriteActionSuccessesSchema();
isTypeEqual<z.infer<typeof WriteActionSuccessesSchema>, WriteActionSuccesses<any>>(true);

// TODO Replace this with createCustomGeneralError (currently in breef codebase)
export const WriteActionErrorSchema = z.record(z.any()).and(z.object({
    message: z.string(),
    type: z.string().optional(),
    failed_actions: WriteActionFailuresSchema
}));
export type WriteActionError<T extends Record<string, any> = Record<string, any>> = Record<string, any> & {
    message: string, 
    type?: string, 
    failed_actions: WriteActionFailures<T>
}
isTypeEqual<z.infer<typeof WriteActionErrorSchema>, WriteActionError<any>>(true);

export type CombineWriteActionsWhereFiltersResponse<T extends Record<string, any>> = {status: 'ok', filter: WhereFilterDefinition<T> | undefined} | {status: 'error', error: {message: string, failed_actions: WriteActionFailures<T>}};

export type AppliedWritesOutput<T extends Record<string, any>> = { added: T[], updated: T[], deleted: T[], changed: boolean, final_items: T[] | Draft<T>[] }

export type AppliedWritesOutputResponse<T extends Record<string, any>> = {
    status: 'ok',
    changes: AppliedWritesOutput<T>,
    successful_actions: WriteActionSuccesses<T>,
} | {
    status: 'error', 
    changes: AppliedWritesOutput<T>,
    successful_actions: WriteActionSuccesses<T>,
    error:  WriteActionError<T>
}
