import { z } from "zod";
import { getPropertySpreadingArrays } from "../../../dot-prop-paths/getPropertySimpleDot";
import { DotPropPathValidArrayValue } from "../../../dot-prop-paths/types";
import { getZodSchemaAtSchemaDotPropPath } from "../../../dot-prop-paths/zod";
import { WriteAction,  WriteActionPayload, WriteActionPayloadArrayScope, isWriteActionArrayScopePayload } from "../../types";
import { DDL } from "../types";


export function getArrayScopeSchemaAndDDL<T extends Record<string, any>>(writeAction:Readonly<WriteAction<T>>, schema: z.ZodType<T, any, any>, rules:DDL<T>) {
    const payload = writeAction.payload;
    if( !isWriteActionArrayScopePayload(payload) ) throw new Error("Expects Array Scope Write Action");
    
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>; // Note that because of generics, this type is meaningless to the type checker. Helpful to read though. 

    type ScopedRules = Partial<DDL<ScopedType>>;
    const scopedRules:ScopedRules = {};
    for( let ruleKey in rules ) {
        if( ruleKey.indexOf(payload.scope)===0 ) {
            // @ts-ignore
            const scopedRuleKey = ruleKey===payload.scope? '.' : ruleKey.replace(payload.scope, '') as keyof ScopedRules;
            // @ts-ignore It's a classic TS problem of trying to clone an object. It's solvable, I'm just tight for time. 
            scopedRules[scopedRuleKey] = rules[ruleKey];
        }
    }

    const scopedSchema = getZodSchemaAtSchemaDotPropPath(schema, payload.scope);
    if( !scopedSchema ) throw new Error("Could not scope the schema. Suggests the schema and the dot-prop-path don't align.");

    // expand payload into an action
    const scopedWriteAction:WriteAction<ScopedType> = {
        type: 'write',
        ts: writeAction.ts,
        uuid: writeAction.uuid+payload.scope,
        payload: payload.action
    }

    return {
        writeAction: scopedWriteAction,
        schema: scopedSchema,
        ddl: scopedRules as DDL<ScopedType>
    }
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
    });
}