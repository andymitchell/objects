/** JSON-serializable representation of a RegExp, for use with `new RegExp(pattern, flags)`. */
export type RegExpSerializable = {
    /** The regex pattern string (e.g. `"\\d+"`) */
    pattern: string,
    /** Regex flags (e.g. `"gi"`) */
    flags: string
}

/** JSON-serializable leaf value types. */
export type ValueTypes = string | boolean | number | null;

/** Optional filter to narrow a rule to specific object keys. Exactly one mechanism may be used. */
export type Target = {
    /** When provided, the rule only applies to values/keys matching this filter. */
    target?: {
        /** Match by exact key name. */
        key: string,
        search_key?: never
        dotprop_path?: never
    } | {
        key?: never,
        /** Match keys containing this substring or matching this pattern. */
        search_key: string | RegExpSerializable
        dotprop_path?: never
    } | {
        key?: never,
        search_key?: never
        /** Match by dot-separated path from root (e.g. `"config.auth.provider"`). */
        dotprop_path: string
    }
}

/**
 * A single transformation rule applied during a deep walk.
 *
 * Performance notes:
 * - `replace-value` is fastest — uses `===` identity check per leaf.
 * - RegExp rules are compiled once before traversal.
 *
 * Key rules (`rename-property`, `remove-property`) use first-match semantics:
 * when multiple keys in the same object match, only the first encountered key is affected.
 */
export type MapDeepInputRule = Target & {
    /** Replace a leaf value that exactly equals `current` with `replace`. */
    action: 'replace-value',
    /** The exact leaf value to match. */
    current: ValueTypes,
    /** The value to substitute. */
    replace: ValueTypes
} |
Target & {
    /** Replace a substring/pattern within string leaf values, like `String.replace`. First match in value only unless the RegExp uses the `g` flag. */
    action: 'replace-in-string-value',
    /** The substring or pattern to find within each string leaf. */
    search: string | RegExpSerializable,
    /** The replacement string. Supports regex capture groups (e.g. `$1`) when `search` is a RegExpSerializable. */
    replace: string
} |
Required<Target> & {
    /** Rename the first matching object key. Overwrites if the new key already exists. */
    action: 'rename-property',
    /** The new key name. */
    rename_to: string
} |
Required<Target> & {
    /** Remove the first matching object key and its value. Set `all` to remove every match. */
    action: 'remove-property',
    /** When true, removes all matching keys instead of just the first. Default: false. */
    all?: boolean
}

/** Value-only rules that preserve the object shape (no key modifications). */
export type MapDeepValueRule = Extract<MapDeepInputRule, { action: 'replace-value' | 'replace-in-string-value' }>;

/** Ordered list of rules to apply during a deep walk. Rules are applied sequentially — earlier rules' output feeds into later rules. */
export type MapDeepInput = MapDeepInputRule[]
