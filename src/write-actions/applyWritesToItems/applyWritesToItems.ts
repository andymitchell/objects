import { isEqual, isMatch } from "lodash-es";
import { AppliedWritesOutput, AppliedWritesOutputResponse, WriteAction,  WriteActionFailures,  WriteActionFailuresErrorDetails,  isUpdateOrDeleteWriteActionPayload } from "../types";
import { setProperty } from "dot-prop";
import { WhereFilter } from "../../where-filter";
import safeKeyValue, { PrimaryKeyValue } from "../../getKeyValue";
import { ApplyWritesToItemsOptions, DDL, ItemHash, ListRules, WriteStrategy } from "./types";
import applyAccumulatorToHashes from "./helpers/applyAccumulatorToHashes";
import convertWriteActionToGrowSetSafe from "./helpers/convertWriteActionToGrowSetSafe";
import writeLww from "./writeStrategies/lww";
import getArrayScopeItemActions from "./helpers/getArrayScopeItemActions";
import { z } from "zod";
import WriteActionFailuresTracker from "./helpers/WriteActionFailuresTracker";
import equivalentCreateOccurs from "./helpers/equivalentCreateOccurs";





function getMutableItem<T extends Record<string, any>>(item:T, index: number, undoable?: UndoableArrayMutation<T>):T {
    if( undoable ) undoable.update(index, item);
    const clone = structuredClone(item) as T;
    return clone;
}

class UndoableArrayMutation<T extends Record<string, any>> {
    private actions:Array<{type: 'add', index: number} | {type: 'delete', index:number, original: T} | {type: 'mutate', index: number, original: T}>;
    constructor() {
        this.actions = [];
    }

    delete(index:number, original: T) {
        this.actions.push({type: 'delete', index, original});
    }
    update(index:number, original: T) {
        this.actions.push({type: 'mutate', index, original});
    }
    add(index:number) {
        this.actions.push({type: 'add', index});
    }
    restore(items:T[]) {
        const actions = this.actions.reverse();
        for( const action of actions ) {
            if( action.type==='mutate' ) {
                items[action.index] = action.original;
            } else if( action.type==='delete' ) {
                items.splice(action.index, 0, action.original);
            } else if( action.type==='add' ) {
                items.splice(action.index, 1);
            }
        }
    }
}


export default function applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>>, schema: z.ZodType<T, any, any>, ddl: DDL<T>, options?: ApplyWritesToItemsOptions<T>): AppliedWritesOutputResponse<T> {

    
    // Load the rules
    const rules:ListRules<T> | undefined = ddl['.'];

    const addedHash: ItemHash<T> = {};
    const updatedHash: ItemHash<T> = {};
    const deletedHash: ItemHash<T> = {};
    

    if (options?.accumulator) {
        applyAccumulatorToHashes<T>(options.accumulator, rules.primary_key, addedHash, updatedHash, deletedHash);
    }

    const undoable = options?.immer_optimized? new UndoableArrayMutation<T>() : undefined;
    const mutableItems = options?.immer_optimized? items as T[] : [...items];
    if( writeActions.length ) {


        // Track schema issues
        // #fail_continues: the higher up ideally wants to know every action that fails (so a it can mark them as unrecoverable in one hit), and every item that'll fail as a consequence (because if it applied optimistic updates, it needs to roll them back)
        const failureTracker = new WriteActionFailuresTracker<T>(schema, rules);

        // Choose the strategy
        let writeStrategy: WriteStrategy<T>;
        switch(rules.write_strategy?.type ) {
            case 'custom':
                writeStrategy = rules.write_strategy.strategy
                break;
            default: 
                writeStrategy = writeLww as WriteStrategy<T>
        }

        // Apply all the Creates
        const existingIds = new Set(new Set(items.map(item => safeKeyValue(item[rules.primary_key]))));
        for (const action of writeActions) {
            if (action.payload.type === 'create') {
                const pk = safeKeyValue(action.payload.data[rules.primary_key], true);
                if( pk ) {
                    if (existingIds.has(pk)) {
                        if( options?.attempt_recover_duplicate_create ) {
                            // Recovery = at any point, does the item, with updates applied, match the create payload? If so, skip this create but don't generate an error.
                            const existing = items.find(x => pk===safeKeyValue(x[rules.primary_key]));
                            if( existing && equivalentCreateOccurs<T>(schema, ddl, existing, action, writeActions) ) {
                                // Skip it -> it already exists and matches (or will match, with updates in writeActions) the desired create 
                            } else {
                                failureTracker.report(action, action.payload.data, {type: 'create_duplicated_key', primary_key: rules.primary_key});
                            }
                        } else {
                            failureTracker.report(action, action.payload.data, {type: 'create_duplicated_key', primary_key: rules.primary_key});
                        }
                    } else {
                        // TODO Check permissions
                        const newItem = writeStrategy.create_handler(action.payload);
                    
                        // TODO Run pretriggers

                        const schemaOk = failureTracker.testSchema(action, newItem);
                        if( schemaOk ) {
                            existingIds.add(pk);
                            addedHash[pk] = newItem;
                            undoable?.add(mutableItems.length);
                            mutableItems.push(newItem);
                            if( deletedHash[pk] ) delete deletedHash[pk];
                        } // #fail_continues
                    
                    }
                } else {
                    failureTracker.report(action, action.payload.data, {type: 'missing_key', primary_key: rules.primary_key});
                }
            }
        }

        // When given many write actions, they might update a newly created one, so it must be addressable 
        //const itemsIncNewToUpdate: ReadonlyArray<Readonly<T>> = [...items, ...Object.values(addedHash).filter(item => !initialExistingIds.has(safeKeyValue(item[rules.primary_key])))];
        
        

        // Now go through items and update with each write action  
        let undoableIndex = 0;
        for( let i = 0; i < mutableItems.length; i++ ) {
            undoableIndex++;
            const item = mutableItems[i];
            const pk = safeKeyValue(item[rules.primary_key]);

            let mutableUpdatedItem: T | undefined;
            let deleted = !!deletedHash[pk];
            for (const action of writeActions) {
                if (deleted) break;
                if (
                    isUpdateOrDeleteWriteActionPayload<T>(action.payload) && 
                    (action.payload.type==='array_scope' || WhereFilter.matchJavascriptObject(item, action.payload.where))
                    ) {
                    // TODO Check permissions

                    // Check if it's a grow set (otherwise just do the action)
                    const maybeExpandedWriteActions = convertWriteActionToGrowSetSafe(action, item, rules);
                    
                    for (const action of maybeExpandedWriteActions) {
                        switch (action.payload.type) {
                            case 'update':
                                if (!mutableUpdatedItem) {
                                    mutableUpdatedItem = getMutableItem(item, i, undoable);
                                }

                                const unvalidatedMutableUpdatedItem = writeStrategy.update_handler(action.payload, mutableUpdatedItem);
                                const schemaOk = failureTracker.testSchema(action, unvalidatedMutableUpdatedItem); 
                                if( schemaOk ) {

                                    // An update is not allowed to change the primary key 
                                    if( safeKeyValue(mutableUpdatedItem[rules.primary_key])===pk ) {
                                        mutableUpdatedItem = unvalidatedMutableUpdatedItem; // Default lww handler has just mutated mutableUpdatedItem (no new object), because options.immer_optimized decides whether to have cloned it originally or be editing an existing object (e.g. for Immer efficiency)
                                    } else {
                                        failureTracker.report(action, item, {
                                            'type': 'update_altered_key',
                                            primary_key: rules.primary_key
                                        })
                                    }
                                    

                                    
                                } // #fail_continues


                                break;
                            case 'array_scope':
                                if (!mutableUpdatedItem) {
                                    mutableUpdatedItem = getMutableItem(item, i, undoable);
                                }
                                // Get all arrays that match the scope, then recurse into applyWritesToItems for them
                                const scopedArrays = getArrayScopeItemActions<T>(item, action.payload, schema, ddl);

                                for( const scopedArray of scopedArrays ) {
                                    const arrayResponse = applyWritesToItems(scopedArray.writeActions, scopedArray.items, scopedArray.schema, scopedArray.ddl);
                                    if( arrayResponse.status!=='ok' ) {
                                        if( arrayResponse.error.type==='schema_failure' ) {
                                            failureTracker.mergeUnderAction(action, arrayResponse.error.failed_actions);
                                        }
                                        return arrayResponse;
                                    }
                                    setProperty(
                                        mutableUpdatedItem,
                                        scopedArray.path,
                                        arrayResponse.changes.final_items
                                    )
                                }

                                break;
                            case 'delete':
                                deleted = true;
                                deletedHash[pk] = item;
                                if( addedHash[pk] ) delete addedHash[pk];
                                if( updatedHash[pk] ) delete updatedHash[pk];
                                break;
                        }
                    }



                }
            }
            if (deleted) {
                undoable?.delete(i, mutableItems[i]);
                mutableItems.splice(i, 1);
                i--;
            } else if( mutableUpdatedItem ) {
                // TODO Run pretriggers
                if (addedHash[pk]) {
                    addedHash[pk] = mutableUpdatedItem;
                } else {
                    updatedHash[pk] = mutableUpdatedItem;
                }
                mutableItems[i] = mutableUpdatedItem
            }
        }

        if( failureTracker.length()>0 ) {
            if( options?.immer_optimized ) {
                // Restore the mutableItems to their state pre any changes, in an Immer compatible way 
                undoable!.restore(mutableItems);
            }
            return {
                status: 'error',
                error: {
                    type: 'write_action_fail',
                    message: "Some write actions failed.",
                    failed_actions: failureTracker.get()
                }
            }
        }
    }

    
    const changes: AppliedWritesOutput<T> = { added: Object.values(addedHash), updated: Object.values(updatedHash), deleted: Object.values(deletedHash), changed: false, final_items: mutableItems };
    const newChange = !!(changes.added.length || changes.updated.length || changes.deleted.length);
    changes.changed = newChange || !!options?.accumulator?.changed;
    if( !newChange ) {
        // Use the original array for shallow comparison to indicate no change 
        changes.final_items = items as T[];
    }
    

    

    return {status: 'ok', changes};
}


