import type { Draft } from "immer";
import type { IUser } from "../../auth/types.ts";
import type { DDL } from "../types.ts";
import type { WriteError } from "../../types.ts";
import { checkOwnership } from "../../../ownership/checkOwnership.ts";

/**
 * Internal thin wrapper — delegates to `checkOwnership` after extracting `ddl.ownership`.
 *
 * Why: keeps writeToItemsArray's call sites unchanged while the real logic lives in the ownership module.
 *
 * @example
 * const denied = checkWritePermission(item, ddl, user);
 * if (denied) console.log(denied.reason); // e.g. 'not-owner'
 */
export function checkWritePermission<T extends Record<string, any>>(item: Readonly<T> | Draft<T>, ddl: DDL<T>, user?: IUser): WriteError | undefined {
    const result = checkOwnership(item as Readonly<T>, ddl.ownership, user);
    if (!result.permitted) {
        return { type: 'permission_denied', reason: result.reason };
    }
    return undefined;
}
