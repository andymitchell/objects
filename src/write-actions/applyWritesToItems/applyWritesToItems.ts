
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


type ObjectCloneMode = 'clone' | 'mutate';

function getMutableItem<T extends Record<string, any>>(item:T, mode?: ObjectCloneMode):T {

    if( mode==='mutate' ) {
        return item;
    } else {
        // If immer draft it must be restored before cloned:
        if( isDraft(item) ) item = current(item);
        
        const clone = structuredClone(item) as T;
        return clone;
    }
}


function getOptionDefaults<T extends Record<string, any>>(options?:Partial<ApplyWritesToItemsOptions<T>>):Required<ApplyWritesToItemsOptions<T>> {
    return {
        attempt_recover_duplicate_create: 'never',
        mutate: false,
        atomic: false,
        ...options
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



/**
 * Applies the write actions (`WriteAction`) to an array of items, returning a new or mutated array.
 * 
 * **This is an alias of `applyWritesToItems`** but it correctly returns Immer Drafts if they were passed in. 
 * It's split into its own function (instead of being an overload of `applyWritesToItems`) due to a higher DX cost: if you want to explicitly specify T as a generic, it requires 2 to be specified.
 * 
 * Purity and Referential Comparison:
 * - It defaults to returning a new array and new objects (only if the write actions affect them)
 *      - It supports referential comparison, only altering the array or objects' references **if** the write action affects it
 * - If you use the `mutate` option on non-Immer `items`, then referential comparison is not guaranteed  
 * 
 * Support for Immer:
 * - You must use the `mutate` option if you pass an Immer Draft array of `items`
 * - The `changes` object returned is only available during the `produce` function. It ceases to be accessible afterwards (as Immer cancels the draft objects). See #immer_changes_cancelled_post_produce.
 * - 🐢 If you use Immer and `atomic`, then to be able to rollback it needs to clone objects (because any mutation in Immer is an irreversible flag, so it must first clone), which is slower that you might expect. But as fast as normal non-Immer operations.
 * 
 * Transactional/atomic behaviour
 * - By default, it completes as many actions as it can, and if any fail it stops doing subsequent actions.
 * - If you use the `atomic` option, then if any action fails, all fail. 
 * 
 * @param writeActions The actions to perform 
 * @param items The items to perform them on (by default they will not be mutated)
 * @param schema 
 * @param ddl The rules for how the write actions will be implemented
 * @param user Required if the `ddl` specifies permissions  
 * @param options Optional:
 *  - atomic: if an action fails, all fail (aka transactional behaviour)
    - attempt_recover_duplicate_create: specify the conflict resolution strategy for creating an item that already exists in `items` 
    - mutate: keeps the same object references and modifies the passed-in `items` array directly
 * @returns A new array (unless `mutate` is used) with the actions applied to its objects
 */
export function applyWritesToItemsTyped<T extends Record<string, any>, I extends T | Draft<T>>(writeActions: WriteAction<T>[], items: I[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, user?: IUser, options?: ApplyWritesToItemsOptions<T>): ApplyWritesToItemsResponse<I> {
    // This function works as overload for applyWritesToItems (instead of the 'Typed' suffix);
    // but with the cost of requiring the user to specify 2 generics instead of just 1 T.
    // So decided to give the consumer the choice. 
    return applyWritesToItems(writeActions, items as T[], schema, ddl, user, options) as ApplyWritesToItemsResponse<I>;
}

/**
 * Applies the write actions (`WriteAction`) to an array of items, returning an updated array. 
 * 
 * Purity and Referential Comparison:
 * - It defaults to returning a new array and new objects (only if the write actions affect them)
 *      - It supports referential comparison, only altering the array or objects' references **if** the write action affects it
 * - If you use the `mutate` option on non-Immer `items`, then referential comparison is not guaranteed  
 * 
 * Support for Immer:
 * - You must use the `mutate` option if you pass an Immer Draft array of `items`
 * - The `changes` object returned is only available during the `produce` function. It ceases to be accessible afterwards (as Immer cancels the draft objects). See #immer_changes_cancelled_post_produce.
 * - 🐢 If you use Immer and `atomic`, then to be able to rollback it needs to clone objects (because any mutation in Immer is an irreversible flag, so it must first clone), which is slower that you might expect. But as fast as normal non-Immer operations.
 * 
 * Transactional/atomic behaviour
 * - By default, it completes as many actions as it can, and if any fail it stops doing subsequent actions.
 * - If you use the `atomic` option, then if any action fails, all fail. 
 * 
 * @param writeActions The actions to perform 
 * @param items The items to perform them on (by default they will not be mutated)
 * @param schema 
 * @param ddl The rules for how the write actions will be implemented
 * @param user Required if the `ddl` specifies permissions  
 * @param options Optional:
 *  - atomic: if an action fails, all fail (aka transactional behaviour)
    - attempt_recover_duplicate_create: specify the conflict resolution strategy for creating an item that already exists in `items` 
    - mutate: keeps the same object references and modifies the passed-in `items` array directly
 * @returns A new array (unless `mutate` is used) with the actions applied to its objects
 */
export function applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: T[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, user?: IUser, options?: ApplyWritesToItemsOptions<T>): ApplyWritesToItemsResponse<T>  {

    return _applyWritesToItems(writeActions, items, schema, ddl, user, options);
}
function _applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: T[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, user?: IUser, options?: ApplyWritesToItemsOptions<T>, scoped?:boolean): ApplyWritesToItemsResponse<T> {
    

    if( writeActions.length===0 ) {
        return {
            status: 'ok', 
            changes: emptyApplyWritesToItemsChanges(items),
            successful_actions: []
        };
    }
    
    const optionsIncDefaults:Required<ApplyWritesToItemsOptions<T>> = getOptionDefaults<T>(options);
    if( isDraft(items) && !optionsIncDefaults.mutate ) {
        throw new Error("When using Immer drafts you need to use mutate. Immer does not support replacing the array.");
    }


    let objectCloneMode: ObjectCloneMode = optionsIncDefaults.mutate? 'mutate' : 'clone';
    let mutatedItemsRollback:MutatedItemsRollback<T> | undefined;
    // Handle the challenge of rollbacks while maintaining referential comparison. 
    if( optionsIncDefaults.atomic && optionsIncDefaults.mutate ) {
        if( isDraft(items) ) {
            // Immer works on the basis that any mutation to an object triggers a flag, and it can never be rolled back (even if applying identical original properties to the same pointer)
            // Therefore we will keep the outer array (like mutate) but replace changed objects (like immutable), knowing they're not deployed until successful at the end.
            objectCloneMode = 'clone';
        } else {
            mutatedItemsRollback = new MutatedItemsRollback(items);
        }
    }

    const referentialComparisonOk = !optionsIncDefaults.mutate || isDraft(items);
    
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
                                        mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    }


                                    const payloadSetsPrimaryKeyAs = rules.primary_key in action.payload.data && (action.payload.data as T)[rules.primary_key];
                                    if( payloadSetsPrimaryKeyAs && payloadSetsPrimaryKeyAs!==pk(mutableUpdatedItem) ) {
                                        failureTracker.report(action, item, {
                                            'type': 'update_altered_key',
                                            primary_key: rules.primary_key
                                        })
                                    } else {
                                        const unvalidatedMutableUpdatedItem = writeStrategy.update_handler(action.payload, mutableUpdatedItem);

                                        const schemaOk = failureTracker.testSchema(action, unvalidatedMutableUpdatedItem); 
                                        if( schemaOk ) {
                                            mutableUpdatedItem = unvalidatedMutableUpdatedItem; // Default lww handler has just mutated mutableUpdatedItem (no new object), because options.mutate decides whether to have cloned it originally or be editing an existing object (e.g. for Immer efficiency)                                            
                                        } // #fail_continues
                                    }

                                    break;
                                case 'array_scope':
                                    if (!mutableUpdatedItem) {
                                        mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    }
                                    // Get all arrays that match the scope, then recurse into applyWritesToItems for them
                                    const scopedArrays = getArrayScopeItemAction<T>(item, action, schema, ddl);

                                    

                                    for( const scopedArray of scopedArrays ) {

                                        // #immer_cannot_mutate_in_atomic
                                        // Immer is an edge case here because of the need to handle atomic rollbacks: it must switch away from 'mutate' for nested properties.
                                        // In Immer, any update to an object or property flags the whole draft, and it cannot be undone. 
                                        // At the moment, Immer+atomic can rollback because it clones the object before updating it, only accepting it if all actions succeed.
                                        // The problem is when it recurses into _applyWritesToItems: the recursed level succeeds and mutates an object.
                                        // Now it can no longer be rolled back, even if the top level now fails on a subsequent action. 
                                        // To workaround this, in the case of (`atomic` + Immer + array_scope), it must clone the target before recursing into it 
                                        const preventMutation = optionsIncDefaults.mutate && optionsIncDefaults.atomic && isDraft(scopedArray.items);

                                        const arrayResponse = _applyWritesToItems(
                                            [scopedArray.writeAction], 
                                            preventMutation? structuredClone(current(scopedArray.items)) : scopedArray.items, 
                                            scopedArray.schema, 
                                            scopedArray.ddl, 
                                            user,
                                            optionsIncDefaults,
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
        if( optionsIncDefaults.atomic ) {
            if( mutatedItemsRollback ) {
                items = mutatedItemsRollback.rollback();
            }
            changes = emptyApplyWritesToItemsChanges(items, referentialComparisonOk);
        } else {
            // Thought: if addedHash/updatedHash/deletedHash/etc ends up reading ahead, it's still possible to generate the output by re-running applyWritesItems with just the actions in successTracker.get 
            changes = generateApplyWritesToItemsChanges(addedHash, updatedHash, deletedHash, items, pk, optionsIncDefaults, referentialComparisonOk);
            successful_actions = successTracker.get();
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
            changes: generateApplyWritesToItemsChanges(addedHash, updatedHash, deletedHash, items, pk, optionsIncDefaults, referentialComparisonOk)
        };
    }


    
}

function generateFinalItems<T extends Record<string, any>>(addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>, originalItems:T[], pk:PrimaryKeyGetter<T>, optionsIncDefaults:Required<ApplyWritesToItemsOptions<T>>) {
    let finalItems = optionsIncDefaults.mutate? originalItems as T[] : [...originalItems] as T[];
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

function emptyApplyWritesToItemsChanges<T extends Record<string, any>>(originalItems:T[], referentialComparisonOk: boolean = true):ApplyWritesToItemsChanges<T> {
    return {insert: [], update: [], remove_keys: [], changed: false, final_items: originalItems, created_at: Date.now(), referential_comparison_ok: referentialComparisonOk};
}
function generateApplyWritesToItemsChanges<T extends Record<string, any>>(addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>, originalItems:T[], pk:PrimaryKeyGetter<T>, optionsIncDefaults:Required<ApplyWritesToItemsOptions<T>>, referentialComparisonOk:boolean):ApplyWritesToItemsChanges<T> {

    const changes: ApplyWritesToItemsChanges<T> = { insert: Object.values(addedHash), update: Object.values(updatedHash), remove_keys: Object.values(deletedHash).map(x => pk(x)), changed: false, final_items: [], created_at: Date.now(), referential_comparison_ok: referentialComparisonOk };
    const newChange = !!(changes.insert.length || changes.update.length || changes.remove_keys.length);
    changes.changed = newChange;
    if( newChange ) {
        changes.final_items = generateFinalItems<T>(addedHash, updatedHash, deletedHash, originalItems, pk, optionsIncDefaults);
    } else {
        // Use the original array for shallow comparison to indicate no change 
        changes.final_items = originalItems
    }

    return changes;
}




/**
 * When mutating objects and 'atomic' is enabled, it needs a way to roll them back while maintaining the same reference 
 * (so they don't appear to have changed).
 * 
 * This achieves it by restoring the same array, same object references, and same values in them no matter how they were changed.
 * 
 * It will not work for Immer (because Immer flags an object as dirty when its mutated, even if the mutation makes no changes. See #immer_cannot_mutate_in_atomic)
 */
class MutatedItemsRollback<T extends Record<string, any> = Record<string, any>> {

    private initialState:{array_reference: T[], object_references: T[], values: T[]};

    constructor(items:T[]) {
        if( isDraft(items) ) throw new Error("Immer cannot work with MutatedItemsRollback. See #immer_cannot_mutate_in_atomic.");

        this.initialState = {array_reference: items, object_references: [...items], values: structuredClone(items)}
    }

    rollback():T[] {
        const items = this.initialState.array_reference;

        items.length = 0;
        this.initialState.object_references.forEach(x => items.push(x));

        this.initialState.values.forEach((x, index) => {
            rollbackObjectWhilePreservingReference(items[index]!, x);
        })
        return items;
    }
}

/**
 * Makes the `target` identical to `original`, without changing the `target` reference. 
 * 
 * Use it to maintain referential comparison when rolling back a mutated object. I.e. the object is unchanged.
 * 
 * How it works: 
 * - It removes keys from `target` that aren't in the `source`
 * - For every key in `source`, it adds it to `target` with the same reference
 * 
 *
 * @param {T} target The object to update
 * @param {T} original The object to sync from 
 * 
 * @note It is not a deep clone - it just syncs references at the top level (without recursion) - but it does make them equal.
 * 
 */
function rollbackObjectWhilePreservingReference<T extends Record<string, any> | any[]>(target: T, original: T): void {

    if (target === original) return;


    // 1. Remove keys from the target that are not present in the source.
    for (const key in target) {
        if (!(key in original)) {
            delete target[key];
        }
    }

    // 2. Update/add keys from the source to the target.


    for (const key in original) {
        target[key] = original[key];
    }

    // Also get symbol properties.
    for (const symbol of Object.getOwnPropertySymbols(original)) {
        const descriptor = Object.getOwnPropertyDescriptor(original, symbol)!;
        Object.defineProperty(target, symbol, descriptor);
    }


}
