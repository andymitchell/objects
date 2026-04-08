import type { MapDeepInputRule } from '../types.ts';
import type { CompiledValueRule, CompiledKeyRule, TargetMatcher } from './types.ts';

/** The output of rule compilation, ready to be passed to a walker factory. */
export type CompiledRules = {
    valueRules: CompiledValueRule[];
    keyRules: CompiledKeyRule[];
    /** True when at least one rule uses `dotprop_path`, so the walker must track paths. */
    needsPath: boolean;
};

/**
 * Convert serializable rules into an efficient internal form, once before traversal.
 *
 * Why: avoids per-node overhead — RegExp objects are compiled once,
 * target filters become closures, and rules are separated by type
 * so the walker can skip irrelevant checks.
 */
export function compileRules(rules: MapDeepInputRule[]): CompiledRules {
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
        } else if (rule.action === 'rename-key') {
            keyRules.push({
                action: 'rename-key',
                rename_to: rule.rename_to,
                matcher: matcher ?? ((_k) => false),
            });
        } else if (rule.action === 'remove-key') {
            keyRules.push({
                action: 'remove-key',
                all: rule.all ?? false,
                matcher: matcher ?? ((_k) => false),
            });
        }
    }

    return { valueRules, keyRules, needsPath };
}

/**
 * Build a TargetMatcher closure from a rule's target field.
 *
 * Why: converts the serializable target definition (exact key, substring,
 * RegExpSerializable, or dot-prop path) into a fast closure that can be
 * called per-node during traversal without re-parsing.
 *
 * @returns A matcher closure, or null if the rule has no target (applies globally).
 */
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
