export {}
/*
import { isEqual, merge, replace } from "lodash-es";
import { AppliedWritesOutput, VALUE_TO_DELETE_KEY, WriteAction, WriteActionPayloadArrayScope, WriteActionPayloadCreate, WriteActionPayloadUpdate, isUpdateOrDeleteWriteActionPayload } from "./types";


import { setProperty } from "dot-prop";
import { DotPropPaths, DotPropPathsRecord } from "../dot-prop-paths";
import { WhereFilter } from "../where-filter";
import safeKeyValue, { PrimaryKeyValue } from "../getKeyValue";
import { array, z } from "zod";
import { getPropertySpreadingArrays } from "../dot-prop-paths/getPropertySimpleDot";
import { DotPropPathToArraySpreadingArrays, DotPropPathValidArrayValue } from "../dot-prop-paths/types";


type ItemHash<T> = Record<PrimaryKeyValue, T>;
function applyAccumulatorToHashes<T>(accumulator:AppliedWritesOutput<T>, primary_key: keyof T, addedHash:ItemHash<T>, updatedHash:ItemHash<T>, deletedHash:ItemHash<T>) {
    const io: [T[], ItemHash<T>][] = [
        [accumulator.added, addedHash],
        [accumulator.updated, updatedHash],
        [accumulator.deleted, deletedHash]
    ];
    io.forEach(transform => {
        const items = transform[0];
        const itemHash = transform[1];
        for (const item of items) itemHash[safeKeyValue(item[primary_key])] = item;
    })
}


function getScopedArrays<T>(item:T, payload:Readonly<WriteActionPayloadArrayScope<T>>, rules:DDL<T>) {
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>; // Note that because of generics, this type is meaningless to the type checker. Helpful to read though. 

    const scopedRules:Partial<DDL<ScopedType>> = {};
    for( let ruleKey in rules ) {
        if( ruleKey.indexOf(payload.scope)===0 ) {
            scopedRules[ruleKey===payload.scope? '.' : ruleKey.replace(payload.scope, '')] = rules[ruleKey];
        }
    }

    const propertyResults = getPropertySpreadingArrays(item, payload.scope);

    return propertyResults.map(scopedItems => {
        if( !Array.isArray(scopedItems.value) ) throw new Error('array_scope paths must be to an array');
        return {
            writeActions: payload.actions as WriteAction<ScopedType>[],
            items: scopedItems.value as ScopedType[],
            path: scopedItems.path,
            ddl: scopedRules as DDL<ScopedType>
        }
    });
}

export default function applyWritesToItems<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>>, ddl: DDL<T>, accumulator?: AppliedWritesOutput<T>): AppliedWritesOutput<T> {

    // Load the rules
    const rules:ListRules<T> | undefined = ddl['.'];

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
            const pk = safeKeyValue(action.payload.data[rules.primary_key]);
            if (!existingIds.has(pk)) {
                // TODO Check permissions
                const createdResult = writeStrategy.create_handler(action.payload);
                if (createdResult.created) {
                    // TODO Run pretriggers
                    addedHash[pk] = createdResult.item;
                } else {
                    // TODO Handle or just ignore?
                }
            } else {
                console.warn("applyWriteItems: Tried to create an object with an ID that already exists.");
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
            if (isUpdateOrDeleteWriteActionPayload<T>(action.payload) && WhereFilter.matchJavascriptObject(item, action.payload.where)) {
                // TODO Check permissions


                // Check if it's a grow set
                let maybeExpandedWriteActions: WriteAction<T>[];
                if (rules.growset) {
                    maybeExpandedWriteActions = convertWriteActionToGrowSetSafe(action, mutableUpdatedItem, rules); // Rewrite Delete to be an Update
                } else {
                    maybeExpandedWriteActions = [action];
                }

                for (const action of maybeExpandedWriteActions) {
                    switch (action.payload.type) {
                        case 'update':
                            if (!mutableUpdatedItem) {
                                mutableUpdatedItem = structuredClone(item);
                            }

                            mutableUpdatedItem = writeStrategy.update_handler(action.payload, mutableUpdatedItem, true).item;

                            break;
                        case 'array_scope':
                            if (!mutableUpdatedItem) {
                                mutableUpdatedItem = structuredClone(item);
                            }
                            // Get all items that potentially match, then recurse into applyWritesToItems for them
                            const scopedArrays = getScopedArrays(item, action.payload, ddl);

                            for( const scopedArray of scopedArrays ) {
                                const arrayChanges = applyWritesToItems(scopedArray.writeActions, scopedArray.items, scopedArray.ddl);
                                setProperty(
                                    item,
                                    scopedArray.path,
                                    arrayChanges.final_items
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
    final = [...final, ...Object.values(addedHash)];

    const output: AppliedWritesOutput<T> = { added: Object.values(addedHash), updated: Object.values(updatedHash), deleted: Object.values(deletedHash), final_items: final };

    return output;
}


const writeLww: WriteStrategy<Record<string, any>> = {
    create_handler: (writeActionPayload) => {
        return { created: true, item: writeActionPayload.data };
    },
    update_handler(writeActionPayload, target, alreadyCloned) {
        target = alreadyCloned ? target : structuredClone(target);

    
        if( Array.isArray(target) ) {
            throw new Error("Cannot update an array. Use 'array_scope' instead to create/update/delete items in it.");
        }
        if (writeActionPayload.method === 'merge') {
            merge(target, writeActionPayload.data) // MUTATION
        } else {
            Object.assign(target, writeActionPayload.data); // MUTATION
        }
        deleteUnusedKeysFromDestination(writeActionPayload.data, target, VALUE_TO_DELETE_KEY);


        return { updated: true, item: target };
    }
}



interface WriteStrategy<T> {
    create_handler: (writeActionPayload: WriteActionPayloadCreate<T>) => { created: true, item: T } | { created: false, item: undefined };
    update_handler: (writeActionPayload: WriteActionPayloadUpdate<T>, target: T, alreadyCloned?: boolean) => { updated: boolean, item: T }
}

type ListRulesCore<T = {}> = {
    version: number,
    primary_key: keyof T,
    permissions?: {
        type: 'opa',
        wasm_path: string, // https://stackoverflow.com/questions/49611290/using-webassembly-in-chrome-extension https://groups.google.com/a/chromium.org/g/chromium-extensions/c/zVaQo3jpSpw/m/932YZv2UAgAJ 
        on_error: (item: T, writeAction: WriteAction<T>) => T | void
    },
    pre_triggers?: {
        trigger: (replacement: T, existing?: T) => T // Throws an error if expect halt
    }[],
    write_strategy?: 
        { type: 'lww' } // This is a naive implementation that assumes WriteActions are applied in the correct order. A more robust solution would be to compare timestamps for each dot-prop path.
        | 
        { type: 'custom', strategy: WriteStrategy<T> },
    growset?: {
        delete_key: keyof T
    }
}
type ListRules<T> = ListRulesCore<T>;

type DDL<T extends Record<string, any>> = {
    [K in DotPropPathToArraySpreadingArrays<T>]: ListRules<DotPropPathValidArrayValue<T, K>>
} & {
    '.': ListRules<T>;
}





const example:DDL<{id: string, log: {logid: string, subs: {subid: number}[]}[]}> = {
    '.': {
        version: 1,
        primary_key: 'id',
        growset: {
            delete_key: 'id'
        }
    },
    'log': {
        version: 1,
        primary_key: 'logid'
    },
    'log.subs': {
        version: 1,
        primary_key: 'subid'
    }
}












type Applicator<T extends Record<string, any>> = (writeAction: WriteAction<T>, target?: T) => { item: T, type: 'created' | 'updated' | 'hard_deleted' };
const ddl:ListRules<{id: string, log: {logid: string, subs: {}[]}[]}> = {
    version: 1, 
    primary_key: 'id',
    children: {
        'log': {
            version: 1, 
            primary_key: 'logid'
        }
    }
}






type DDLDeprecated<T extends Record<string, any>> = {
    version: number,
    schema: z.Schema<T>,
    primary_key: keyof T,
    permissions?: {
        type: 'opa',
        wasm_path: string, // https://stackoverflow.com/questions/49611290/using-webassembly-in-chrome-extension https://groups.google.com/a/chromium.org/g/chromium-extensions/c/zVaQo3jpSpw/m/932YZv2UAgAJ 
        on_error: (item: T, writeAction: WriteAction<T>) => T | void
    },
    pre_triggers?: {
        //path: DotPropPathsRecord<T>,
        trigger: (replacement: T, existing?: T) => T // Throws an error if expect halt
    }[],
    write_strategy: 
        { type: 'lww' } // This is a naive implementation that assumes WriteActions are applied in the correct order (and it rollsback). A more robust solution would be to compare timestamps for each dot-prop path.
        | 
        { type: 'custom', strategy: WriteStrategy<T> },
    constraints?: {
        growset?: {
            delete_at_key: string, // TODO Could we add an extra schema check somewhere to make sure the delete key exists on it 
            on_error: (item: T) => T | void
        }
    }
}

const taskCrdt: DDLDeprecated<{}> = {
    update_strategy: {
        type: 'lww'
    },
    constraints: {
        "grow_set": {
            delete_at_key: 'deleted_at',
            on_error: (item) => undefined // TODO Handle the case where the user tries to 'set' a sub array that doesn't have an object schema for the delete key
        }
    },
    permissions: {
        type: 'opa',
        wasm_path: 'no-change-id+owner-check.wasm',
        on_error: (item, writeAction) => null
    },
}
// TODO If it can't write, add a handler, e.g. on_error

const meetingRoomBooking: DDLDeprecated<{ time: number, room: number, pending?: boolean, 'deleted_at'?: number }> = { // This assumes the collection is an array of a type
    update_strategy: {
        type: 'lww'
    },
    constraints: {
        "grow-set": {
            delete_at_key: 'deleted_at'
        }
    },
    pre_triggers: [
        {
            trigger: (replacement, existing) => {
                if (replacement.pending = false && existing.pending) {
                    throw new Error("Cannot manually change pending status. It must be approved by the server."); // Halts
                }
                return replacement;
            }
        },
        {
            trigger: (replacement, existing) => {
                // TODO Can only run on server. Maybe have a standard export for 'Sync' that includes config for the 2 environments, with a lot of overlap. 
                if (existing?.time === replacement.time && !existing.deleted_at) {
                    // TODO Log a message (perhaps on a different table)
                    throw new Error("Already booked"); // Halts
                } else {
                    // TODO Log a success message to say it was confirmed
                    replacement.pending = false;
                }

                return replacement
            }
        }
    ]
}

const makeApplicator = <T extends Record<string, any>>() => {

    const applicator: Applicator<T> = (writeAction, target) => {
        // Check permissions, and handle rejection 

        // Do any pre-triggers (that may halt it, e.g. if the target already has a certain property)

        // Do the standard strategy, e.g. Last Write Wins (LWW), or LLW+Grow-Set (where deletes are replaced)
        switch (writeAction.payload.type) {
            case 'create': {
                break;
            }
            case 'update': {
                break;
            }
            case 'array_create': {
                break;
            }
            case 'delete': {
                break;
            }
        }

        // Do any post-triggers (e.g. if update a certain field, emit a write action elsewhere). This may be best defined only on one environment (e.g. a server).

        return { item: target, type: 'created' };
    }

    return;
}




function applyWritesToItemsOLD<T extends Record<string, any>>(writeActions: WriteAction<T>[], items: ReadonlyArray<Readonly<T>>, primaryKey: keyof T, accumulator?: AppliedWritesOutput<T>): AppliedWritesOutput<T> {
    // Avoid any risk of unexpected mutation:
    //items = cloneDeep(items); // Taken away because it slows the function down by 30%. Just toughen up and don't mess it up. 

    type ItemHash = Record<PrimaryKeyValue, T>;
    const addedHash: ItemHash = {};
    const updatedHash: ItemHash = {};
    const deletedHash: ItemHash = {};

    if (accumulator) {
        // Build on existing changes
        const io: [T[], ItemHash][] = [
            [accumulator.added, addedHash],
            [accumulator.updated, updatedHash],
            [accumulator.deleted, deletedHash]
        ];
        io.forEach(transform => {
            const items = transform[0];
            const itemHash = transform[1];
            for (const item of items) itemHash[safeKeyValue(item[primaryKey])] = item;
        })
    }


    // Apply all the Creates
    const existingIds = new Set(items.map(item => safeKeyValue(item[primaryKey])));
    for (const action of writeActions) {
        if (action.payload.type === 'create') {
            const pk = safeKeyValue(action.payload.data[primaryKey]);
            if (!existingIds.has(pk)) {
                addedHash[pk] = action.payload.data;
            } else {
                console.warn("applyWriteItems: Tried to create an object with an ID that already exists.");
            }
        }
    }

    // When given many write actions, they might update a newly created one, so it must be addressable 
    const itemsIncNewToUpdate: ReadonlyArray<Readonly<T>> = [...items, ...Object.values(addedHash)];

    // Now go through items and update with each write action  
    let final: T[] = [];
    for (const item of itemsIncNewToUpdate) {
        const pk = safeKeyValue(item[primaryKey]);

        let mutableUpdatedItem: T | undefined;
        let deleted = !!deletedHash[pk];
        for (const action of writeActions) {
            if (deleted) break;
            if (action.payload.type === 'update' || action.payload.type === 'array_create') {
                if (WhereFilter.matchJavascriptObject(item, action.payload.where)) {
                    if (!mutableUpdatedItem) {
                        mutableUpdatedItem = structuredClone(item);
                    }

                    if (action.payload.type === 'update') {
                        if (action.payload.method === 'merge') {
                            merge(mutableUpdatedItem, action.payload.data) // MUTATION
                        } else {
                            Object.assign(mutableUpdatedItem, action.payload.data); // MUTATION
                        }
                        deleteUnusedKeysFromDestination<T>(action.payload.data, mutableUpdatedItem, VALUE_TO_DELETE_KEY);
                    } else if (action.payload.type === 'array_create') {
                        let existingArray = DotPropPaths.getProperty(mutableUpdatedItem, action.payload.path) as unknown as unknown[] | undefined;
                        if (existingArray === undefined) existingArray = [];
                        if (!Array.isArray(existingArray)) throw new Error("existingArray wasn't an array");
                        existingArray.push(action.payload.value);
                        setProperty(mutableUpdatedItem, action.payload.path, existingArray);
                    }
                }

            } else if (action.payload.type === 'delete') {
                if (WhereFilter.matchJavascriptObject(item, action.payload.where)) {
                    deleted = true;
                    deletedHash[pk] = item;
                }
            }
        }
        if (mutableUpdatedItem && !deleted) {
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
    final = [...final, ...Object.values(addedHash)];

    const output: AppliedWritesOutput<T> = { added: Object.values(addedHash), updated: Object.values(updatedHash), deleted: Object.values(deletedHash), final_items: final };

    return output;
}
*/