import { z } from "zod";
import { getPropertySpreadingArrays } from "../../../dot-prop-paths/getPropertySimpleDot.ts";
import { getZodSchemaAtSchemaDotPropPath } from "../../../dot-prop-paths/zod.ts";
import type { WriteAction } from "../../types.ts";
import { isWriteActionArrayScopePayload } from "../../helpers.ts";
import type { DDL } from "../../../ddl/types.ts";
import type { DotPropPathValidArrayValue } from "../../../dot-prop-paths/types.ts";


type ArrayScopeSchemaAndDDL<ScopedType extends Record<string, any>> = {writeAction:WriteAction<ScopedType>, schema: z.ZodType<ScopedType, any, any>, ddl: DDL<ScopedType>};
type Scoped<ScopedType extends Record<string, any>> = ArrayScopeSchemaAndDDL<ScopedType> & {items: ScopedType[], path: string};
export function getArrayScopeSchemaAndDDL<T extends Record<string, any>>(writeAction:Readonly<WriteAction<T>>, schema: z.ZodType<T, any, any>, rules:DDL<T>) {
    const payload = writeAction.payload;
    if( !isWriteActionArrayScopePayload<T>(payload) ) throw new Error("Expects Array Scope Write Action");
    const scope: string = payload.scope;
    const action = payload.action;
    
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>;

    type ScopedListRules = Partial<DDL<ScopedType>['lists']>;
    const scopedListRules:ScopedListRules = {};
    let ruleKey: keyof typeof rules.lists;
    for( ruleKey in rules.lists ) {
        if( ruleKey.indexOf(scope)===0 ) {
            const scopedRuleKey = ruleKey===scope? '.' : ruleKey.replace(scope, '') as keyof DDL<ScopedType>['lists'];

            // @ts-ignore this is solvable, it's just being a pain
            scopedListRules[scopedRuleKey] = rules.lists[ruleKey];
        }
    }
    if( Object.keys(scopedListRules).length===0 ) debugger;

    const scopedSchema = getZodSchemaAtSchemaDotPropPath(schema, scope);
    if( !scopedSchema ) throw new Error("Could not scope the schema. Suggests the schema and the dot-prop-path don't align.");

    // expand payload into an action
    const scopedWriteAction = {
        type: 'write' as const,
        ts: writeAction.ts,
        uuid: writeAction.uuid+scope,
        payload: action
    } as WriteAction<ScopedType>;

    const output: ArrayScopeSchemaAndDDL<ScopedType> = {
        writeAction: scopedWriteAction,
        schema: scopedSchema,
        ddl: {version: rules.version, lists: scopedListRules} as DDL<ScopedType>
    };
    return output;
}

export default function getArrayScopeItemAction<T extends Record<string, any>>(item:T, writeAction:Readonly<WriteAction<T>>, schema: z.ZodType<T, any, any>, rules:DDL<T>) {
    const payload = writeAction.payload;
    if( !isWriteActionArrayScopePayload<T>(payload) ) throw new Error("Expects Array Scope Write Action");
    const scope: string = payload.scope;

    const scopedSchemaAndDDL = getArrayScopeSchemaAndDDL<T>(writeAction, schema, rules);

    
    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>;


    const propertyResults = getPropertySpreadingArrays(item, scope);


    return propertyResults.map(scopedItems => {
        if( !Array.isArray(scopedItems.value) ) throw new Error('array_scope paths must be to an array');
        return {
            items: scopedItems.value as ScopedType[],
            path: scopedItems.path,
            ...scopedSchemaAndDDL
        }
    }) as Scoped<ScopedType>[];
}