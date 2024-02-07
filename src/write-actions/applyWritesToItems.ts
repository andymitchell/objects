import { isEqual, merge } from "lodash-es";
import { AppliedWritesOutput, VALUE_TO_DELETE_KEY, WriteAction } from "./types";


import { setProperty } from "dot-prop";
import {DotPropPaths} from "../dot-prop-paths";
import { WhereFilter } from "../where-filter";
import safeKeyValue, { PrimaryKeyValue } from "../getKeyValue";


export default function applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>>, primaryKey: keyof T, accumulator?:AppliedWritesOutput<T>): AppliedWritesOutput<T> {
    // Avoid any risk of unexpected mutation:
    //items = cloneDeep(items); // Taken away because it slows the function down by 30%. Just toughen up and don't mess it up. 
    
    type ItemHash = Record<PrimaryKeyValue, T>;
    const addedHash: ItemHash = {};
    const updatedHash: ItemHash = {};
    const deletedHash: ItemHash = {};
    
    if( accumulator ) {
        // Build on existing changes
        const io:[T[], ItemHash][] = [
            [accumulator.added, addedHash],
            [accumulator.updated, updatedHash],
            [accumulator.deleted, deletedHash]
        ];
        io.forEach(transform => {
            const items = transform[0];
            const itemHash = transform[1];
            for( const item of items ) itemHash[safeKeyValue(item[primaryKey])] = item;
        })
    }
    

    // Apply all the Creates
    const existingIds = new Set(items.map(item => safeKeyValue(item[primaryKey])));
    for (const action of writeActions) {
        if (action.payload.type === 'create') {
            const pk = safeKeyValue(action.payload.data[primaryKey]);
            if( !existingIds.has(pk) ) {
                addedHash[pk] = action.payload.data;
            } else {
                console.warn("applyWriteItems: Tried to create an object with an ID that already exists.");
            }
        }
    }

    // When given many write actions, they might update a newly created one, so it must be addressable 
    const itemsIncNewToUpdate:ReadonlyArray<Readonly<T>> = [...items, ...Object.values(addedHash)];
    
    // Now go through items and update with each write action  
    let final:T[] = [];
    for( const item of itemsIncNewToUpdate ) {
        const pk = safeKeyValue(item[primaryKey]);

        let mutableUpdatedItem:T | undefined;
        let deleted = !!deletedHash[pk];
        for (const action of writeActions) {
            if( deleted ) break;
            if (action.payload.type === 'update' || action.payload.type === 'array_push' ) {
                if (WhereFilter.matchJavascriptObject(item, action.payload.where)) {
                    if( !mutableUpdatedItem ) {
                        mutableUpdatedItem = structuredClone(item);
                    }

                    if( action.payload.type === 'update' ) {
                        if( action.payload.method === 'merge' ) {
                            merge(mutableUpdatedItem, action.payload.data) // MUTATION
                        } else {
                            Object.assign(mutableUpdatedItem, action.payload.data); // MUTATION
                        }
                        deleteUnwantedKeysFromDestination<T>(action.payload.data, mutableUpdatedItem, VALUE_TO_DELETE_KEY);
                    } else if( action.payload.type === 'array_push' ) {
                        let existingArray = DotPropPaths.getProperty(mutableUpdatedItem, action.payload.path) as unknown as unknown[] | undefined;
                        if( existingArray===undefined ) existingArray = [];
                        if( !Array.isArray(existingArray) ) throw new Error("existingArray wasn't an array");
                        existingArray.push(action.payload.value);
                        setProperty(mutableUpdatedItem, action.payload.path, existingArray);
                    }
                }

            } else if( action.payload.type==='delete' ) {
                if (WhereFilter.matchJavascriptObject(item, action.payload.where)) {
                    deleted = true;
                    deletedHash[pk] = item;
                }
            }
        }
        if( mutableUpdatedItem && !deleted ) {
            if( !isEqual(mutableUpdatedItem, item) ) {
                if( addedHash[pk] ) {
                    addedHash[pk] = mutableUpdatedItem;
                } else {
                    updatedHash[pk] = mutableUpdatedItem;
                }
            }
        }
        if( !deleted ) {
            final.push(mutableUpdatedItem ?? item);
        }
        if( item===mutableUpdatedItem ) throw new Error("Item has been made mutable. Not allowed.");
    }
    final = [...final, ...Object.values(addedHash)];

    const output:AppliedWritesOutput<T> = {added: Object.values(addedHash), updated: Object.values(updatedHash), deleted: Object.values(deletedHash), final_items: final};

    return output;
}

/*
Key Deletion (#VALUE_TO_DELETE_KEY)

We need a way to stipulate that a key should be deleted. The problems are: 
- Lodash's merge will ignore 'undefined' values in the source (aka the updater), even if they're explicit
- TypeScript won't allow values to become 'null' 

The solution is deleteUnwantedKeysFromDestination... It recurses the keys of the source, and if it has an explicit undefined/null value, it removes it from the final object (aka destination). 

The choice to use undefined or null is set in types: VALUE_TO_DELETE_KEY 
- If you choose null, you'll have to update the WriteActionPayloadUpdate type to allow a Nullable T 

A totally different approach: 
- Create a new WriteAction just to delete keys explicitly. 

Remember a client doesn't want to get into the internals here. They reasonably expect:
- Setting something to undefined will delete it
- Setting something to null would stay as null (but this is the convention Firebase uses for delete, so they might expect it)

*/

function deleteUnwantedKeysFromDestination<T extends {}>(src: Readonly<Partial<T>>, dest: Partial<T>, valueToDeleteKey: undefined | null): void {
    const keys = Object.keys(src) as Array<keyof T>;
    keys.forEach(key => {
        const srcValue = src[key];
        const destValue = dest[key];
        if (srcValue && typeof srcValue === 'object' && destValue) {
            if( !(key in dest) ) {
                throw new Error("Destination should include all source keys - i.e. they should have already merged.");
            }
            deleteUnwantedKeysFromDestination(srcValue as Readonly<T>, destValue, valueToDeleteKey);
        } else if (src[key] === valueToDeleteKey) {
            // Delete the key 
            delete dest[key];
        }
    });
}