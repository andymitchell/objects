import type { DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, PrimaryKeyProperties } from "../dot-prop-paths/types.ts";
import type { IfAny } from "../types.ts";
import type { EnsureRecord } from "../types.ts";
import type { OwnershipRule } from "../ownership/types.ts";


/**
 * Rules for a single list scope within a DDL.
 *
 * **Ordering:** The DDL intentionally does not prescribe a default sort order.
 * Collections default to primary-key ordering. Callers control ordering
 * dynamically via `SortAndSlice` (from `@andyrmitchell/objects/query`).
 */
type ListRulesCore<T extends Record<string, any> = Record<string, any>> = {
    /**
     * The main identifier
     */
    primary_key: IfAny<T, string, PrimaryKeyProperties<T>>,// keyof T>,
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
