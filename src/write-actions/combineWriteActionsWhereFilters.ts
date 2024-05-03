import { z } from "zod";
import safeKeyValue from "../utils/getKeyValue";
import { WhereFilterDefinition } from "../where-filter";
import { DDL } from "./applyWritesToItems";
import { getArrayScopeSchemaAndDDL } from "./applyWritesToItems/helpers/getArrayScopeItemAction";
import { CombineWriteActionsWhereFiltersResponse, WriteAction } from "./types";


/**
 * For write actions, generate a WhereFilter that would match any existing object that might be affected
 *  - For updates: objects that match the update action's where filter
 *  - For creates: objects that might already have the primary key
 * 
 * @param schema 
 * @param ddl 
 * @param writeActions 
 * @returns 
 */
export default function combineWriteActionsWhereFilters<T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>, writeActions:WriteAction<T>[], includeDelete = true, scope:string = ''):CombineWriteActionsWhereFiltersResponse<T> {
    let errorResponse:CombineWriteActionsWhereFiltersResponse<T> | undefined;
    let filtersForExisting:WhereFilterDefinition<T>[] = writeActions.map(x => {
        if( x.payload.type==='create' ) {
            const key = ddl['.'].primary_key;
            const pkValue = safeKeyValue(x.payload.data[key], true);
            if( !pkValue ) {
                errorResponse = {
                    status: 'error', 
                    error: {
                        message: "Unknown key", 
                        failed_actions: [
                            {
                                action: x, 
                                affected_items: [], 
                                error_details: [
                                    {type: 'missing_key', primary_key: key}
                                ],
                                unrecoverable: true
                            }
                        ]
                    }
                }
                return;
            }
            const existingKeyValue:WhereFilterDefinition<T> = {
                [key]: pkValue
            }
            return scope? {[scope]: {elem_match: existingKeyValue}} : existingKeyValue;
        } else if( x.payload.type==='array_scope' ) {
            const scoped = getArrayScopeSchemaAndDDL<T>(x, schema, ddl);
            const subResult = combineWriteActionsWhereFilters(scoped.schema, scoped.ddl, [scoped.writeAction], includeDelete, (scope? scope+'.' : '')+x.payload.scope);
            if( subResult.status!=='ok' ) return subResult;
            return {AND: [x.payload.where, subResult.filter]};
        } else if( x.payload.type==='update' || (x.payload.type==='delete') && includeDelete) {
            return scope? {[scope]: {elem_match: x.payload.where}} : x.payload.where;
        }
    }).filter((x):x is WhereFilterDefinition<T> => !!x);
    if( errorResponse ) return errorResponse;

    // Strip duplicates
    const seen:Record<string, boolean> = {};
    filtersForExisting = filtersForExisting.filter(x => {
        const json = JSON.stringify(x);
        if( seen[json] ) {
            return false;
        } else {
            seen[json] = true;
            return true;
        }
    })

    
    const whereFilterForExisting:WhereFilterDefinition<T> = filtersForExisting.length>1 ? {
        OR: filtersForExisting
    } : filtersForExisting[0]

    

    return {status: 'ok', filter: filtersForExisting.length? whereFilterForExisting : undefined};
}
