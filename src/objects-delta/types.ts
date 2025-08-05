import { isTypeExtended } from "@andyrmitchell/utils";
import type { PrimaryKeyValue } from "../utils/getKeyValue.ts";
import type { FlexibleTimestamp } from "@andyrmitchell/composite-timestamps";

/**
 * Represents the difference between two sets of objects.
 * 
 */
export interface ObjectsDelta<T extends Record<string, any> = Record<string, any>> {
    /**
     * Objects inserted to a set. 
     * 
     */
    insert: T[];

    /**
     * Objects updated in a set. 
     */
    update: T[];

    /**
     * Object primary keys removed from a set.
     * 
     * It uses keys because in some cases the object may have been destroyed.
     */
    remove_keys: PrimaryKeyValue[],

    /**
     * The time this delta was created.
     */
    created_at: FlexibleTimestamp
};

/**
 * A delta that is intended to be applied to an array of objects to make the changes (@see `applyDelta` as an example).
 * 
 */
export interface ObjectsDeltaApplicable<T extends Record<string, any> = Record<string, any>>  {

    /**
     * Objects to insert to the end of a set. 
     * 
     * If the object already exists in the target array, it will **not be updated**. Use `upsert` or `update` for that instead.
     * 
     * The reason is that it's possible the target was intentionally updated after the delta was created, and 
     * 'insert' is being understood strictly, and the caller would not expect it to overwrite the updated item. 
     * I.e. being strict with `insert` and `upsert` reduces ambiguity. 
     * 
     */
    insert?: T[];

    /**
     * Objects to update in a set. 
     * 
     * If an object does not exist in the target array, it's a no-op. 
     */
    update?: T[];

    /**
     * Objects to remove from a set.
     * 
     * It uses keys because in some cases the object may have been destroyed.
     */
    remove_keys?: PrimaryKeyValue[],

    /**
     * The time this delta was created.
     */
    created_at?: FlexibleTimestamp

    /**
     * Objects to `insert`  into the target array if they don't exist, or `update` if they do 
     */
    upsert?: T[]

};
isTypeExtended<Required<ObjectsDeltaApplicable>, ObjectsDelta>(true); // ObjectsDeltaApplicable does not `extend` to write better JSDoc, but it needs to maintain alignment with ObjectsDelta.

/**
 * A zod-free way to distinguish ObjectsDelta from ObjectsDeltaApplicable.
 * @param x 
 * @returns 
 */
export function isObjectsDeltaFast(x: ObjectsDelta | ObjectsDeltaApplicable): x is ObjectsDelta {
    return !("upsert" in x) && (['insert', 'update', 'remove_keys', 'created_at'].every(key => key in x));
}

/**
 * Options for configuring the differential tracker.
 */
export interface ObjectsArrayDifferOptions {
    /**
     * Determines the comparison method for detecting update items.
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
 * @returns A `ObjectsDelta` object showing what changed from the previous state, in format `{insert:T[], update: T[], removed:T[]}`
 */
export type ObjectsArrayDiffer<T extends Record<string, any> = Record<string, any>> = (newItems: T[]) => ObjectsDelta<T>;
