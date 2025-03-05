import { z } from "zod";
import type { DDL } from "../types.js";
import type { WriteAction } from "../../types.js";
import { isMatch } from "lodash-es";
import applyWritesToItems from "../applyWritesToItems.js";


export default function equivalentCreateOccurs<T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>, existing:Readonly<T>, createAction:WriteAction<T>, writeActions:WriteAction<T>[]):boolean {
    if( createAction.payload.type!=='create' ) throw new Error("noop - createAction must be a createAction");
    // Find the start index
    const idx = writeActions.findIndex(x => x===createAction);
    if( idx===-1 ) throw new Error("noop - createAction is expected to be the in-memory entry of writeActions");

    const writeActionsAfterCreate = writeActions.slice(idx+1);

    // Iterate over each action in turn, and if at any point the item equals existing, it passes
    let current:T = createAction.payload.data;
    for( const action of writeActionsAfterCreate ) {
        // Use isMatch instead of isEqual to test if current is a subset of existing. I.e. if I create {a:1}, and later it becomes {a:1, b:1}, technically my create was ok. 
        if( isMatch(existing, current) ) {
            return true;
        } else {
            const result = applyWritesToItems([action], [current], schema, ddl);
            if( result.status==='error' ) return false;
            current = result.changes.final_items[0] as T
        }
    }
    return isMatch(existing, current);
}