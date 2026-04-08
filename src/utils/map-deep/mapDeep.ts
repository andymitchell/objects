import isPlainObject from '../isPlainObject.ts';
import type { MapDeepInputRule } from './types.ts';

/**
 * Immutably transform deeply nested values in a JSON-serializable object using declarative rules.
 * Uses inline copy-on-write — only allocates new objects/arrays along dirty paths.
 *
 * For the common case (single replace-value, no target), a specialised fast-path
 * closure is compiled that matches raw hand-written COW performance.
 *
 * Returns `T` by default. For key-modifying rules (`rename-property`, `remove-property`)
 * that change the object shape, specify `R` explicitly:
 * `mapDeep<Input, Output>(obj, rules)`
 *
 * @example
 * ```ts
 * const result = mapDeep(config, [
 *   { action: 'replace-value', current: '<USEREMAIL>', replace: 'alice@co.com' }
 * ]);
 * ```
 */
export function mapDeep<T, R = T>(obj: T, rules: MapDeepInputRule[]): R;
export function mapDeep(obj: unknown, rules: MapDeepInputRule[]): unknown {
    if (rules.length === 0) return obj;
    const walker = compileWalker(rules);
    return walker(obj);
}

// --- Internal types ---

type TargetMatcher = (key: string, path: string | undefined) => boolean;
type Walker = (node: unknown) => unknown;

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

// --- Dangerous key set for prototype pollution prevention ---
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- Rule compilation ---

/** Why: returns a self-contained walker closure — no struct passed per recursive call. */
function compileWalker(rules: MapDeepInputRule[]): Walker {
    const valueRules: CompiledValueRule[] = [];
    const keyRules: CompiledKeyRule[] = [];
    let needsPath = false;

    for (const rule of rules) {
        if ('target' in rule && rule.target && 'dotprop_path' in rule.target && rule.target.dotprop_path) {
            needsPath = true;
            break;
        }
    }

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
                matcher: matcher ?? ((_k) => false),
            });
        } else if (rule.action === 'remove-property') {
            keyRules.push({
                action: 'remove-property',
                all: rule.all ?? false,
                matcher: matcher ?? ((_k) => false),
            });
        }
    }

    // --- Fast path: single replace-value, no target, no key rules ---
    if (
        valueRules.length === 1 &&
        keyRules.length === 0 &&
        valueRules[0]!.action === 'replace-value' &&
        valueRules[0]!.matcher === null
    ) {
        const current = valueRules[0]!.current;
        const replace = valueRules[0]!.replace;
        // Return a specialised closure that inlines the === check
        return function fastWalk(node: unknown): unknown {
            if (node === current) return replace;
            if (node === null || typeof node !== 'object') return node;

            if (Array.isArray(node)) {
                let copy: unknown[] | undefined;
                for (let i = 0; i < node.length; i++) {
                    const child = node[i];
                    const mapped = fastWalk(child);
                    if (mapped !== child) {
                        if (!copy) copy = node.slice();
                        copy[i] = mapped;
                    }
                }
                return copy ?? node;
            }

            if (!isPlainObject(node)) return node;

            let copy: Record<string, unknown> | undefined;
            const keys = Object.keys(node);
            for (const key of keys) {
                const child = node[key];
                const mapped = fastWalk(child);
                if (mapped !== child) {
                    if (!copy) copy = { ...node };
                    copy[key] = mapped;
                }
            }
            return copy ?? node;
        };
    }

    // --- General path: closure captures compiled rules ---
    return function generalWalk(node: unknown): unknown {
        return walk(node, '', undefined);
    };

    function walk(node: unknown, key: string, path: string | undefined): unknown {
        if (node === null || typeof node !== 'object') {
            return applyValueRules(node, key, path, valueRules);
        }

        if (Array.isArray(node)) {
            let copy: unknown[] | undefined;
            for (let i = 0; i < node.length; i++) {
                const child = node[i];
                const childPath = needsPath ? (path ? `${path}.${i}` : `${i}`) : undefined;
                const mapped = walk(child, String(i), childPath);
                if (mapped !== child) {
                    if (!copy) copy = node.slice();
                    copy[i] = mapped;
                }
            }
            return copy ?? node;
        }

        if (!isPlainObject(node)) return node;

        let copy: Record<string, unknown> | undefined;
        const keys = Object.keys(node);

        const firedKeyRules: Set<CompiledKeyRule> | undefined =
            keyRules.length > 0 ? new Set() : undefined;

        for (const objKey of keys) {
            const childPath = needsPath ? (path ? `${path}.${objKey}` : objKey) : undefined;

            let effectiveKey = objKey;
            let removed = false;

            if (firedKeyRules) {
                for (const keyRule of keyRules) {
                    if (firedKeyRules.has(keyRule) && !(keyRule.action === 'remove-property' && keyRule.all)) continue;
                    if (!keyRule.matcher(objKey, childPath)) continue;

                    if (keyRule.action === 'remove-property') {
                        removed = true;
                        if (!copy) copy = { ...node };
                        delete copy[objKey];
                        if (!keyRule.all) firedKeyRules.add(keyRule);
                        break;
                    } else if (keyRule.action === 'rename-property') {
                        if (DANGEROUS_KEYS.has(keyRule.rename_to)) break;
                        effectiveKey = keyRule.rename_to;
                        firedKeyRules.add(keyRule);
                        break;
                    }
                }
            }

            if (removed) continue;

            const child = node[objKey];
            const mapped = walk(child, effectiveKey, childPath);

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

/** Why: apply all value rules to a leaf node in sequence. */
function applyValueRules(
    value: unknown,
    key: string,
    path: string | undefined,
    valueRules: CompiledValueRule[]
): unknown {
    let result = value;

    for (const rule of valueRules) {
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
