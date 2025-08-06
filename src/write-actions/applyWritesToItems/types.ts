import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, DotPropPathsUnionScalarArraySpreadingObjectArrays, DotPropPathsUnionScalarSpreadingObjectArrays, PrimaryKeyProperties } from "../../dot-prop-paths/types.js";
import type { PrimaryKeyValue } from "../../utils/getKeyValue.js";
import type { IfAny } from "../../types.js";
import type { EnsureRecord } from "../../types.js";
import type {  SuccessfulWriteAction, WriteActionPayloadCreate, WriteActionPayloadUpdate, WriteActionsResponseError, WriteActionsResponseOk } from "../types.js";
import { z } from "zod";
import { isTypeEqual } from "@andyrmitchell/utils";
import type { ObjectsDelta } from "../../objects-delta/types.ts";


export type ItemHash<T> = Record<PrimaryKeyValue, T>;



export interface WriteStrategy<T extends Record<string, any>> {
    create_handler: (writeActionPayload: WriteActionPayloadCreate<T>) => T;
    update_handler: (writeActionPayload: WriteActionPayloadUpdate<T>, target: T) => T
}


export type ApplyWritesToItemsOptions<T extends Record<string, any> = Record<string, any>> = {
  
    /**
     * Define what will happen if the create action has the same ID as an existing item
     * - 'never': [default] the create will fail
     * - 'if-identical': the create will only succeed if the existing item has the same properties as the new one
     * - 'always': the created item will always succeed, effectively updating the existing item with the new properties
     */
    attempt_recover_duplicate_create?: 'never' | 'if-identical' | 'always-update',


        
    /** 
     * Either all actions occur, or none (i.e. if 1 fails, they all fail). 
     * 
     * Aka the actions are a transaction block
     * 
     * @default false
     */
    atomic?: boolean

    /** 
     * Mutate in-place instead of cloning the array/objects when they update.
     * 
     * The most likely reason to do this is because you're passing an Immer draft, which needs the same array returning. 
     * 
     * **When mutating, referential comparison works for**: 
     * - ✅ Using Immer Drafts for `items` (because the draft resolves to new objects) 
     * - ❌ Everything else fails, because objects have the same reference even when changed 
     * 
     * @default false
     */
    mutate?: boolean
}


export type ListOrdering<T extends Record<string, any> = Record<string, any>> = {
    order_by_key: IfAny<T, string, PrimaryKeyProperties<T>>,
    direction: 'asc' | 'desc'
}

type ListRulesCore<T extends Record<string, any> = Record<string, any>> = {
    /**
     * The main identifier
     */
    primary_key: IfAny<T, string, PrimaryKeyProperties<T>>,// keyof T>,

    /**
     * Give guidance to what it can sort by. 
     * 
     * It can be used by store implementations to ensure consistent item/pagination order.
     * 
     */
    order_by?: ListOrdering<T>,

    pre_triggers?: {
        trigger: (replacement: T, existing?: T) => T // Throws an error if expect halt
    }[],
    write_strategy?: 
        { type: 'lww' } // This is a naive implementation that assumes WriteActions are applied in the correct order. A more robust solution would be to compare timestamps for each dot-prop path.
        | 
        { type: 'custom', strategy: WriteStrategy<T> },
    growset?: {
        delete_key: keyof T
    }
}

const PermissionIdFormatSchema = z.union([z.literal('uuid'), z.literal('email')]);
export const DDLPermissionPropertySchema = z.union([
    z.object({
        property_type: z.literal('id'),
        path: z.string(),
        format: PermissionIdFormatSchema
    }),
    z.object({
        property_type: z.literal('id_in_scalar_array'),
        path: z.string(),
        format: PermissionIdFormatSchema
    })
])
export const DDLPermissionsSchema = z.union([
    z.object({
        type: z.literal('basic_ownership_property')
    }).and(DDLPermissionPropertySchema),
    z.object({
        type: z.literal('none') 
    }),
    z.object({
        type: z.literal('opa') // TODO
    })
])

type PermissionIdFormat = 'uuid' | 'email';
export type DDLPermissionProperty<T extends Record<string, any> = Record<string, any>> = 
    {
        property_type: 'id',
        path: DotPropPathsUnionScalarSpreadingObjectArrays<T>,
        format: PermissionIdFormat,
        /**
         * The person who will become the new owner, if they accept it. 
         * 
         * Beware this currently gives complete editing power to this person (as well as the existing owner). You'll need to manually add additional controls to limit the changes they can make, or limit the duration.
         */
        transferring_to_path?: DotPropPathsUnionScalarSpreadingObjectArrays<T>,
    } | {
        property_type: 'id_in_scalar_array',
        path: DotPropPathsUnionScalarArraySpreadingObjectArrays<T>, 
        format: PermissionIdFormat
    }
export type DDLPermissions<T extends Record<string, any> = Record<string, any>> = 
    {
        /**
         * Only an owner can make changes to the object. 
         * 
         * This is a very basic implementation with no granularity. 
         * 
         * For more granularity, consider using/implementing OPA. Or provide a manual solution outside the scope of this package (e.g. if the item is stored in Postgres, handle it like normal DB permissions)
         */
        type: 'basic_ownership_property',
    } & DDLPermissionProperty<T>
    | {
        /**
         * Anyone can make changes 
         */
        type: 'none'
    }
    /* | {
        type: 'opa',
        wasm_path: string, // https://stackoverflow.com/questions/49611290/using-webassembly-in-chrome-extension https://groups.google.com/a/chromium.org/g/chromium-extensions/c/zVaQo3jpSpw/m/932YZv2UAgAJ 
        on_error: (item: T, writeAction: WriteAction<T>) => T | void
    },*/
isTypeEqual<z.infer<typeof DDLPermissionPropertySchema>['property_type'], DDLPermissionProperty<any>['property_type']>(true);
isTypeEqual<z.infer<typeof PermissionIdFormatSchema>, PermissionIdFormat>(true);

type DDLRoot<T extends Record<string, any> = Record<string, any>> = {
    version: number,
    permissions: DDLPermissions<T>
}
export type ListRules<T extends Record<string, any> = Record<string, any>> = ListRulesCore<T>


export type DDL<T extends Record<string, any>> = 
    IfAny<
    T,
    {lists: {
        '.': ListRules<any>;
    }} & DDLRoot<T>,
    {lists: 
        {
            [K in DotPropPathToObjectArraySpreadingArrays<T>]: ListRules<EnsureRecord<DotPropPathValidArrayValue<T, K>>>
        } & {
            '.': ListRules<T>;
        }
     } & DDLRoot<T>
    >

    

//const b:DotPropPathsUnionScalar<{id: string, name: string, pet: {name: string}, children: {age: number, friends: {name: string}[]}[]}> = ''

/*
//const a:DDL<{id: string, name: string, pet: {name: string}}> = {
const a:DDL<any> = {
    version: 1,
    lists: {
        '.': {
            'primary_key': 'name'
        }
    }
}
const c:PrimaryKeyValue = a.lists['.'].primary_key
*/


/**
 * The changes to the original items passed to `applyWritesToItems`, after the actions are run. 
 */
export type ApplyWritesToItemsChanges<
    T extends Record<string, any>
    > = 
    ObjectsDelta<T> & { 
    changed: boolean, 

    /**
     * The final version of the input items, with all the changes
     */
    final_items: T[],

    /**
     * If true then `final_items` can be used for referential comparison (e.g. in React): 
     * - The array only changes if any items changed 
     * - If an item is modified, it'll replaced with a new object
     * 
     * It requires either `in_place_mutation` to be disabled, or Immer drafts to be used.
     */
    referential_comparison_ok: boolean,
}
/**
 * The response to `applyWritesToItems`
 */
export type ApplyWritesToItemsResponse<
    T extends Record<string, any>
    > = WriteActionsResponseOk & {
    changes: ApplyWritesToItemsChanges<T>,

    /**
     * This is a bit of a legacy thing. `WriteActionsResponseOk` does not include it. 
     * It's now considered redundant because it can only be a success if all actions are complete. 
     */
    successful_actions: SuccessfulWriteAction<T>[],

} | WriteActionsResponseError<T> & {
    changes: ApplyWritesToItemsChanges<T>
    

}
