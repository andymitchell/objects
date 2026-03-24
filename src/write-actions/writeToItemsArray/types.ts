import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, DotPropPathsUnionScalarArraySpreadingObjectArrays, DotPropPathsUnionScalarSpreadingObjectArrays, PrimaryKeyProperties } from "../../dot-prop-paths/types.ts";
import type { PrimaryKeyValue } from "../../utils/getKeyValue.ts";
import type { IfAny } from "../../types.ts";
import type { EnsureRecord } from "../../types.ts";
import type {  WritePayloadCreate, WritePayloadUpdate, WriteResult } from "../types.ts";
import { z } from "zod";
import { isTypeEqual } from "@andyrmitchell/utils";
import type { ObjectsDelta } from "../../objects-delta/types.ts";


export type ItemHash<T> = Record<PrimaryKeyValue, T>;



/**
 * Strategy for applying create/update payloads to items.
 *
 * `update_handler` MUST mutate `target` in-place — the caller owns the cloning
 * decision (via `getMutableItem`), so the handler always receives a safe-to-mutate object.
 */
export interface WriteStrategy<T extends Record<string, any>> {
    create_handler: (writeActionPayload: WritePayloadCreate<T>) => T;
    /** Mutate `target` in-place with the payload data. */
    update_handler: (writeActionPayload: WritePayloadUpdate<T>, target: T) => void
}


export type WriteToItemsArrayOptions<T extends Record<string, any> = Record<string, any>> = {
  
    /**
     * Conflict-resolution strategy when a `create` action targets a PK that already exists.
     *
     * - `'never'` **(default)** — fail immediately with `create_duplicated_key`.
     * - `'if-convergent'` — simulate applying the create payload **plus all subsequent
     *   actions in this batch**. At each step check whether the simulated item is a
     *   *subset* of the existing item (lodash `isMatch`, not strict equality). If the
     *   two paths converge at any point the create is silently skipped (no error).
     *   Otherwise the create fails with `create_duplicated_key`.
     *   **Why subset?** A create of `{id:'1'}` should not fail against an existing
     *   `{id:'1', text:'hello'}` — it doesn't contradict anything.
     * - `'always-update'` — convert the duplicate create into an update and continue.
     */
    attempt_recover_duplicate_create?: 'never' | 'if-convergent' | 'always-update',


        
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

    /**
     * Strategy for applying create/update payloads.
     *
     * - `'lww'` **(default)** — last-write-wins merge.
     * - `'custom'` — provide your own `WriteStrategy` handlers.
     */
    write_strategy?:
        { type: 'lww' }
        | { type: 'custom', strategy: WriteStrategy<T> }
}


/**
 * Rules for a single list scope within a DDL.
 *
 * **Ordering:** The DDL intentionally does not prescribe a default sort order.
 * Collections default to primary-key ordering. Callers control ordering
 * dynamically via `SortAndSlice` (from `@andyrmitchell/objects/query`).
 */
type ListRulesCore<T extends Record<string, any> = Record<string, any>> = {
    /**
     * The main identifier
     */
    primary_key: IfAny<T, string, PrimaryKeyProperties<T>>,// keyof T>,
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
 * Minimal changes base for any apply function. Future apply functions can extend this
 * without being forced to provide `final_items`.
 */
export type WriteChanges<T extends Record<string, any>> = ObjectsDelta<T> & {
    changed: boolean;
};

/**
 * The changes to the original items passed to `writeToItemsArray`, after the actions are run.
 */
export type WriteToItemsArrayChanges<T extends Record<string, any>> = WriteChanges<T> & {
    /** The final version of the input items, with all the changes applied. */
    final_items: T[];
};

/**
 * The response to `writeToItemsArray`. Extends `WriteResult` with `changes` always present.
 * No narrowing needed to access `changes` or `actions`.
 *
 * @example
 * result.changes.final_items // always accessible
 * if (!result.ok) getWriteFailures(result)[0].errors[0].type;
 */
export type WriteToItemsArrayResult<T extends Record<string, any>> = WriteResult<T> & {
    changes: WriteToItemsArrayChanges<T>;
};
