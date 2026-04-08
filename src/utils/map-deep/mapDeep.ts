import isPlainObject from '../isPlainObject.ts';
import type { MapDeepInputRule, MapDeepValueRule } from './types.ts';

/**
 * Immutably transform deeply nested values in a JSON-serializable object using declarative rules.
 * Uses inline copy-on-write — only allocates new objects/arrays along dirty paths.
 *
 * @example
 * ```ts
 * const result = mapDeep(config, [
 *   { action: 'replace-value', current: '<USEREMAIL>', replace: 'alice@co.com' }
 * ]);
 * ```
 */
export function mapDeep<T>(obj: T, rules: MapDeepValueRule[]): T;
export function mapDeep<T, R = unknown>(obj: T, rules: MapDeepInputRule[]): R;
export function mapDeep(obj: unknown, rules: MapDeepInputRule[]): unknown {
    if (rules.length === 0) return obj;

    const compiled = compileRules(rules);
    return walk(obj, '', undefined, compiled);
}

// --- Internal types ---

type TargetMatcher = (key: string, path: string | undefined) => boolean;

type CompiledValueRule = {
    action: 'replace-value';
    current: string | boolean | number | null;
    replace: string | boolean | number | null;
    matcher: TargetMatcher | null;
} | {
    action: 'replace-in-string-value';
    search: string | RegExp;
    replace: string;
    matcher: TargetMatcher | null;
};

type CompiledKeyRule = {
    action: 'rename-property';
    rename_to: string;
    matcher: TargetMatcher;
} | {
    action: 'remove-property';
    all: boolean;
    matcher: TargetMatcher;
};

type CompiledRules = {
    valueRules: CompiledValueRule[];
    keyRules: CompiledKeyRule[];
    needsPath: boolean;
};

// --- Rule compilation ---

/** Why: convert serializable rules into efficient closures once, before traversal. */
function compileRules(rules: MapDeepInputRule[]): CompiledRules {
    const valueRules: CompiledValueRule[] = [];
    const keyRules: CompiledKeyRule[] = [];
    let needsPath = false;

    // First pass: detect if any rule uses dotprop_path
    for (const rule of rules) {
        if ('target' in rule && rule.target && 'dotprop_path' in rule.target && rule.target.dotprop_path) {
            needsPath = true;
            break;
        }
    }

    // Second pass: compile all rules with matchers
    for (const rule of rules) {
        const matcher = buildMatcher(rule);

        if (rule.action === 'replace-value') {
            valueRules.push({
                action: 'replace-value',
                current: rule.current,
                replace: rule.replace,
                matcher,
            });
        } else if (rule.action === 'replace-in-string-value') {
            const search = typeof rule.search === 'object' && rule.search !== null && 'pattern' in rule.search
                ? new RegExp(rule.search.pattern, rule.search.flags)
                : rule.search as string;
            valueRules.push({
                action: 'replace-in-string-value',
                search,
                replace: rule.replace,
                matcher,
            });
        } else if (rule.action === 'rename-property') {
            keyRules.push({
                action: 'rename-property',
                rename_to: rule.rename_to,
                matcher: matcher ?? ((_k) => false), // Required<Target> ensures matcher exists
            });
        } else if (rule.action === 'remove-property') {
            keyRules.push({
                action: 'remove-property',
                all: rule.all ?? false,
                matcher: matcher ?? ((_k) => false),
            });
        }
    }

    return { valueRules, keyRules, needsPath };
}

/** Why: build a target matcher closure from a rule's target field. */
function buildMatcher(rule: MapDeepInputRule): TargetMatcher | null {
    if (!('target' in rule) || !rule.target) return null;
    const target = rule.target;

    if ('key' in target && target.key !== undefined) {
        const key = target.key;
        return (k) => k === key;
    }
    if ('search_key' in target && target.search_key !== undefined) {
        const sk = target.search_key;
        if (typeof sk === 'string') {
            return (k) => k.includes(sk);
        }
        const re = new RegExp(sk.pattern, sk.flags);
        return (k) => re.test(k);
    }
    if ('dotprop_path' in target && target.dotprop_path !== undefined) {
        const dotprop = target.dotprop_path;
        return (_k, path) => path === dotprop;
    }
    return null;
}

// --- Dangerous key set for prototype pollution prevention ---
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- COW recursive walker ---

/** Why: the core traversal — applies all compiled rules with copy-on-write semantics. */
function walk(node: unknown, key: string, path: string | undefined, compiled: CompiledRules): unknown {
    // Leaf: apply value rules
    if (node === null || typeof node !== 'object') {
        return applyValueRules(node, key, path, compiled.valueRules);
    }

    // Array: COW iterate
    if (Array.isArray(node)) {
        let copy: unknown[] | undefined;
        for (let i = 0; i < node.length; i++) {
            const child = node[i];
            const childPath = compiled.needsPath ? (path ? `${path}.${i}` : `${i}`) : undefined;
            const mapped = walk(child, String(i), childPath, compiled);
            if (mapped !== child) {
                if (!copy) copy = node.slice();
                copy[i] = mapped;
            }
        }
        return copy ?? node;
    }

    // Non-plain objects (Date, RegExp, class instances): pass through by reference
    if (!isPlainObject(node)) {
        return node;
    }

    // Plain object: apply key rules + recurse values
    let copy: Record<string, unknown> | undefined;
    const keys = Object.keys(node);

    // Track which key rules have already fired in this object (first-match semantics)
    const firedKeyRules: Set<CompiledKeyRule> | undefined =
        compiled.keyRules.length > 0 ? new Set() : undefined;

    for (const objKey of keys) {
        const childPath = compiled.needsPath ? (path ? `${path}.${objKey}` : objKey) : undefined;

        // Key rules: check rename/remove (first-match per rule per object)
        let effectiveKey = objKey;
        let removed = false;

        if (firedKeyRules) {
            for (const keyRule of compiled.keyRules) {
                // Skip rules that already fired (first-match), unless remove with all: true
                if (firedKeyRules.has(keyRule) && !(keyRule.action === 'remove-property' && keyRule.all)) continue;
                if (!keyRule.matcher(objKey, childPath)) continue;

                if (keyRule.action === 'remove-property') {
                    removed = true;
                    if (!copy) copy = { ...node };
                    delete copy[objKey];
                    if (!keyRule.all) firedKeyRules.add(keyRule);
                    break; // first matching rule wins for this key
                } else if (keyRule.action === 'rename-property') {
                    if (DANGEROUS_KEYS.has(keyRule.rename_to)) break; // block prototype pollution
                    effectiveKey = keyRule.rename_to;
                    firedKeyRules.add(keyRule);
                    break; // first matching rule wins for this key
                }
            }
        }

        if (removed) continue;

        // Recurse into value
        const child = node[objKey];
        const mapped = walk(child, effectiveKey, childPath, compiled);

        if (effectiveKey !== objKey || mapped !== child) {
            if (!copy) copy = { ...node };
            if (effectiveKey !== objKey) {
                delete copy[objKey];
            }
            copy[effectiveKey] = mapped;
        }
    }

    return copy ?? node;
}

/** Why: apply all value rules to a leaf node in sequence. */
function applyValueRules(
    value: unknown,
    key: string,
    path: string | undefined,
    valueRules: CompiledValueRule[]
): unknown {
    let result = value;

    for (const rule of valueRules) {
        // Check target matcher
        if (rule.matcher && !rule.matcher(key, path)) continue;

        if (rule.action === 'replace-value') {
            if (result === rule.current) {
                result = rule.replace;
            }
        } else if (rule.action === 'replace-in-string-value') {
            if (typeof result === 'string') {
                result = result.replace(rule.search as string & RegExp, rule.replace);
            }
        }
    }

    return result;
}
