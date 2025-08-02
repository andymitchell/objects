import { isTypeEqual } from "@andyrmitchell/utils";
import type { PrimaryKeyValue } from "../utils/getKeyValue.ts";

/**
 * Represents the difference between two sets of objects.
 * 
 * @note Unlike a `ChangeSet`, which is an instruction for applying changes, an `ObjectsDelta`
 * is an **observation** of what has changed between two states — typically used
 * for diffing, or syncing logic.
 * 
 */
export type ObjectsDelta<T extends Record<string, any> = Record<string, any>> = {
    added: T[];
    updated: T[];
    removed: T[];
};



/**
 * Like `ObjectsDelta` but doesn't specify the deleted object (because it may not be available), only its primary key. 
 */
export type ObjectsDeltaUsingRemovedKeys<T extends Record<string, any> = Record<string, any>> = {
    added: T[];
    updated: T[];
    removed_keys: PrimaryKeyValue[]
}


isTypeEqual<Omit<ObjectsDelta<any>, 'removed'>, Omit<ObjectsDeltaUsingRemovedKeys<any>, 'removed_keys'>>(true);


/**
 * Options for configuring the differential tracker.
 */
export interface ObjectsDeltaTrackerOptions {
    /**
     * Determines the comparison method for detecting updated items.
     * - `true` (default): Performs a deep equality check. Best for objects where properties might change without the object reference changing.
     * - `false`: Performs a strict reference check (`===`). Much more efficient if item references are guaranteed to change when data changes (e.g., in a Redux-style immutable state management).
     * 
     * @default true
     */
    useDeepEqual?: boolean;
}

/**
 * A function where when you pass it an array of items, it computes the ObjectsDelta 
 * from the previous state.
 * 
 * @param newItems the new state
 * @returns A `ObjectsDelta` object showing what changed from the previous state, in format `{added:T[], updated: T[], removed:T[]}`
 */
export type ObjectsDeltaTracker<T extends Record<string, any> = Record<string, any>> = (newItems: T[]) => ObjectsDelta<T>;
