import { z } from "zod";
import safeKeyValue from "../getKeyValue";
import { WhereFilterDefinition } from "../where-filter";
import { DDL } from "./applyWritesToItems";
import { getArrayScopeSchemaAndDDL } from "./applyWritesToItems/helpers/getArrayScopeItemActions";
import { WriteAction } from "./types";

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
export default function combineWriteActionsWhereFilters<T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>, writeActions:WriteAction<T>[], includeDelete = true):WhereFilterDefinition<T> | undefined {
    const filtersForExisting:WhereFilterDefinition<T>[] = writeActions.map(x => {
        if( x.payload.type==='create' ) {
            const key = ddl['.'].primary_key;
            const existingKeyValue:WhereFilterDefinition<T> = {
                [key]: safeKeyValue(x.payload.data[key])
            }
            return existingKeyValue;
        } else if( x.payload.type==='array_scope' ) {
            const scoped = getArrayScopeSchemaAndDDL<T>(x.payload, schema, ddl);
            const filter = combineWriteActionsWhereFilters(scoped.schema, scoped.ddl, scoped.writeActions);
            return filter;
        } else if( x.payload.type==='update' || (x.payload.type==='delete') && includeDelete) {
            return x.payload.where;
        }
    }).filter((x):x is WhereFilterDefinition<T> => !!x);
    const whereFilterForExisting:WhereFilterDefinition<T> = {
        OR: filtersForExisting
    }

    return filtersForExisting.length? whereFilterForExisting : undefined;
}