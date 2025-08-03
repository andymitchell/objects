import type { ObjectsDelta, ObjectsDeltaUsingRemovedKeys } from "../objects-delta/types.ts"

/**
 * Represents a set of state changes to be applied to a collection of objects.
 * It defines the desired end state for certain items (added or updated) and which items to remove.
 * 
 * @note A `ChangeSet` is distinct from a `WriteAction`. While a `WriteAction` provides explicit instructions
 * on how to *modify* data (e.g., "increment this value"), a `ChangeSet` simply provides the final
 * state of the objects that have been added or changed. This makes it ideal for scenarios where
 * the system receives a batch of the most current data from a source and needs to synchronize its
 * local state to match, without needing to know the specific operations that led to the new state.
 * 
 * @see {applyChangeSet} To apply this change set to an array of objects.
 * @see {WriteAction} For a more granular, operation-based approach to data modification.
 */
export type ChangeSet<T extends Record<string, any> = Record<string, any>> = 
ObjectsDelta<T> | 
ObjectsDeltaUsingRemovedKeys<T>

type ModifiedAt = {modified_at:number};

/**
 * Represents a set of state changes to be applied to a collection of objects, along with the timestamp
 * for when the instruction was created (or executed if you prefer).
 * 
 * It's just `ChangeSet` with `{modified_at: number}` attached. 
 */
export type ChangeSetWithModifiedAt<T extends Record<string, any> = Record<string, any>> = 
(ObjectsDelta<T> & ModifiedAt) | 
(ObjectsDeltaUsingRemovedKeys<T> & ModifiedAt)