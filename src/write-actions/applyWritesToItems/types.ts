import { DotPropPathToArraySpreadingArrays, DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, DotPropPathsRecord, DotPropPathsUnion, DotPropPathsUnionScalar, DotPropPathsUnionScalarArraySpreadingObjectArrays, DotPropPathsUnionScalarSpreadingObjectArrays, PrimaryKeyProperties, ScalarProperties } from "../../dot-prop-paths/types";
import { PrimaryKeyValue } from "../../utils/getKeyValue";
import { IfAny } from "../../types";
import { EnsureRecord } from "../../types";
import { AppliedWritesOutput, WriteAction, WriteActionPayloadCreate, WriteActionPayloadUpdate } from "../types";
import { z } from "zod";
import { isTypeEqual } from "@andyrmitchell/utils";


export type ItemHash<T> = Record<PrimaryKeyValue, T>;



export interface WriteStrategy<T extends Record<string, any>> {
    create_handler: (writeActionPayload: WriteActionPayloadCreate<T>) => T;
    update_handler: (writeActionPayload: WriteActionPayloadUpdate<T>, target: T) => T
}

export type ApplyWritesToItemsOptions<T extends Record<string, any>> = {
    allow_partial_success?: boolean,
    attempt_recover_duplicate_create?: boolean,
    in_place_mutation?: boolean  // Use for Immer
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
     * If this represents an API, you probably want to match the default ordering it uses.
     */
    default_order?: ListOrdering<T>,

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
export const DDLPermissionsSchema = z.union([
    z.object({
        type: z.literal('owner_id_property'),
        path: z.string(),
        format: PermissionIdFormatSchema
    }),
    z.object({
        type: z.literal('owner_id_in_scalar_array'),
        path: z.string(),
        format: PermissionIdFormatSchema
    })
])

type PermissionIdFormat = 'uuid' | 'email';
export type DDLPermissions<T extends Record<string, any> = Record<string, any>> = {
    type: 'owner_id_property',
    path: DotPropPathsUnionScalarSpreadingObjectArrays<T>,
    format: PermissionIdFormat
} | {
    type: 'owner_id_in_scalar_array',
    path: DotPropPathsUnionScalarArraySpreadingObjectArrays<T>, 
    format: PermissionIdFormat
}/* | {
        type: 'opa',
        wasm_path: string, // https://stackoverflow.com/questions/49611290/using-webassembly-in-chrome-extension https://groups.google.com/a/chromium.org/g/chromium-extensions/c/zVaQo3jpSpw/m/932YZv2UAgAJ 
        on_error: (item: T, writeAction: WriteAction<T>) => T | void
    },*/
isTypeEqual<z.infer<typeof DDLPermissionsSchema>['type'], DDLPermissions<any>['type']>(true);
isTypeEqual<z.infer<typeof PermissionIdFormatSchema>, PermissionIdFormat>(true);

type DDLRoot<T extends Record<string, any> = Record<string, any>> = {
    version: number,
    permissions?: DDLPermissions<T>
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