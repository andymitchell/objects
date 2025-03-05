import { z } from "zod";
import { getPropertySpreadingArrays } from "../../../dot-prop-paths/getPropertySimpleDot.js";
import type { DotPropPathValidArrayValue } from "../../../dot-prop-paths/types.js";
import { getZodSchemaAtSchemaDotPropPath } from "../../../dot-prop-paths/zod.js";
import { type WriteAction, isWriteActionArrayScopePayload } from "../../types.js";
import type { DDL } from "../types.js";


type ArrayScopeSchemaAndDDL<ScopedType extends Record<string, any>> = {writeAction:WriteAction<ScopedType>, schema: z.ZodType<ScopedType, any, any>, ddl: DDL<ScopedType>};
type Scoped<ScopedType extends Record<string, any>> = ArrayScopeSchemaAndDDL<ScopedType> & {items: ScopedType[], path: string};
export function getArrayScopeSchemaAndDDL<T extends Record<string, any>>(writeAction:Readonly<WriteAction<T>>, schema: z.ZodType<T, any, any>, rules:DDL<T>) {
    const payload = writeAction.payload;
    if( !isWriteActionArrayScopePayload(payload) ) throw new Error("Expects Array Scope Write Action");
    
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>; // Note that because of generics, this type is meaningless to the type checker. Helpful to read though. 

    type ScopedListRules = Partial<DDL<ScopedType>['lists']>;
    const scopedListRules:ScopedListRules = {};
    let ruleKey: keyof typeof rules.lists;
    for( ruleKey in rules.lists ) {
        if( ruleKey.indexOf(payload.scope)===0 ) {
            const scopedRuleKey = ruleKey===payload.scope? '.' : ruleKey.replace(payload.scope, '') as keyof DDL<ScopedType>['lists'];
            
            // @ts-ignore this is solvable, it's just being a pain 
            scopedListRules[scopedRuleKey] = rules.lists[ruleKey];
        }
    }
    if( Object.keys(scopedListRules).length===0 ) debugger;

    const scopedSchema = getZodSchemaAtSchemaDotPropPath(schema, payload.scope);
    if( !scopedSchema ) throw new Error("Could not scope the schema. Suggests the schema and the dot-prop-path don't align.");

    // expand payload into an action
    const scopedWriteAction:WriteAction<ScopedType> = {
        type: 'write',
        ts: writeAction.ts,
        uuid: writeAction.uuid+payload.scope,
        payload: payload.action
    }

    const output: ArrayScopeSchemaAndDDL<ScopedType> = {
        writeAction: scopedWriteAction,
        schema: scopedSchema,
        ddl: {version: rules.version, lists: scopedListRules} as DDL<ScopedType>
    };
    return output;
}

export default function getArrayScopeItemAction<T extends Record<string, any>>(item:T, writeAction:Readonly<WriteAction<T>>, schema: z.ZodType<T, any, any>, rules:DDL<T>) {
    const payload = writeAction.payload;
    if( !isWriteActionArrayScopePayload(payload) ) throw new Error("Expects Array Scope Write Action");

    const scopedSchemaAndDDL = getArrayScopeSchemaAndDDL<T>(writeAction, schema, rules);

    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>; // Note that because of generics, this type is meaningless to the type checker. Helpful to read though. 


    const propertyResults = getPropertySpreadingArrays(item, payload.scope);


    return propertyResults.map(scopedItems => {
        if( !Array.isArray(scopedItems.value) ) throw new Error('array_scope paths must be to an array');
        return {
            items: scopedItems.value as ScopedType[],
            path: scopedItems.path,
            ...scopedSchemaAndDDL
        }
    }) as Scoped<ScopedType>[];
}