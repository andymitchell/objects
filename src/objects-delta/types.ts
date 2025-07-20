
export type ObjectsDelta<T extends Record<string, any> = Record<string, any>> = {
    added: T[];
    updated: T[];
    removed: T[];
};

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
