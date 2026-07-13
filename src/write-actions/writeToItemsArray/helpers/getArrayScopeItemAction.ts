import { z } from "zod";
import { getPropertySpreadingArrays } from "../../../dot-prop-paths/getPropertySimpleDot.ts";
import { getZodSchemaAtSchemaDotPropPath } from "../../../dot-prop-paths/schema-tree.ts";
import type { WriteAction } from "../../types.ts";
import { isWriteActionArrayScopePayload } from "../../helpers.ts";
import type { DDL } from "../../../ddl/types.ts";
import type { DotPropPathValidArrayValue } from "../../../dot-prop-paths/types.ts";


type ArrayScopeSchemaAndDDL<ScopedType extends Record<string, any>> = {writeAction:WriteAction<ScopedType>, schema: z.ZodType<ScopedType, any, any>, ddl: DDL<ScopedType>};
type Scoped<ScopedType extends Record<string, any>> = ArrayScopeSchemaAndDDL<ScopedType> & {items: ScopedType[], path: string};

/**
 * Re-root an `array_scope` action at its scope: the nested action wrapped as a standalone `WriteAction`,
 * the element schema at the scope path, and the DDL rules re-keyed relative to it — everything the engine's
 * recursion needs except the target arrays themselves (which are per-item; see `getArrayScopeItemAction`).
 *
 * @param writeAction An action whose payload is `array_scope`; anything else throws.
 * @param schema The schema of one top-level item.
 * @param rules The DDL for the top-level items; entries under the scope are re-keyed relative to it.
 * @returns `{ writeAction, schema, ddl }` scoped to one element of the target array.
 *
 * @remarks
 * The scope is expected to have passed `resolveArrayScope` (the engine preflights it and rejects the action
 * as `invalid_scope` otherwise), so an unresolvable scope here throws as a broken invariant, not as payload
 * validation.
 */
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

/**
 * Resolve an `array_scope` action against ONE item: every array the scope reaches inside it, each paired
 * with the re-rooted action/schema/DDL from `getArrayScopeSchemaAndDDL`, ready for the engine to recurse into.
 *
 * @param item The top-level item whose scoped arrays are the write targets.
 * @param writeAction An action whose payload is `array_scope`; anything else throws.
 * @param schema The schema of one top-level item.
 * @param rules The DDL for the top-level items.
 * @returns One entry per array the scope reaches in `item` (a scope crossing an intermediate array can reach
 * several), each with the concrete `path` into the item. An ABSENT scoped value (e.g. an optional array the
 * item omits) yields no entry — zero targets, exactly like a present-but-empty array.
 *
 * @remarks
 * The scope is expected to have passed `resolveArrayScope` (the engine preflights it and rejects the action
 * as `invalid_scope` otherwise), so a PRESENT non-array value here throws as a broken invariant — it means
 * the item violates its schema, not that the payload is bad.
 */
export default function getArrayScopeItemAction<T extends Record<string, any>>(item:T, writeAction:Readonly<WriteAction<T>>, schema: z.ZodType<T, any, any>, rules:DDL<T>) {
    const payload = writeAction.payload;
    if( !isWriteActionArrayScopePayload<T>(payload) ) throw new Error("Expects Array Scope Write Action");
    const scope: string = payload.scope;

    const scopedSchemaAndDDL = getArrayScopeSchemaAndDDL<T>(writeAction, schema, rules);


    type ScopedType = DotPropPathValidArrayValue<T, typeof payload.scope>;


    const propertyResults = getPropertySpreadingArrays(item, scope);


    return propertyResults
        .filter(scopedItems => scopedItems.value !== undefined)
        .map(scopedItems => {
            if( !Array.isArray(scopedItems.value) ) throw new Error('array_scope paths must be to an array');
            return {
                items: scopedItems.value as ScopedType[],
                path: scopedItems.path,
                ...scopedSchemaAndDDL
            }
        }) as Scoped<ScopedType>[];
}