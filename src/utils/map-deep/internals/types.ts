/** Tests whether an object key (and optionally its dot-prop path) matches a rule's target filter. */
export type TargetMatcher = (key: string, path: string | undefined) => boolean;

/** A compiled traversal function that walks a tree and returns the transformed result. */
export type Walker = (node: unknown) => unknown;

/**
 * A value rule after compilation — RegExpSerializable has been converted to RegExp,
 * and the target filter has been converted to a TargetMatcher closure.
 */
export type CompiledValueRule = {
    action: 'replace-value';
    current: string | boolean | number | null;
    replace: string | boolean | number | null;
    /** Null when the rule applies to all keys (no target filter). */
    matcher: TargetMatcher | null;
} | {
    action: 'replace-in-string-value';
    search: string | RegExp;
    replace: string;
    /** Null when the rule applies to all keys (no target filter). */
    matcher: TargetMatcher | null;
};

/**
 * A key rule after compilation — the target filter has been converted to a TargetMatcher closure.
 * Key rules always have a matcher (target is required).
 */
export type CompiledKeyRule = {
    action: 'rename-key';
    rename_to: string;
    matcher: TargetMatcher;
} | {
    action: 'remove-key';
    all: boolean;
    matcher: TargetMatcher;
};

/** Keys that must never be created via rename, to prevent prototype pollution. */
export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
