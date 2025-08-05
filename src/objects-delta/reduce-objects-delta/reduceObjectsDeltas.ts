
import { sortCompositeTimestamp } from '@andyrmitchell/composite-timestamps';
import { isObjectsDeltaFast, type ObjectsDelta, type ObjectsDeltaApplicable } from '../types.ts';
import {  type PrimaryKeyGetter, type PrimaryKeyValue } from '../../utils/getKeyValue.ts';



export function reduceObjectsDeltas<T extends Record<string, any>>( 
    deltas: ObjectsDelta<T>[], 
    pk: PrimaryKeyGetter<T> 
): ObjectsDelta<T>; 

// Overload for when all deltas are of type ObjectsDeltaApplicable<T> 
export function reduceObjectsDeltas<T extends Record<string, any>>( 
    deltas: ObjectsDeltaApplicable<T>[], 
    pk: PrimaryKeyGetter<T> 
): ObjectsDeltaApplicable<T>; 

/**
 * Reduces an array of object deltas into a single, functionally equivalent delta.
 * The function applies deltas in chronological order, with the last write winning.
 *
 * @param deltas An array of ObjectsDelta or ObjectsDeltaApplicable objects.
 * @returns A single reduced ObjectsDelta or ObjectsDeltaApplicable.
 */
export function reduceObjectsDeltas<T extends Record<string, any>>(
    deltas: (ObjectsDelta<T> | ObjectsDeltaApplicable<T>)[],
    pk: PrimaryKeyGetter<T>
): ObjectsDelta<T> | ObjectsDeltaApplicable<T> {
    // #### Handle Edge Cases
    if (!deltas || deltas.length === 0) {
        return {created_at: Date.now()};
    }

    // #### Sort Deltas Chronologically
    const sortedDeltas = [...deltas].sort((a, b) =>
        sortCompositeTimestamp(a.created_at!, b.created_at!)
    );


    if (deltas.length === 1) {
        const singleDelta = sortedDeltas[0]!;
        // Normalize to ObjectsDelta if it has the required properties
        validateInternalConsistency(singleDelta, pk);
        if (isObjectsDeltaFast(singleDelta)) {
            return {
                insert: singleDelta.insert || [],
                update: singleDelta.update || [],
                remove_keys: singleDelta.remove_keys || [],
                created_at: singleDelta.created_at!,
            };
        }
        return { ...singleDelta };
    }

    // #### Initialize Type Tracking
    let inputType: 'ObjectDelta' | 'ObjectDeltaApplicable' | 'mixed' = isObjectsDeltaFast(sortedDeltas[0]!)? 'ObjectDelta' : 'ObjectDeltaApplicable';

    // #### Initialize Reduction State
    const insertMap = new Map<PrimaryKeyValue, T>();
    const updateMap = new Map<PrimaryKeyValue, T>();
    const upsertMap = new Map<PrimaryKeyValue, T>();
    const removedKeys = new Set<PrimaryKeyValue>();

    // Build the final state in a Map for efficient key-based operations.
    const finalItemsMap = new Map<PrimaryKeyValue, T>();

    // #### Iterate and Process Sorted Deltas
    for (const delta of sortedDeltas) {
        
        const isApplicable = !isObjectsDeltaFast(delta);
        if (inputType === 'ObjectDelta' && isApplicable) {
            inputType = 'mixed';
        } else if (inputType === 'ObjectDeltaApplicable' && !isApplicable) {
            inputType = 'mixed';
        } else if (sortedDeltas.indexOf(delta) === 0) {
            inputType = isApplicable ? 'ObjectDeltaApplicable' : 'ObjectDelta';
        }


        // Step 1: Internal Validation
        validateInternalConsistency(delta, pk);

        // Step 2: Process Removals
        for (const key of (delta.remove_keys || [])) {
            removedKeys.add(key);
            insertMap.delete(key);
            updateMap.delete(key);
            upsertMap.delete(key);
        }

        // Step 3: Process Inserts
        for (const obj of (delta.insert || [])) {
            const key = pk(obj);
            finalItemsMap.set(key, obj);
            if (!insertMap.has(key) && !updateMap.has(key) && !upsertMap.has(key)) {
                if (removedKeys.has(key)) {
                    // This insert happened after a remove, so it's a valid re-insertion.
                    removedKeys.delete(key);
                }
                insertMap.set(key, obj);
            }
        }

        // Step 4: Process Updates
        for (const obj of (delta.update || [])) {
            const key = pk(obj);
            finalItemsMap.set(key, obj);
            if (removedKeys.has(key)) {
                // If key is in removedKeys, it's a no-op as specified.
            } else if( upsertMap.has(key) ) {
                // If key is in upsertMap, that takes precedence. It's a no-op.
            } else {
                updateMap.set(key, obj);
            }
        }

        // Step 5: Process Upserts (if applicable)
        if ('upsert' in delta && delta.upsert) {
            for (const obj of delta.upsert) {
                const key = pk(obj);
                finalItemsMap.set(key, obj);
                removedKeys.delete(key); // An upsert always negates a prior removal
                insertMap.delete(key);
                updateMap.delete(key);
                upsertMap.set(key, obj);
            }
        }
    }

    // #### Construct the Final Result Object
    const canSupportUpsert = inputType !== 'ObjectDelta';

    if (canSupportUpsert) {
        // Consolidate insert/update into upsert where applicable
        for (const [key, value] of updateMap.entries()) {
            if (insertMap.has(key)) {
                upsertMap.set(key, value); // Prefer the updated value
                insertMap.delete(key);
                updateMap.delete(key);
            }
        }
    } else {
        if( upsertMap.size>0 ) {
            throw new Error("No op. If upserts detected then canSupportUpsert should be true");
        }    
    }


    const finalCreatedAt = sortedDeltas[sortedDeltas.length - 1]!.created_at!;
    // Mutate the items map to use the latest version of an object. This is a fail safe. 
    applyFinalItems(insertMap, finalItemsMap);
    applyFinalItems(updateMap, finalItemsMap);
    applyFinalItems(upsertMap, finalItemsMap);

    if (inputType === 'ObjectDelta') {
        const result:ObjectsDelta<T> = {
            insert: Array.from(insertMap.values()),
            update: Array.from(updateMap.values()),
            remove_keys: Array.from(removedKeys.values()),
            created_at: finalCreatedAt,
        };
        return result;
    } else {
        const result: ObjectsDeltaApplicable<T> = { created_at: finalCreatedAt };
        if (insertMap.size > 0) result.insert = Array.from(insertMap.values());
        if (updateMap.size > 0) result.update = Array.from(updateMap.values());
        if (upsertMap.size > 0) result.upsert = Array.from(upsertMap.values());
        if (removedKeys.size > 0) result.remove_keys = Array.from(removedKeys.values());

        return result;
    }

    
}

/**
 * Mutate a target map (e.g. `insertMap`) to use the latest seen version of an object. 
 * 
 * This is because of a scenario like: 
 * - There's an upsert then an update, but the update is skipped as upsert takes precedence, but it still needs the latest object 
 * 
 * @param targetMap 
 * @param finalItemsMap 
 */
function applyFinalItems<T extends Record<string, any> = Record<string, any>>(targetMap:Map<PrimaryKeyValue, T>, finalItemsMap:Map<PrimaryKeyValue, T>) {
    const keys = targetMap.keys();
    for( const key of keys ) {
        const item = finalItemsMap.get(key);
        if( !item ) throw new Error("finalItemsMap should always include all modified items in insert/update/upsert");
        targetMap.set(key, item);
    }
}

/**
 * Check the rules of a single delta.
 * 
 * The rules:
 * - If removing a key, it cannot also be modified in anyway 
 * 
 * @param delta 
 * @param pk 
 */
function validateInternalConsistency<T extends Record<string, any> = Record<string, any>>(delta: ObjectsDelta<T> | ObjectsDeltaApplicable<T>, pk: PrimaryKeyGetter<T>) {
    const modifyingKeys = new Set<PrimaryKeyValue>();
    (delta.insert || []).forEach(obj => modifyingKeys.add(pk(obj)));
    (delta.update || []).forEach(obj => modifyingKeys.add(pk(obj)));
    if ('upsert' in delta) {
        (delta.upsert || []).forEach(obj => modifyingKeys.add(pk(obj)));
    }
    for (const key of (delta.remove_keys || [])) {
        if (modifyingKeys.has(key)) {
            throw new Error(`Unresolvable conflict in delta created at ${delta.created_at}: Key ${key} is present in both a modification list (insert/update/upsert) and remove_keys.`);
        }
    }
}