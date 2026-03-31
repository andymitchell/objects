import type { PrimaryKeyValue } from "../../utils/getKeyValue.ts";
import type { WriteResult } from "../types.ts";
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
export type WriteToItemsArrayResult<T extends Record<string, any>, W extends Record<string, any> = T, WF extends Record<string, any> = T> = WriteResult<T, W, WF> & {
    changes: WriteToItemsArrayChanges<T>;
};
