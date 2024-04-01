import { isEqual } from "lodash-es";
import { AppliedWritesOutput, AppliedWritesOutputResponse, WriteAction,  WriteActionFailures,  WriteActionFailuresErrorDetails,  isUpdateOrDeleteWriteActionPayload } from "../types";
import { setProperty } from "dot-prop";
import { WhereFilter } from "../../where-filter";
import safeKeyValue from "../../getKeyValue";
import { DDL, ItemHash, ListRules, WriteStrategy } from "./types";
import applyAccumulatorToHashes from "./applyAccumulatorToHashes";
import convertWriteActionToGrowSetSafe from "./convertWriteActionToGrowSetSafe";
import writeLww from "./writeStrategies/lww";
import getScopedArrays from "./getScopedArrays";
import { z } from "zod";
import WriteActionFailuresTracker from "./WriteActionFailuresTracker";






export default function applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>>, schema: z.ZodType<T, any, any>, ddl: DDL<T>, accumulator?: AppliedWritesOutput<T>): AppliedWritesOutputResponse<T> {

    // Load the rules
    const rules:ListRules<T> | undefined = ddl['.'];

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

    const addedHash: ItemHash<T> = {};
    const updatedHash: ItemHash<T> = {};
    const deletedHash: ItemHash<T> = {};

    if (accumulator) {
        applyAccumulatorToHashes<T>(accumulator, rules.primary_key, addedHash, updatedHash, deletedHash);
    }


    // Apply all the Creates
    const existingIds = new Set(items.map(item => safeKeyValue(item[rules.primary_key])));
    for (const action of writeActions) {
        if (action.payload.type === 'create') {
            const pk = safeKeyValue(action.payload.data[rules.primary_key], true);
            // Allow missing pk, which will arise if the schema or DDL is wrong... we then want it to 
            if( pk ) {
                if (!existingIds.has(pk)) {
                    // TODO Check permissions
                    const createdResult = writeStrategy.create_handler(action.payload);
                    if (createdResult.created) {
                        // TODO Run pretriggers

                        const schemaOk = failureTracker.testSchema(action, createdResult.item);
                        if( schemaOk ) {
                            addedHash[pk] = createdResult.item;
                        } // #fail_continues
                    } else {
                        // TODO Handle or just ignore?
                    }
                } else {
                    console.warn("applyWriteItems: Tried to create an object with an ID that already exists.");
                }
            } else {
                failureTracker.report(action, action.payload.data, {type: 'missing_key', primary_key: rules.primary_key});
            }
        }
    }

    // When given many write actions, they might update a newly created one, so it must be addressable 
    const itemsIncNewToUpdate: ReadonlyArray<Readonly<T>> = [...items, ...Object.values(addedHash)];
    

    // Now go through items and update with each write action  
    let final: T[] = [];
    for (const item of itemsIncNewToUpdate) {
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
                                mutableUpdatedItem = structuredClone(item);
                            }

                            const unvalidatedMutableUpdatedItem = writeStrategy.update_handler(action.payload, mutableUpdatedItem, true).item;
                            const schemaOk = failureTracker.testSchema(action, unvalidatedMutableUpdatedItem); 
                            if( schemaOk ) {

                                // An update is not allowed to change the primary key 
                                if( safeKeyValue(mutableUpdatedItem[rules.primary_key])===pk ) {
                                    mutableUpdatedItem = unvalidatedMutableUpdatedItem;
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
                                mutableUpdatedItem = structuredClone(item);
                            }
                            // Get all arrays that match the scope, then recurse into applyWritesToItems for them
                            const scopedArrays = getScopedArrays<T>(item, action.payload, schema, ddl);

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
                            break;
                    }
                }



            }
        }
        if (mutableUpdatedItem && !deleted) {
            // TODO Run pretriggers
            if (!isEqual(mutableUpdatedItem, item)) {
                if (addedHash[pk]) {
                    addedHash[pk] = mutableUpdatedItem;
                } else {
                    updatedHash[pk] = mutableUpdatedItem;
                }
            }
        }
        if (!deleted) {
            final.push(mutableUpdatedItem ?? item);
        }
        if (item === mutableUpdatedItem) throw new Error("Item has been made mutable. Not allowed.");
    }
    final = [...final];

    const changes: AppliedWritesOutput<T> = { added: Object.values(addedHash), updated: Object.values(updatedHash), deleted: Object.values(deletedHash), final_items: final };

    if( failureTracker.length()>0 ) {
        return {
            status: 'error',
            error: {
                type: 'write_action_fail',
                message: "Some write actions failed.",
                failed_actions: failureTracker.get()
            }
        }
    }

    return {status: 'ok', changes};
}


