
import type  {  WriteAction,  WriteOutcomeOk, WriteOutcome, WritePayload } from "../types.ts";
import {isUpdateOrDeleteWritePayload, isWriteActionArrayScopePayload, getWriteFailures} from '../helpers.ts';
import { setProperty } from "dot-prop";
import matchJavascriptObject from "../../where-filter/matchJavascriptObject.ts";
import { compileValidateWhereFilter } from "../../where-filter/validateWhereFilter.ts";
import { compileValidateWritePayload } from "../validateWritePayload.ts";
import { preflightActionWhere } from "./helpers/wherePreflight.ts";
import safeKeyValue, { type PrimaryKeyGetter, makePrimaryKeyGetter } from "../../utils/getKeyValue.ts";
import type { WriteToItemsArrayChanges, WriteToItemsArrayOptions, WriteToItemsArrayResult, ItemHash } from "./types.ts";
import type { DDL, RootListRules } from "../../ddl/types.ts";
import writeLww from "./writeStrategies/lww.ts";
import getArrayScopeItemAction, { getArrayScopeSchemaAndDDL } from "./helpers/getArrayScopeItemAction.ts";
import { z } from "zod";
import WriteActionFailuresTracker from "./helpers/WriteActionFailuresTracker.ts";
import equivalentCreateOccurs from "./helpers/equivalentCreateOccurs.ts";
import { type Draft, current, isDraft } from "immer";
import {
    applyAddToSet, applyPush, applyPull, applyInc,
    probeSetPropertyUndefined, commitSetPropertyUndefined, probeDeleteProperty, commitDeleteProperty,
} from "./helpers/mutations/index.ts";
import { escapeDotPropPathSegment, parseDotPropPathSegments } from "../../dot-prop-paths/dotPropPathSegments.ts";
import { joinDotpropPath } from "../../dot-prop-paths/joinDotpropPath.ts";



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


type OptionsWithDefaults = Required<Pick<WriteToItemsArrayOptions, 'attempt_recover_duplicate_create' | 'mutate' | 'atomic'>>;

function getOptionDefaults(options?:Partial<WriteToItemsArrayOptions>):OptionsWithDefaults {
    return {
        attempt_recover_duplicate_create: 'never',
        mutate: false,
        atomic: false,
        ...options
    }
}

/**
 * An index whose keys come from caller data — a primary-key value, an action uuid — and therefore has NO
 * prototype.
 *
 * A plain `{}` is unusable here. Its keys are drawn from untrusted strings, and `'toString'`, `'constructor'`
 * and friends are perfectly legal ones: `hash['toString']` would inherit a truthy function for a key nobody
 * ever wrote, so a presence test silently answers yes. Worse, `hash['__proto__'] = value` reaches the
 * inherited setter and stores NOTHING. Both failures are silent and corrupt data — a create reported `ok`
 * whose row never lands, or an untouched row overwritten by an inherited function.
 *
 * With no prototype there is nothing to inherit and no setter to hit, so every key is an ordinary own
 * property and a truthiness test means exactly what it says. `Object.values`, `delete` and index access all
 * behave normally.
 */
function makeKeyedByCallerData<V>(): Record<string, V> {
    return Object.create(null) as Record<string, V>;
}

class SuccessfulWriteActionesTracker<T extends Record<string, any>> {
    private pk:PrimaryKeyGetter<T>;
    private actionsMap:Record<string, WriteOutcomeOk<T>>;
    constructor(primaryKey:keyof T) {
        this.pk = makePrimaryKeyGetter(primaryKey);
        // Keyed by action uuid, which is caller data — see makeKeyedByCallerData.
        this.actionsMap = makeKeyedByCallerData<WriteOutcomeOk<T>>();
    }

    private findSuccessfulWriteAction(action:WriteAction<T>, createIfMissing?: boolean) {
        if( !this.actionsMap[action.uuid] && createIfMissing ) this.actionsMap[action.uuid] = {ok: true, action_uuid: action.uuid, affected_items: []};
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

    get():WriteOutcomeOk<T>[] {
        return JSON.parse(JSON.stringify(Object.values(this.actionsMap)));
    }
}



/**
 * Applies the write actions (`WriteAction`) to an array of items, returning a new or mutated array.
 *
 * **This is an alias of `writeToItemsArray`** but it correctly returns Immer Drafts if they were passed in.
 * It's split into its own function (instead of being an overload of `writeToItemsArray`) due to a higher DX cost: if you want to explicitly specify T as a generic, it requires 2 to be specified.
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
 * @param schema The shape one stored item must still satisfy after every write that touches it. It is a yardstick,
 * never a renderer: a value it offers to supply (`.default()`, `.prefault()`, `z.coerce`, `.catch()`,
 * `.transform()`) is something an item is measured against, never something applied to it, because the values
 * submitted are the values stored. Where a row schema does substitute, instantiate `T` with
 * `z.input<typeof schema>` — the input type is what a caller may write, and therefore what is stored. The schema
 * must answer on the spot: one holding an asynchronous check throws rather than reporting a failure, as it does
 * under any synchronous parse.
 * @param ddl The rules for how the write actions will be implemented
 * @param options Optional:
 *  - atomic: if an action fails, all fail (aka transactional behaviour)
    - attempt_recover_duplicate_create: conflict resolution for duplicate PKs ('never' | 'if-convergent' | 'always-update')
    - mutate: keeps the same object references and modifies the passed-in `items` array directly
 * @returns A new array (unless `mutate` is used) with the actions applied to its objects
 */
export function writeToItemsArrayPreserveInputType<T extends Record<string, any>, W extends Record<string, any> = T, WF extends Record<string, any> = T, I extends T | Draft<T> = T>(writeActions: WriteAction<T, NoInfer<W>, NoInfer<WF>>[], items: I[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, options?: WriteToItemsArrayOptions): WriteToItemsArrayResult<I, W, WF> {
    // This function works as overload for writeToItemsArray (instead of the 'PreserveInputType' suffix);
    // but with the cost of requiring the user to specify 2 generics instead of just 1 T.
    // So decided to give the consumer the choice.
    return writeToItemsArray(writeActions, items as T[], schema, ddl, options) as WriteToItemsArrayResult<I, W, WF>;
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
 * @param schema The shape one stored item must still satisfy after every write that touches it. It is a yardstick,
 * never a renderer: a value it offers to supply (`.default()`, `.prefault()`, `z.coerce`, `.catch()`,
 * `.transform()`) is something an item is measured against, never something applied to it, because the values
 * submitted are the values stored. Where a row schema does substitute, instantiate `T` with
 * `z.input<typeof schema>` — the input type is what a caller may write, and therefore what is stored. The schema
 * must answer on the spot: one holding an asynchronous check throws rather than reporting a failure, as it does
 * under any synchronous parse.
 * @param ddl The rules for how the write actions will be implemented
 * @param options Optional:
 *  - atomic: if an action fails, all fail (aka transactional behaviour)
    - attempt_recover_duplicate_create: conflict resolution for duplicate PKs ('never' | 'if-convergent' | 'always-update')
    - mutate: keeps the same object references and modifies the passed-in `items` array directly
 * JSON-safety: every written value must losslessly round-trip JSON (the engine operates on JSON-object items —
 * in a SQL setting, on values pulled from a JSONB column, never on arbitrary relational rows). Before any
 * mutation each action's payload values are gated; a non-finite number, or a non-JSON carrier (bigint/Date/Map/…
 * kept by an open `.passthrough()`/`.loose()` schema), is rejected as an unrecoverable `invalid_data_value`
 * rather than silently corrupting state or throwing at serialization — the value-side peer of the `where`
 * finiteness gate. A layer crossing a JSON boundary (e.g. a fetch proxy) runs the same `compileValidateWritePayload`.
 *
 * @returns A new array (unless `mutate` is used) with the actions applied to its object
 *
 * @note 
 */
export function writeToItemsArray<T extends Record<string, any>, W extends Record<string, any> = T, WF extends Record<string, any> = T>(writeActions: WriteAction<T, NoInfer<W>, NoInfer<WF>>[], items: T[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, options?: WriteToItemsArrayOptions): WriteToItemsArrayResult<T, W, WF>  {

    // Wondering if using this in a Read-Modify-Write process (e.g. read JSON items from a JSONB column, modify
    // with this, write them back) is too slow and you should implement a custom WriteAction-to-SQL converter
    // (or any other target)? Note the engine is JSON-object specific — it mutates JSON-safe values in memory,
    // so the SQL path is JSONB-only, never a translation to arbitrary relational columns.
    // In testing it only yielded about a 1.5x improvement, but with major dual-path complexity
    // (because it could optimise in some cases but couldn't convert every WriteAction so needed to fall back).
    // The key to making it performant was to batch all the writes in one using `UPDATE WITH VALUES`

    // W/WF are compile-time only; internally we operate on T
    return _writeToItemsArray(writeActions as WriteAction<T>[], items, schema, ddl, options) as WriteToItemsArrayResult<T, W, WF>;
}
function _writeToItemsArray<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: T[], schema: z.ZodType<T, any, any>, ddl: DDL<T>, options?: WriteToItemsArrayOptions, scoped?:boolean): WriteToItemsArrayResult<T> {


    if( writeActions.length===0 ) {
        return {
            ok: true,
            actions: [],
            changes: emptyWriteToItemsArrayChanges(items),
        };
    }

    const optionsIncDefaults:OptionsWithDefaults = getOptionDefaults(options);
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


    // Load the rules
    const rules: RootListRules<T> = ddl.lists['.'];
    const pk = makePrimaryKeyGetter<T>(rules.primary_key);

    // Keyed by primary-key VALUE, which is caller data — see makeKeyedByCallerData.
    const addedHash: ItemHash<T> = makeKeyedByCallerData<T>();
    const updatedHash: ItemHash<T> = makeKeyedByCallerData<T>();
    const deletedHash: ItemHash<T> = makeKeyedByCallerData<T>();
    let wipItems = [...items] as T[];



    // Track successes, in part because higher up rollbacks want to know what items were affected by an action
    const successTracker = new SuccessfulWriteActionesTracker<T>(rules.primary_key);

    // Track schema issues
    // #fail_continues: the higher up ideally wants to know every action that fails (so a it can mark them as unrecoverable in one hit), and every item that'll fail as a consequence (because if it applied optimistic updates, it needs to roll them back)
    const failureTracker = new WriteActionFailuresTracker<T>(schema, rules);


    const writeStrategy = writeLww;

    // Validate each action's `where` against the schema before applying it. Compiled once (walks the
    // schema a single time) and reused per action. An invalid `where` matches no items, so it must be
    // caught here — at the action level — not at the per-item match site below. `requireSerialisableJsonSubset`
    // because the engine already gates payload VALUES to the JSON-roundtrip subset (below); holding `where`
    // operands to the same subset closes the asymmetry, so a non-finite/non-JSON operand can't cross a
    // serialisation boundary (the engine and a fetch-boundary proxy then agree).
    const validateWhere = compileValidateWhereFilter(schema, { requireSerialisableJsonSubset: true });

    // The value-side peer of the `where` gate above: validates each action's WRITTEN VALUES round-trip JSON.
    // `skipSchemaCheck` because the schema's own JSON-safety is the caller's construction-time responsibility
    // (validateWritePayloadSchema) — here we only gate per-write values, so the compile never throws.
    const validateWritePayload = compileValidateWritePayload(schema, { skipSchemaCheck: true });

    // The engine locates every item by its primary key — to match a `where`, to report an outcome, to
    // reconcile the returned changes — so an item that carries no usable one cannot be written to at all.
    // That is a fault in the supplied items rather than in any single action, and it is settled here as a
    // failed result rather than a throw, so a caller handling ordinary write failures handles this one too.
    // A falsy value counts as no key: an empty string is how a missing key is reported downstream, so `''`
    // and `0` are indistinguishable from absent by the time anything else sees them.
    const itemMissingPrimaryKey = wipItems.some(item => !item[rules.primary_key]);
    if( itemMissingPrimaryKey ) {
        // Recorded against the first action so the batch settles exactly as any other failure does: the
        // shared tail below marks every later action blocked and returns no changes. The error carries no
        // item body — an item with no key has no locator to report it by.
        failureTracker.reportActionError(writeActions[0]!, {type: 'missing_key', primary_key: rules.primary_key});
    }

    const existingIds = new Set(itemMissingPrimaryKey? [] : wipItems.map(item => safeKeyValue(item[rules.primary_key])));

    // Now go through the actions
    writeActions = [...writeActions];
    for( let index = 0; index < writeActions.length; index++ ) {
    //for( const action of writeActions ) {
        const action = writeActions[index]!;
        if( failureTracker.shouldHalt() ) break;

        // JSON-roundtrip value gate, peer to the `where` preflight below: a non-finite number (serialises to
        // null) or a non-JSON carrier (bigint/Date/… kept by an open `.passthrough()` schema) cannot round-trip
        // JSON, so reject the action before any mutation — independent of whether the `where` matches, so the
        // engine and a fetch-boundary proxy agree. Recurses an `array_scope`'s nested action so a bad nested
        // value can't slip past a zero-match outer `where`.
        const dataIssues = validateWritePayload(action.payload as WritePayload<any>);
        if( dataIssues.length>0 ) {
            const issue = dataIssues[0]!;
            failureTracker.reportActionError(action, { type: 'invalid_data_value', reason: issue.reason, data_path: issue.path, message: issue.message });
            continue;
        }

        if (action.payload.type === 'create') {
            const pkValue = pk(action.payload.data, true);
            if( pkValue ) {
                if (existingIds.has(pkValue)) {
                    if( optionsIncDefaults.attempt_recover_duplicate_create==='if-convergent' ) {
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
                    const newItem = writeStrategy.create_handler(action.payload) as T;

                    const schemaOk = failureTracker.testSchema(action, newItem);
                    if( schemaOk ) {
                        existingIds.add(pkValue);
                        // The change hashes report the batch's NET effect on the original items, so a primary key
                        // belongs to at most one of them, and `addedHash` holds only keys ABSENT from those items.
                        // Re-creating a key this batch already deleted therefore replaces a row that still exists
                        // for the caller: it is a whole-row update, not an insert. Recording it as an insert would
                        // leave the original row in place AND append the re-creation, duplicating the key.
                        if( deletedHash[pkValue] ) {
                            updatedHash[pkValue] = newItem;
                            delete deletedHash[pkValue];
                        } else {
                            addedHash[pkValue] = newItem;
                        }
                        successTracker.report(action, newItem);
                        //failureTracker.undoable()?.add(wipItems.length);
                        wipItems.push(newItem);
                    } // #fail_continues
                }
            } else {
                failureTracker.report(action, action.payload.data, {type: 'missing_key', primary_key: rules.primary_key});
            }
        } else {
            // Preflight the action's `where` filters and write targets before touching any item: static schema
            // validation across the whole action tree (own `where`, every `array_scope` scope, every property
            // path, nested `action.where`, `pull` object `items_where`) plus a runtime throw-safety dry-run. An
            // invalid filter matches nothing, and an unwritable scope or property path can never reach its
            // target — none can succeed on retry — so the action is rejected unrecoverably
            // (`invalid_filter`/`invalid_scope`/`invalid_property_path`) and mutates nothing, which keeps a
            // throw-prone filter or an unreachable target from committing a partial change. Validating
            // the nested levels up-front is essential: the per-item recursion only runs for parents matching the
            // outer `where`, so an outer `where` matching nothing would otherwise let a nested fault slip
            // through as a silent no-op.
            const whereIssues = preflightActionWhere(action.payload as WritePayload<any>, schema, validateWhere, { requireSerialisableJsonSubset: true }, wipItems);
            if( whereIssues.length>0 ) {
                const issue = whereIssues[0]!;
                failureTracker.reportActionError(action, issue.kind==='scope'
                    ? { type: 'invalid_scope', scope: issue.scope, reason: issue.reason }
                    : issue.kind==='property_path'
                    ? { type: 'invalid_property_path', path: issue.path, reason: issue.reason }
                    : { type: 'invalid_filter', where_path: issue.path, reason: issue.reason });
                continue;
            }

            // The one target check the schema cannot make, because it is the DDL that names the primary key.
            // Judged here rather than per matched item for the same reason as the preflight above: a write
            // that could never be legal must fail even when the `where` matches nothing.
            const primaryKeyPath = findPrimaryKeyTargetingPropertyPath(action, schema, ddl);
            if( primaryKeyPath!==undefined ) {
                failureTracker.reportActionError(action, { type: 'invalid_property_path', path: primaryKeyPath, reason: 'primary_key' });
                continue;
            }
            for( let i = 0; i < wipItems.length; i++) {
                if( failureTracker.shouldHalt() ) break;
                const item = wipItems[i];
                if( !item ) throw new Error(`Could not find item, suggesting wipItems has mutated such that i can't find it. Either it's a null entry, or the length has been shortened and i now extends it. Suggests bad logic in code. i: ${i}, length: ${wipItems.length}.`);
                const pkValue = pk(item);


                // The match cannot throw here: preflightActionWhere already dry-ran any throw-prone filter and
                // rejected the action before this loop, so the mutation pass is throw-free.
                if ( !deletedHash[pkValue] && isUpdateOrDeleteWritePayload<T>(action.payload) && matchJavascriptObject(item, action.payload.where) ) {
                    let mutableUpdatedItem: T | undefined;
                    let deleted = !!deletedHash[pkValue];



                    if( !failureTracker.shouldHalt() ) {
                        // `array_scope` runs in its own branch rather than a switch case: narrowing the guard's
                        // union for a generic T drops the deferred array-scope variant, so a `case 'array_scope'`
                        // no longer type-checks. The runtime discriminant test is identical either way.
                        if (isWriteActionArrayScopePayload<T>(action.payload)) {
                            if (!mutableUpdatedItem) {
                                mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                            }
                            // Get all arrays that match the scope, then recurse into writeToItemsArray for them
                            const scopedArrays = getArrayScopeItemAction<T>(item, action, schema, ddl);



                            for( const scopedArray of scopedArrays ) {


                                // #immer_cannot_mutate_in_atomic
                                // Immer is an edge case here because of the need to handle atomic rollbacks: it must switch away from 'mutate' for nested properties.
                                // In Immer, any update to an object or property flags the whole draft, and it cannot be undone.
                                // At the moment, Immer+atomic can rollback because it clones the object before updating it, only accepting it if all actions succeed.
                                // The problem is when it recurses into _writeToItemsArray: the recursed level succeeds and mutates an object.
                                // Now it can no longer be rolled back, even if the top level now fails on a subsequent action.
                                // To workaround this, in the case of (`atomic` + Immer + array_scope), it must clone the target before recursing into it
                                const preventMutation = optionsIncDefaults.mutate && optionsIncDefaults.atomic && isDraft(scopedArray.items);

                                const arrayResponse = _writeToItemsArray(
                                    [scopedArray.writeAction],
                                    preventMutation? structuredClone(current(scopedArray.items)) : scopedArray.items,
                                    scopedArray.schema,
                                    scopedArray.ddl,
                                    optionsIncDefaults,
                                    true
                                    );

                                if( !arrayResponse.ok ) {
                                    failureTracker.mergeUnderAction(action, getWriteFailures(arrayResponse));
                                }

                                setProperty(
                                    mutableUpdatedItem,
                                    scopedArray.path,
                                    arrayResponse.changes.final_items
                                )

                            }
                        } else switch (action.payload.type) {
                            case 'update':
                                if (!mutableUpdatedItem) {
                                    mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                }


                                // An update may not change the row's primary key: the engine matches, reports
                                // and reconciles the row through it, so naming it in `data` with anything
                                // other than the value the row already carries is a refused change. That
                                // includes a falsy value, which would leave the row with no usable key at
                                // all — unlocatable for the rest of the batch and for the caller after it.
                                // Presence is what counts, not truthiness, and `in` is deliberately wider
                                // than the own-enumerable walk the value gate makes, so a key on a carrier
                                // the gate cannot see is refused rather than half-trusted. A plain
                                // own-enumerable `undefined` never arrives — the value gate rejects it as
                                // `invalid_data_value` first. Writing the key's own current value back is no
                                // alteration, and the row still reports as updated like any other match.
                                if( rules.primary_key in action.payload.data && (action.payload.data as T)[rules.primary_key]!==pkValue ) {
                                    failureTracker.report(action, item, {
                                        'type': 'update_altered_key',
                                        primary_key: rules.primary_key
                                    })
                                } else {
                                    writeStrategy.update_handler(action.payload, mutableUpdatedItem);
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                    // #fail_continues — if schema failed, shouldHalt() prevents commit
                                }

                                break;
                            case 'delete':
                                deleted = true;
                                existingIds.delete(pkValue);
                                break;
                            // New mutation types bypass WriteStrategy (same as delete/array_scope).
                            // Future work may extend WriteStrategy if custom strategies need to intercept these.
                            case 'add_to_set': {
                                // Read from current state (mutableUpdatedItem if already cloned, else original)
                                const addSource = mutableUpdatedItem ?? item;
                                const addResult = applyAddToSet(addSource, action.payload.path as string, action.payload.items as unknown[], action.payload.unique_by, ddl);
                                if ('error' in addResult) {
                                    failureTracker.report(action, item, addResult.error);
                                } else if (addResult.changed) {
                                    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    (mutableUpdatedItem as Record<string, unknown>)[action.payload.path as string] = addResult.value;
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                }
                                break;
                            }
                            case 'push': {
                                const pushSource = mutableUpdatedItem ?? item;
                                const pushResult = applyPush(pushSource, action.payload.path as string, action.payload.items as unknown[]);
                                if ('error' in pushResult) {
                                    failureTracker.report(action, item, pushResult.error);
                                } else if (pushResult.changed) {
                                    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    (mutableUpdatedItem as Record<string, unknown>)[action.payload.path as string] = pushResult.value;
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                }
                                break;
                            }
                            case 'pull': {
                                const pullSource = mutableUpdatedItem ?? item;
                                const pullResult = applyPull(pullSource, action.payload.path as string, action.payload.items_where as any);
                                if ('error' in pullResult) {
                                    failureTracker.report(action, item, pullResult.error);
                                } else if (pullResult.changed) {
                                    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    (mutableUpdatedItem as Record<string, unknown>)[action.payload.path as string] = pullResult.value;
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                }
                                break;
                            }
                            case 'inc': {
                                const incSource = mutableUpdatedItem ?? item;
                                const incResult = applyInc(incSource, action.payload.path as string, action.payload.amount);
                                if ('error' in incResult) {
                                    failureTracker.report(action, item, incResult.error);
                                } else if (incResult.changed) {
                                    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    (mutableUpdatedItem as Record<string, unknown>)[action.payload.path as string] = incResult.value;
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                }
                                break;
                            }
                            // The property verbs probe before committing so an item they would not alter is
                            // never cloned, keeping the item's reference stable through a no-op. The probe
                            // reads the current state, while the commit re-resolves its target inside the
                            // item being written: a nested write must land in the clone, not in the original
                            // object the probe walked.
                            case 'set_property_undefined': {
                                const clearSource = mutableUpdatedItem ?? item;
                                if (probeSetPropertyUndefined(clearSource, action.payload.path as string).changed) {
                                    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    commitSetPropertyUndefined(mutableUpdatedItem as Record<string, unknown>, action.payload.path as string);
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                }
                                break;
                            }
                            case 'delete_property': {
                                const removeSource = mutableUpdatedItem ?? item;
                                if (probeDeleteProperty(removeSource, action.payload.path as string).changed) {
                                    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
                                    commitDeleteProperty(mutableUpdatedItem as Record<string, unknown>, action.payload.path as string);
                                    failureTracker.testSchema(action, mutableUpdatedItem);
                                }
                                break;
                            }
                        }
                    }

                    // Now actually commit the change
                    if( !failureTracker.shouldHalt() ) {
                        successTracker.report(action, item);
                        if (deleted) {
                            // `deletedHash` holds only keys PRESENT in the original items. Deleting a key this batch
                            // created nets to nothing for the caller — drop the pending insert and record no removal,
                            // otherwise `remove_keys` names a key that never existed. Any other delete removes a
                            // pre-existing row, superseding an in-batch update of it.
                            if( addedHash[pkValue] ) {
                                delete addedHash[pkValue];
                            } else {
                                deletedHash[pkValue] = item;
                                if( updatedHash[pkValue] ) delete updatedHash[pkValue];
                            }
                            wipItems.splice(i, 1);
                            i--;
                        } else if( mutableUpdatedItem ) {
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



    if( failureTracker.length()>0 ) {
        // Mark every subsequent action after the failure as blocked
        const failedActions = failureTracker.get();
        const failedActionUUID = failedActions[0]!.action_uuid;
        const index = writeActions.findIndex(x => x.uuid===failedActionUUID);
        if( index===-1 ) throw new Error("noop: the failed action should be known to the writeActions.");

        const actionsBlockedByFailure = writeActions.slice(index+1);
        actionsBlockedByFailure.forEach(action => failureTracker.blocked(action, failedActionUUID));


        let successfulActions: WriteOutcomeOk<T>[] = [];
        let changes: WriteToItemsArrayChanges<T>;
        if( optionsIncDefaults.atomic ) {
            if( mutatedItemsRollback ) {
                items = mutatedItemsRollback.rollback();
            }
            changes = emptyWriteToItemsArrayChanges(items);
        } else {
            // Thought: if addedHash/updatedHash/deletedHash/etc ends up reading ahead, it's still possible to generate the output by re-running writeToItemsArray with just the actions in successTracker.get
            changes = generateWriteToItemsArrayChanges(addedHash, updatedHash, deletedHash, items, pk, optionsIncDefaults);
            successfulActions = successTracker.get();
        }

        // Combine successful + failed into ordered actions array
        const allActions: WriteOutcome<T>[] = [...successfulActions, ...failureTracker.get()];

        // FUTURE IDEA: DETECT WHICH SUBSEQUENT ACTIONS WOULD STILL HAVE FAILED. Find out in one go what won't work (e.g. subsequent schema fails). Solution: take out the initial failing error, then run the remaining actions against the current mutableState, but passed in a recursive call in a way that it won't be mutated. Roll the returned failed actions into failureTracker, replacing any marked as blocked.

        return {
            ok: false,
            actions: allActions,
            changes,
            error: { message: "Some write actions failed." },
        }
    } else {
        return {
            ok: true,
            actions: successTracker.get(),
            changes: generateWriteToItemsArrayChanges(addedHash, updatedHash, deletedHash, items, pk, optionsIncDefaults),
        };
    }



}

/**
 * Find a property-targeting write anywhere in an action that names the primary key of the list it runs
 * against, and report where it is.
 *
 * The engine identifies every item by its primary key: it matches `where` clauses, reports outcomes and
 * reconciles the returned changes through that value. Clearing or removing it strands the item; moving it to
 * another value re-identifies the row midway, leaving the reported changes keyed to a row the caller cannot
 * find. Both are refused whatever the schema permits — a key the schema declares optional or defaulted, or a
 * numeric key `inc` is willing to add to, would otherwise let one through. Each `array_scope` level is judged
 * against its own list's key, since a scoped element is identified by that list's key rather than the outer one.
 *
 * @param action The action to inspect, at any nesting depth.
 * @param schema The schema of one item at this level.
 * @param ddl The DDL whose `'.'` entry names this level's primary key.
 * @param prefix The scope chain already descended, so a nested path is reported from the action's root.
 * @returns The full path of the offending write, or `undefined` when the action targets no primary key.
 *
 * @example
 * // A key holding a literal dot is reported in the escaped grammar, under any scope it sits in:
 * // { type: 'array_scope', scope: 'rows', action: { type: 'inc', path: 'a.b', … } }  ->  'rows.a\\.b'
 *
 * @remarks
 * Run before any item is matched, so an action naming the primary key is refused even against an empty list
 * or a `where` that matches nothing — a statically invalid write fails for the same reason whatever the data
 * happens to hold.
 *
 * The two verb families spell their target in different grammars, and each is read in its own.
 * `set_property_undefined`/`delete_property` take an escaped dot-prop path, which is parsed into segments so
 * that only a path naming the key itself counts (a same-named property nested inside another object is an
 * ordinary field). `inc` takes a raw top-level key name, where a literal dot is just a character, so the
 * whole name is compared as one key. Reported paths always speak the escaped grammar, so a raw name is
 * escaped before it is joined onto the scope chain.
 */
function findPrimaryKeyTargetingPropertyPath<T extends Record<string, any>>(
    action: Readonly<WriteAction<T>>,
    schema: z.ZodType<T, any, any>,
    ddl: DDL<T>,
    prefix = '',
): string | undefined {
    const payload = action.payload;
    const rules = ddl.lists['.'];

    if( payload.type==='set_property_undefined' || payload.type==='delete_property' ) {
        if( !rules ) return undefined;
        const segments = parseDotPropPathSegments(payload.path as string);
        // Only a path naming the key itself strands the item; a same-named property nested inside another
        // object is an ordinary field.
        if( segments.length===1 && segments[0]===String(rules.primary_key) ) {
            return joinDotpropPath(prefix, payload.path as string);
        }
        return undefined;
    }

    if( payload.type==='inc' ) {
        if( !rules ) return undefined;
        // The path is a raw key name rather than a dot-prop path, so the whole name is one key and is
        // compared as such — never split into segments — and escaped on the way out, because a reported
        // path is read in the escaped grammar.
        if( String(payload.path)===String(rules.primary_key) ) {
            return joinDotpropPath(prefix, escapeDotPropPathSegment(String(payload.path)));
        }
        return undefined;
    }

    if( payload.type==='array_scope' ) {
        const scoped = getArrayScopeSchemaAndDDL<T>(action, schema, ddl);
        return findPrimaryKeyTargetingPropertyPath(
            scoped.writeAction,
            scoped.schema,
            scoped.ddl,
            joinDotpropPath(prefix, payload.scope),
        );
    }

    return undefined;
}

function generateFinalItems<T extends Record<string, any>>(addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>, originalItems:T[], pk:PrimaryKeyGetter<T>, optionsIncDefaults:OptionsWithDefaults) {
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

function emptyWriteToItemsArrayChanges<T extends Record<string, any>>(originalItems:T[]):WriteToItemsArrayChanges<T> {
    return {insert: [], update: [], remove_keys: [], changed: false, final_items: originalItems, created_at: Date.now()};
}
function generateWriteToItemsArrayChanges<T extends Record<string, any>>(addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>, originalItems:T[], pk:PrimaryKeyGetter<T>, optionsIncDefaults:OptionsWithDefaults):WriteToItemsArrayChanges<T> {

    const changes: WriteToItemsArrayChanges<T> = { insert: Object.values(addedHash), update: Object.values(updatedHash), remove_keys: Object.values(deletedHash).map(x => pk(x)), changed: false, final_items: [], created_at: Date.now() };
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
