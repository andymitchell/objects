import { DotPropPathToArraySpreadingArrays, DotPropPathValidArrayValue } from "../../dot-prop-paths/types";
import { PrimaryKeyValue } from "../../getKeyValue";
import { IfAny } from "../../types";
import { EnsureRecord } from "../../types";
import { WriteAction, WriteActionPayloadCreate, WriteActionPayloadUpdate } from "../types";

export type ItemHash<T> = Record<PrimaryKeyValue, T>;



export interface WriteStrategy<T extends Record<string, any>> {
    create_handler: (writeActionPayload: WriteActionPayloadCreate<T>) => { created: true, item: T } | { created: false, item: undefined };
    update_handler: (writeActionPayload: WriteActionPayloadUpdate<T>, target: T, alreadyCloned?: boolean) => { updated: boolean, item: T }
}

/*
type ListRulesCore<T = Record<string, any>> = {
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
export type ListRules<T> = ListRulesCore<T>;

export type DDL<T extends Record<string, any>> = {
    [K in DotPropPathToArraySpreadingArrays<T>]: ListRules<DotPropPathValidArrayValue<T, K>>
} & {
    '.': ListRules<T>;
}
*/





type ListRulesCore<T extends Record<string, any> = Record<string, any>> = {
    version: number,
    primary_key: IfAny<T, string, keyof T>,
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
export type ListRules<T extends Record<string, any> = Record<string, any>> = ListRulesCore<T>;


export type DDL<T extends Record<string, any>> = 
    IfAny<
    T,
    {
        '.': ListRules<any>;
    },
    {
        [K in DotPropPathToArraySpreadingArrays<T>]: ListRules<EnsureRecord<DotPropPathValidArrayValue<T, K>>>
    } & {
        '.': ListRules<T>;
    }
    >
    

const typeCheck1:DDL<any> = {
    '.': {
        version: 1,
        primary_key: 'whatever'
    }
}

const typeCheck2:DDL<{id: string/*, friends: {fid: string}[]*/}> = {
    '.': {
        version: 1,
        primary_key: 'id'
    }
}