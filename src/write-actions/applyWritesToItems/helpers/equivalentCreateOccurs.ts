import { z } from "zod";
import type { DDL } from "../types.js";
import type { WriteAction } from "../../types.js";
import { isMatch } from "lodash-es";
import {writeToItemsArray} from "../applyWritesToItems.js";


/**
 * Checks whether a duplicate-PK create can be silently skipped because the
 * batch will converge the created item to a state compatible with the
 * existing item (`'if-convergent'` recovery).
 *
 * **Algorithm:**
 * 1. Start with the create payload as the "simulated" item.
 * 2. Walk every subsequent action in the batch, applying each to the
 *    simulated item via `writeToItemsArray`.
 * 3. **Before** each application, check `isMatch(existing, simulated)` —
 *    i.e. is every property of the simulated item present (and equal) in the
 *    existing item? This is a *subset* check, not strict equality.
 * 4. If the check passes at any step, the create is recoverable → return `true`.
 * 5. If a subsequent action fails (schema error, etc.), recovery is impossible → return `false`.
 * 6. After all actions, perform a final subset check.
 *
 * **Why subset (`isMatch`) instead of strict equality (`isEqual`)?**
 * A create of `{id:'1'}` should not fail against an existing `{id:'1', text:'hello'}`
 * — it doesn't contradict anything. The existing item simply has additional
 * properties the create never claimed to set.
 *
 * @example
 * // existing = {id:'1', text:'hello'}
 * // batch = [create {id:'1', text:'wrong'}, update {text:'hello'}]
 * // Step 0: simulated = {id:'1', text:'wrong'} — isMatch fails ('wrong' ≠ 'hello')
 * // Step 1: apply update → simulated = {id:'1', text:'hello'} — isMatch passes → true
 */
export default function equivalentCreateOccurs<T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>, existing:Readonly<T>, createAction:WriteAction<T>, writeActions:WriteAction<T>[]):boolean {
    if( createAction.payload.type!=='create' ) throw new Error("noop - createAction must be a createAction");
    const idx = writeActions.findIndex(x => x===createAction);
    if( idx===-1 ) throw new Error("noop - createAction is expected to be the in-memory entry of writeActions");

    const writeActionsAfterCreate = writeActions.slice(idx+1);

    let current:T = createAction.payload.data;
    for( const action of writeActionsAfterCreate ) {
        // Subset check: every key in `current` exists and equals in `existing`.
        if( isMatch(existing, current) ) {
            return true;
        } else {
            const result = writeToItemsArray([action], [current], schema, ddl);
            if( !result.ok ) return false;
            current = result.changes.final_items[0] as T
        }
    }
    return isMatch(existing, current);
}