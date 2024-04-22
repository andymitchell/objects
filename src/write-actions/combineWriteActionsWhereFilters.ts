import { z } from "zod";
import safeKeyValue from "../utils/getKeyValue";
import { WhereFilterDefinition } from "../where-filter";
import { DDL } from "./applyWritesToItems";
import { getArrayScopeSchemaAndDDL } from "./applyWritesToItems/helpers/getArrayScopeItemAction";
import { WriteAction } from "./types";
import { WhereFilterLogicOperators } from "../where-filter/types";

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
export default function combineWriteActionsWhereFilters<T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>, writeActions:WriteAction<T>[], includeDelete = true, scope:string = ''):WhereFilterDefinition<T> | undefined {
    let filtersForExisting:WhereFilterDefinition<T>[] = writeActions.map(x => {
        if( x.payload.type==='create' ) {
            const key = ddl['.'].primary_key;
            const existingKeyValue:WhereFilterDefinition<T> = {
                [key]: safeKeyValue(x.payload.data[key])
            }
            return scope? {[scope]: {elem_match: existingKeyValue}} : existingKeyValue;
        } else if( x.payload.type==='array_scope' ) {
            const scoped = getArrayScopeSchemaAndDDL<T>(x, schema, ddl);
            const filter = combineWriteActionsWhereFilters(scoped.schema, scoped.ddl, [scoped.writeAction], includeDelete, (scope? scope+'.' : '')+x.payload.scope);
            return {AND: [x.payload.where, filter]};
        } else if( x.payload.type==='update' || (x.payload.type==='delete') && includeDelete) {
            return scope? {[scope]: {elem_match: x.payload.where}} : x.payload.where;
        }
    }).filter((x):x is WhereFilterDefinition<T> => !!x);

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

    

    return filtersForExisting.length? whereFilterForExisting : undefined;
}
