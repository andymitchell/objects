import { TypedCancelableEventEmitter } from "@andyrmitchell/utils/typed-cancelable-event-emitter";
import type { ObjectsArrayDiffer, ObjectsArrayDifferOptions, ObjectsDelta } from "./types.ts";
import { createObjectsArrayDiffer } from "./createObjectsArrayDiffer.ts";



type DeltaListener<T extends Record<string, any> = Record<string, any>> = (delta: ObjectsDelta<T>) => void;

type ObjectsDeltaEvents<T extends Record<string, any> = Record<string, any>> = {
    'UPDATE_DELTA': DeltaListener<T>
}

/**
 * 
 * Track changes to an array of items and emit an UPDATE_DELTA event containing the changes (as a `ObjectsDelta` object, containing {insert: [], update: [], removed: []})
 * 
 * 
 * @example 
 * 
 * type Task = {id: string};
 * const viewDeltaEmitter = new ObjectsDeltaEmitter<Task>('id', {useDeepEqual: false});
 * 
 * viewDeltaEmitter.on('UPDATE_DELTA', (event:ObjectsDelta<Task>) => {
 *  if( event.insert.length>0 ) {
 *      // Do something
 *  }
 * })
 * 
 * collection.subscribe({id: '1'}, (viewPage) => {
 *      viewDeltaEmitter.update(viewPage.items)
 * })
 * 
 */
export class ObjectsDeltaEmitter<T extends Record<string, any> = Record<string, any>> extends TypedCancelableEventEmitter<ObjectsDeltaEvents<T>> {


    private tracker: ObjectsArrayDiffer<T>;

    constructor(primaryKey: keyof T, options?: ObjectsArrayDifferOptions) {
        super();

        // Create an instance of the tracker for this emitter to use.
        this.tracker = createObjectsArrayDiffer<T>(primaryKey, options);
    }


    /**
     * Accepts a new set of items, uses the tracker to get the delta,
     * and emits the result to listeners if there are any changes.
     */
    public update(newItems: T[]): void {
        // Delegate the complex logic to the tracker function.
        const delta = this.tracker(newItems);

        // Only emit if there are actual changes.
        if (delta.insert.length > 0 || delta.update.length > 0 || delta.remove_keys.length > 0) {
            const safeDelta = structuredClone(delta);
            this.emit('UPDATE_DELTA', safeDelta);
        }
    }

}

