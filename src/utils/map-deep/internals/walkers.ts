import isPlainObject from '../../isPlainObject.ts';
import type { CompiledValueRule, CompiledKeyRule, Walker } from './types.ts';
import { DANGEROUS_KEYS } from './types.ts';

/**
 * Create an optimised walker for the common case: a single `replace-value` rule with no target.
 *
 * Why: inlines the `=== current` check directly into the recursive closure,
 * bypassing the rule iteration and matcher overhead of the general walker.
 * Benchmarked at ~7% overhead vs raw hand-written COW (vs ~22% for the general path).
 */
export function createFastWalker(
    current: string | boolean | number | null,
    replace: string | boolean | number | null,
): Walker {
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

/**
 * Create a walker that handles all rule types: value replacement, string replacement,
 * key renaming, and key removal. Uses copy-on-write — only allocates new objects/arrays
 * along the path from root to each changed leaf.
 *
 * Why: the closure captures `valueRules`, `keyRules`, and `needsPath` so they don't
 * need to be passed as arguments on every recursive call.
 *
 * @param valueRules - Compiled rules for leaf value transformations.
 * @param keyRules - Compiled rules for key rename/removal (first-match per rule per object).
 * @param needsPath - When true, builds dot-prop paths during traversal for path-based matching.
 */
export function createGeneralWalker(
    valueRules: CompiledValueRule[],
    keyRules: CompiledKeyRule[],
    needsPath: boolean,
): Walker {
    return function generalWalk(node: unknown): unknown {
        return walk(node, '', undefined);
    };

    function walk(node: unknown, key: string, path: string | undefined): unknown {
        // Leaf: apply value rules in sequence (rule N's output feeds rule N+1)
        if (node === null || typeof node !== 'object') {
            return applyValueRules(node, key, path, valueRules);
        }

        // Array: COW iterate — only copy when a child changes
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

        // Non-plain objects (Date, RegExp, class instances): pass through by reference
        if (!isPlainObject(node)) return node;

        // Plain object: apply key rules then recurse into values
        let copy: Record<string, unknown> | undefined;
        const keys = Object.keys(node);

        // Track which key rules have fired in this object (first-match semantics)
        const firedKeyRules: Set<CompiledKeyRule> | undefined =
            keyRules.length > 0 ? new Set() : undefined;

        for (const objKey of keys) {
            const childPath = needsPath ? (path ? `${path}.${objKey}` : objKey) : undefined;

            let effectiveKey = objKey;
            let removed = false;

            if (firedKeyRules) {
                for (const keyRule of keyRules) {
                    // Skip rules that already fired (first-match), unless remove with all: true
                    if (firedKeyRules.has(keyRule) && !(keyRule.action === 'remove-key' && keyRule.all)) continue;
                    if (!keyRule.matcher(objKey, childPath)) continue;

                    if (keyRule.action === 'remove-key') {
                        removed = true;
                        if (!copy) copy = { ...node };
                        delete copy[objKey];
                        if (!keyRule.all) firedKeyRules.add(keyRule);
                        break;
                    } else if (keyRule.action === 'rename-key') {
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

/**
 * Apply all compiled value rules to a leaf node in sequence.
 * Each rule's output becomes the next rule's input, enabling rule chaining.
 */
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
