import type { DotPropPathsUnion, DotPropPathToObjectArraySpreadingArrays, DotPropPathValidArrayValue, PrimaryKeyProperties } from "../dot-prop-paths/types.ts";
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
    default_ordering_key?: SortEntry<T>,

    /**
     * Whitelist of dot-prop paths permitted as sort keys.
     *
     * - Omit (= undefined): arbitrary — any key on T, multi-key, both directions.
     * - `[]`: no user-driven sort accepted; the consuming ICollection returns its native order
     *   (e.g. Gmail bridge — Gmail API only accepts timestamp DESC, surfaced via cursor pagination).
     * - `[<keys>]`: restricted to those keys. Any combination of declared keys may be used together,
     *   in either direction.
     *
     * Direction restrictions are NOT modelled here — they surface via the consuming ICollection's
     * runtime `'unsupported-ordering'` error response, not statically. This keeps the static
     * declaration small and inspectable; the runtime safety net catches anything that slips through.
     *
     * Drives the standard sort tests in `@andyrmitchell/objects/query/standardTests.ts` (which gate
     * per-test via `it.skip` when a test's sort isn't in this allowlist), and lets consumers
     * pre-validate before calling `get` / `keys`.
     */
    sortable_keys?: ReadonlyArray<DotPropPathsUnion<T>>
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
