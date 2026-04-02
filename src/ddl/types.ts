import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, PrimaryKeyProperties } from "../dot-prop-paths/types.ts";
import type { IfAny } from "../types.ts";
import type { EnsureRecord } from "../types.ts";
import type { OwnershipRule } from "../ownership/types.ts";
import type { SortEntry } from "../query/types.ts";


/**
 * Rules for a single list scope within a DDL.
 *
 */
type ListRulesCore<T extends Record<string, any> = Record<string, any>> = {
    /**
     * The main identifier
     */
    primary_key: IfAny<T, string, PrimaryKeyProperties<T>>,// keyof T>,

    /**
     * This is the natural order a collection will return items in via `get`.
     * 
     * If not provided, it's assumed to be primary-key ordering. 
     * 
     * But some collections can't do that - e.g. a bridge to the Gmail API must use the only ordering it provides (timestamp).
     * 
     * Callers control ordering dynamically in `get` by `SortAndSlice` (from `@andyrmitchell/objects/query`).
     */
    default_ordering_key?: SortEntry<T>
}

type DDLRoot<T extends Record<string, any> = Record<string, any>> = {
    version: number,
    /** Declarative ownership hint — not necessarily enforced by every implementation. */
    ownership: OwnershipRule<T>
}
export type ListRules<T extends Record<string, any> = Record<string, any>> = ListRulesCore<T>


export type DDL<T extends Record<string, any>> =
    IfAny<
    T,
    {lists: {
        '.': ListRules<any>;
    }} & DDLRoot<T>,
    {lists:
        {
            [K in DotPropPathToObjectArraySpreadingArrays<T>]: ListRules<EnsureRecord<DotPropPathValidArrayValue<T, K>>>
        } & {
            '.': ListRules<T>;
        }
     } & DDLRoot<T>
    >

export type { DDLRoot, ListRulesCore }
