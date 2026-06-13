import type {
  DotPropPathsUnion,
  DotPropPathToObjectArraySpreadingArrays,
  DotPropPathValidArrayValue,
  PrimaryKeyProperties,
} from "../dot-prop-paths/types.ts";
import type { IfAny } from "../types.ts";
import type { EnsureRecord } from "../types.ts";
import type { SortEntry } from "../query/types.ts";

/**
 * One entry in a list's `sortable_keys` allowlist: a permitted sort key, optionally
 * restricted to a single direction.
 *
 * - `{ key }` (direction omitted) — sortable in **both** directions.
 * - `{ key, direction: 1 }` — ascending only.
 * - `{ key, direction: -1 }` — descending only.
 *
 * Mirrors `SortEntry<T>`'s shape (`1 = asc, -1 = desc`) but carries **allow-semantics**
 * (which directions are permitted) rather than `SortEntry`'s **sort-this-way** instruction —
 * so it is intentionally a separate type, not derived from `SortEntry`.
 */
export type SortableKeyRule<T extends Record<string, any> = Record<string, any>> = {
  key: DotPropPathsUnion<T>;
  direction?: 1 | -1;
};

/**
 * Rules for a single list scope within a DDL.
 *
 */
type ListRulesCore<T extends Record<string, any> = Record<string, any>> = {
  /**
   * The main identifier
   */
  primary_key: IfAny<T, string, PrimaryKeyProperties<T>>; // keyof T>,

  /**
   * This is the natural order that objects sort into.
   *
   * There must always be a natural order to provide stability across pages.
   * It cannot be assumed to be Primary Key (some implementations don't support sorting by it, e.g. Gmail API Bridge).
   *
   * See more discussion in ICollection's spec under `dec-sorting-default-ordering-required`
   *
   */
  default_ordering_key?: SortEntry<T>;

  /**
   * Allowlist of permitted sort keys, each a {@link SortableKeyRule} (`{ key, direction? }`).
   *
   * - Omit (= undefined): arbitrary — any key on T, multi-key, both directions.
   * - `[]`: no user-driven sort accepted; the consuming ICollection returns its native order
   *   (e.g. Gmail bridge — Gmail API only accepts timestamp DESC, surfaced via cursor pagination).
   * - `[<rules>]`: restricted to those keys. Each rule's `direction` is optional: omit it to allow
   *   both directions, or set `1` (asc-only) / `-1` (desc-only) to restrict that key.
   *
   * `direction` is a static pre-flight hint only; the consuming ICollection's runtime
   * `'unsupported-ordering'` error response stays the enforcement — a sort on an unlisted key, or
   * in a direction the rule excludes, is rejected there. This keeps the declaration inspectable
   * while the runtime safety net catches anything that slips through.
   *
   * Drives the standard sort tests in `@andyrmitchell/objects/query/standardTests.ts` (which gate
   * per-test via `it.skip` when a test's sort isn't in this allowlist), and lets consumers
   * pre-validate before calling `get` / `keys`.
   */
  sortable_keys?: ReadonlyArray<SortableKeyRule<T>>;
};

type DDLRoot<T extends Record<string, any> = Record<string, any>> = {
  version: number;
};
export type ListRules<T extends Record<string, any> = Record<string, any>> =
  ListRulesCore<T>;

/**
 * Rules for a DDL's root `"."` list, the whole-collection scope.
 *
 * Extends `ListRules` to make `default_ordering_key` mandatory: a collection's
 * natural order must be explicitly declared, never assumed (see
 * `dec-sorting-default-ordering-required`).
 */
export type RootListRules<T extends Record<string, any> = Record<string, any>> =
  ListRules<T> & Required<Pick<ListRules<T>, "default_ordering_key">>;

export type DDL<T extends Record<string, any>> = IfAny<
  T,
  {
    lists: {
      // Both `IfAny` branches must type `'.'` identically: indexing
      // `DDL<genericT>['lists']['.']` distributes over both branches, so a mismatch
      // widens the result to a poisoned `RootListRules<any> | RootListRules<T>` union.
      ".": RootListRules<T>;
    };
  } & DDLRoot<T>,
  {
    lists: {
      [K in DotPropPathToObjectArraySpreadingArrays<T>]: ListRules<
        EnsureRecord<DotPropPathValidArrayValue<T, K>>
      >;
    } & {
      ".": RootListRules<T>;
    };
  } & DDLRoot<T>
>;

export type { DDLRoot, ListRulesCore };
