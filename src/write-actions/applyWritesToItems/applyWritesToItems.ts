
import type  {  WriteAction,  SuccessfulWriteAction } from "../types.js";
import {isUpdateOrDeleteWriteActionPayload} from '../types.js';
import { setProperty } from "dot-prop";
import { WhereFilter } from "../../where-filter/index-old.ts";
import safeKeyValue, { type PrimaryKeyGetter, makePrimaryKeyGetter } from "../../utils/getKeyValue.js";
import type { ApplyWritesToItemsChanges, ApplyWritesToItemsOptions, ApplyWritesToItemsResponse, DDL, ItemHash, ListRules, WriteStrategy } from "./types.js";
import convertWriteActionToGrowSetSafe from "./helpers/convertWriteActionToGrowSetSafe.js";
import writeLww from "./writeStrategies/lww.js";
import getArrayScopeItemAction from "./helpers/getArrayScopeItemAction.js";
import { z } from "zod";
import WriteActionFailuresTracker from "./helpers/WriteActionFailuresTracker.js";
import equivalentCreateOccurs from "./helpers/equivalentCreateOccurs.js";
import { type Draft, current, isDraft } from "immer";
import { type IUser } from "../auth/types.js";
import { checkPermission } from "./helpers/checkPermission.js";



function getMutableItem<T extends Record<string, any>>(item:T):T {
    // If immer draft it must be restored before cloned:
    if( isDraft(item) ) item = current(item);

    const clone = structuredClone(item) as T;
    return clone;
}


function getOptionDefaults<T extends Record<string, any>>():Required<ApplyWritesToItemsOptions<T>> {
    return {
        attempt_recover_duplicate_create: 'never',
        in_place_mutation: false,
        allow_partial_success: true
    }
}

class SuccessfulWriteActionesTracker<T extends Record<string, any>> {
    private pk:PrimaryKeyGetter<T>;
    private actionsMap:Record<string, SuccessfulWriteAction<T>>;
    constructor(primaryKey:keyof T) {
        this.pk = makePrimaryKeyGetter(primaryKey);
        this.actionsMap = {};
    }

    private findSuccessfulWriteAction(action:WriteAction<T>, createIfMissing?: boolean) {
        if( !this.actionsMap[action.uuid] && createIfMissing ) this.actionsMap[action.uuid] = {action, affected_items: []};
        return this.actionsMap[action.uuid]!;
    }

    report(action:WriteAction<T>, item: T) {
        const successfulAction = this.findSuccessfulWriteAction(action, true);
        const item_pk = this.pk(item, true);
        if( !successfulAction.affected_items ) successfulAction.affected_items = [];
        if( !successfulAction.affected_items.some(x => x.item_pk===item_pk) ) {
            successfulAction.affected_items.push({item_pk});
        }
    }

    get():SuccessfulWriteAction<T>[] {
        return JSON.parse(JSON.stringify(Object.values(this.actionsMap)));
    }
}

export default function applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>> | Draft<T>[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, user?: IUser, options?: ApplyWritesToItemsOptions<T>): ApplyWritesToItemsResponse<T> {
    return _applyWritesToItems(writeActions, items, schema, ddl, user, options);
}
function _applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>> | Draft<T>[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, user?: IUser, options?: ApplyWritesToItemsOptions<T>, scoped?:boolean): ApplyWritesToItemsResponse<T> {

    if( writeActions.length===0 ) {
        return {
            status: 'ok', 
            changes: emptyApplyWritesToItemsChanges(items),
            successful_actions: []
        };
    }
    
    const optionsIncDefaults:Required<ApplyWritesToItemsOptions<T>> = Object.assign(getOptionDefaults<T>(), options);
    if( console && "debug" in console && isDraft(items) && !optionsIncDefaults.in_place_mutation ) {
        // FYI Don't auto enable it, because there might be reasons they want to return a fresh array. 
        console.debug("applyWritesToItems has been passed an Immer draft. It's faster and more fitting to Immer's model to enable 'in_place_mutation'.");
    }
    
    // Load the rules
    const rules:ListRules<T> | undefined = ddl.lists['.'];
    const pk = makePrimaryKeyGetter<T>(rules.primary_key);

    const addedHash: ItemHash<T> = {};
    const updatedHash: ItemHash<T> = {};
    const deletedHash: ItemHash<T> = {};
    let wipItems = [...items] as T[];
    
    
    
    // Track successes, in part because higher up rollbacks want to know what items were affected by an action 
    const successTracker = new SuccessfulWriteActionesTracker<T>(rules.primary_key);

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

    const existingIds = new Set(wipItems.map(item => safeKeyValue(item[rules.primary_key])));

    // Now go through the actions 
    writeActions = [...writeActions];
    for( let index = 0; index < writeActions.length; index++ ) {
    //for( const action of writeActions ) {
        const action = writeActions[index]!;
        if( failureTracker.shouldHalt() ) break;

        

        if (action.payload.type === 'create') {
            const pkValue = pk(action.payload.data, true);
            if( pkValue ) {
                if (existingIds.has(pkValue)) {
                    if( optionsIncDefaults.attempt_recover_duplicate_create==='if-identical' ) {
                        // Recovery = at any point, does the item, with updates applied, match the create payload? If so, skip this create but don't generate an error.
                        const existing = wipItems.find((x)=> pkValue===pk(x));
                        if( existing && equivalentCreateOccurs<T>(schema, ddl, existing, action, writeActions) ) {
                            // Skip it -> it already exists and matches (or will match, with updates in writeActions) the desired create 
                        } else {
                            failureTracker.report(action, action.payload.data, {type: 'create_duplicated_key', primary_key: rules.primary_key});
                        }
                    } else if( optionsIncDefaults.attempt_recover_duplicate_create==='always-update' ) {
                        // Convert it into an update (for the next action), and skip this action
                        const data: T = {
                            ...action.payload.data
                        };
                        delete data[rules.primary_key];

                        const newUpdate:WriteAction<T> = {
                            ...action,
                            payload: {
                                type: 'update',
                                data,
                                where: {
                                    [rules.primary_key]: pkValue
                                }
                            }
                        }
                        
                        writeActions.splice(index+1, 0, newUpdate);
                    } else {
                        failureTracker.report(action, action.payload.data, {type: 'create_duplicated_key', primary_key: rules.primary_key});
                    }
                } else {
                    const permissionFailure = scoped? undefined : checkPermission(action.payload.data, ddl, user);
                    if( permissionFailure ) {
                        failureTracker.report(action, action.payload.data, permissionFailure);
                    } else {
                        const newItem = writeStrategy.create_handler(action.payload);
                    
                        // TODO Run pretriggers

                        const schemaOk = failureTracker.testSchema(action, newItem);
                        if( schemaOk ) {
                            existingIds.add(pkValue);
                            addedHash[pkValue] = newItem;
                            if( deletedHash[pkValue] ) delete deletedHash[pkValue];
                            successTracker.report(action, newItem);
                            //failureTracker.undoable()?.add(wipItems.length);
                            wipItems.push(newItem);
                        } // #fail_continues
                    }
                }
            } else {
                failureTracker.report(action, action.payload.data, {type: 'missing_key', primary_key: rules.primary_key});
            }
        } else {
            for( let i = 0; i < wipItems.length; i++) {
                if( failureTracker.shouldHalt() ) break;
                const item = wipItems[i];
                if( !item ) throw new Error(`Could not find item, suggesting wipItems has mutated such that i can't find it. Either it's a null entry, or the length has been shortened and i now extends it. Suggests bad logic in code. i: ${i}, length: ${wipItems.length}.`);
                const pkValue = pk(item);
                

                if ( !deletedHash[pkValue] && isUpdateOrDeleteWriteActionPayload<T>(action.payload) && (WhereFilter.matchJavascriptObject(item, action.payload.where)) ) {
                    const permissionFailure = scoped? undefined : checkPermission(item, ddl, user);
                    if( permissionFailure ) {
                        failureTracker.report(action, item, permissionFailure);
                    } else {
                        let mutableUpdatedItem: T | undefined;
                        let deleted = !!deletedHash[pkValue];

                        // Check if it's a grow set (otherwise just do the action)
                        const maybeExpandedWriteActions = convertWriteActionToGrowSetSafe(action, item, rules);
                        
                        for (const action of maybeExpandedWriteActions) {

                            if( failureTracker.shouldHalt() ) break;
                            switch (action.payload.type) {
                                case 'update':
                                    if (!mutableUpdatedItem) {
                                        mutableUpdatedItem = getMutableItem(item);
                                    }

                                    const unvalidatedMutableUpdatedItem = writeStrategy.update_handler(action.payload, mutableUpdatedItem);
                                    const schemaOk = failureTracker.testSchema(action, unvalidatedMutableUpdatedItem); 
                                    if( schemaOk ) {

                                        // An update is not allowed to change the primary key 
                                        if( pk(mutableUpdatedItem)===pkValue ) {
                                            mutableUpdatedItem = unvalidatedMutableUpdatedItem; // Default lww handler has just mutated mutableUpdatedItem (no new object), because options.in_place_mutation decides whether to have cloned it originally or be editing an existing object (e.g. for Immer efficiency)
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
                                        mutableUpdatedItem = getMutableItem(item);
                                    }
                                    // Get all arrays that match the scope, then recurse into applyWritesToItems for them
                                    const scopedArrays = getArrayScopeItemAction<T>(item, action, schema, ddl);

                                    for( const scopedArray of scopedArrays ) {
                                        const arrayResponse = _applyWritesToItems(
                                            [scopedArray.writeAction], 
                                            scopedArray.items, 
                                            scopedArray.schema, 
                                            scopedArray.ddl, 
                                            user,
                                            Object.assign({}, optionsIncDefaults, {in_place_mutation: false}),
                                            true
                                            );

                                        if( arrayResponse.status!=='ok' ) {
                                            arrayResponse.failed_actions;
                                            failureTracker.mergeUnderAction(action, arrayResponse.failed_actions);
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
                                    existingIds.delete(pkValue);
                                    break;
                            }
                        }

                        // Now actually commit the change
                        if( !failureTracker.shouldHalt() ) {
                            successTracker.report(action, item);
                            if (deleted) {
                                deletedHash[pkValue] = item;
                                if( addedHash[pkValue] ) delete addedHash[pkValue];
                                if( updatedHash[pkValue] ) delete updatedHash[pkValue];
                                wipItems.splice(i, 1);
                                i--;
                            } else if( mutableUpdatedItem ) {
                                // TODO Run pretriggers
                                if (addedHash[pkValue]) {
                                    addedHash[pkValue] = mutableUpdatedItem;
                                } else {
                                    updatedHash[pkValue] = mutableUpdatedItem;
                                }
                                wipItems[i] = mutableUpdatedItem
                            }
                        }
                    }
                }


                
            }
        }
    }


    
    if( failureTracker.length()>0 ) {
        // Mark every subsequent action after the failure as blocked 
        const failedActionUUID = failureTracker.get()[0]!.action.uuid;
        const index = writeActions.findIndex(x => x.uuid===failedActionUUID);
        if( index===-1 ) throw new Error("noop: the failed action should be known to the writeActions.");
        
        const actionsBlockedByFailure = writeActions.slice(index+1);
        actionsBlockedByFailure.forEach(action => failureTracker.blocked(action, failedActionUUID));


        let successful_actions: SuccessfulWriteAction<T>[] = [];
        let changes: ApplyWritesToItemsChanges<T>;
        if( optionsIncDefaults.allow_partial_success ) {
            // Thought: if addedHash/updatedHash/deletedHash/etc ends up reading ahead, it's still possible to generate the output by re-running applyWritesItems with just the actions in successTracker.get 
            changes = generateApplyWritesToItemsChanges(addedHash, updatedHash, deletedHash, items, pk, optionsIncDefaults);
            successful_actions = successTracker.get();
        } else {
            changes = emptyApplyWritesToItemsChanges(items);
        }

        // FUTURE IDEA: DETECT WHICH SUBSEQUENT ACTIONS WOULD STILL HAVE FAILED. Find out in one go what won't work (e.g. subsequent schema fails). Solution: take out the initial failing error, then run the remaining actions against the current mutableState, but passed in a recursive call in a way that it won't be mutated. Roll the returned failed actions into failureTracker, replacing any marked as blocked. 
        
        return {
            status: 'error',
            changes,
            successful_actions,
        
            //type: 'write_action_fail',
            message: "Some write actions failed.",
            failed_actions: failureTracker.get()
        
        }
    } else {
        return {
            status: 'ok', 
            successful_actions: successTracker.get(),
            changes: generateApplyWritesToItemsChanges(addedHash, updatedHash, deletedHash, items, pk, optionsIncDefaults)
        };
    }


    
}

function generateFinalItems<T extends Record<string, any>>(addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>, originalItems:ReadonlyArray<Readonly<T>> | Draft<T>[], pk:PrimaryKeyGetter<T>, optionsIncDefaults:Required<ApplyWritesToItemsOptions<T>>) {
    let finalItems = optionsIncDefaults.in_place_mutation? originalItems as T[] : [...originalItems] as T[];
    for( let i = 0; i < finalItems.length; i++ ) {
        if( !finalItems[i] ) throw new Error(`finalItems[i] was empty, suggesting either an item has been nullified, or splicing has shortened the length such that i is beyond the end. i: ${i}, length: ${finalItems.length}`);
        const pkValue = pk(finalItems[i]!);
        if( updatedHash[pkValue] ) {
            finalItems[i] = updatedHash[pkValue]!;
        } else if( deletedHash[pkValue] ) {
            finalItems.splice(i, 1);
            i--;
        }
    }
    const added = Object.values(addedHash);
    for( const item of added ) {
        finalItems.push(item);
    }
    return finalItems;
}

function emptyApplyWritesToItemsChanges<T extends Record<string, any>>(originalItems:ReadonlyArray<Readonly<T>> | Draft<T>[]):ApplyWritesToItemsChanges<T> {
    return {added: [], updated: [], removed: [], changed: false, final_items: originalItems as T[]};
}
function generateApplyWritesToItemsChanges<T extends Record<string, any>>(addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>, originalItems:ReadonlyArray<Readonly<T>> | Draft<T>[], pk:PrimaryKeyGetter<T>, optionsIncDefaults:Required<ApplyWritesToItemsOptions<T>>):ApplyWritesToItemsChanges<T> {

    const changes: ApplyWritesToItemsChanges<T> = { added: Object.values(addedHash), updated: Object.values(updatedHash), removed: Object.values(deletedHash), changed: false, final_items: [] };
    const newChange = !!(changes.added.length || changes.updated.length || changes.removed.length);
    changes.changed = newChange;
    if( newChange ) {
        changes.final_items = generateFinalItems<T>(addedHash, updatedHash, deletedHash, originalItems, pk, optionsIncDefaults);
    } else {
        // Use the original array for shallow comparison to indicate no change 
        changes.final_items = originalItems as T[]
    }

    return changes;
}