import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, PrimaryKeyProperties } from "../../dot-prop-paths/types.ts";
import type { PrimaryKeyValue } from "../../utils/getKeyValue.ts";
import type { IfAny } from "../../types.ts";
import type { EnsureRecord } from "../../types.ts";
import type { WriteResult } from "../types.ts";
import type { OwnershipRule } from "../../ownership/types.ts";
import type { ObjectsDelta } from "../../objects-delta/types.ts";


export type ItemHash<T> = Record<PrimaryKeyValue, T>;



export type WriteToItemsArrayOptions = {

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
     * Whether to enforce ownership checks on write actions.
     *
     * Set to `false` to bypass ownership verification (e.g. for admin operations).
     *
     * @default true
     */
    enforce_ownership?: boolean
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

type DDLRoot<T extends Record<string, any> = Record<string, any>> = {
    version: number,
    /** Declarative ownership hint — not necessarily enforced by every implementation. */
    ownership: OwnershipRule<T>
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
