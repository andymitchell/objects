import type { MapDeepInputRule } from './types.ts';
import { compileRules } from './internals/compile.ts';
import { createFastWalker, createGeneralWalker } from './internals/walkers.ts';

/**
 * Immutably transform deeply nested values in a JSON-serializable object using declarative rules.
 * Uses inline copy-on-write — only allocates new objects/arrays along dirty paths.
 *
 * For the common case (single replace-value, no target), a specialised fast-path
 * closure is compiled that matches raw hand-written COW performance.
 *
 * Returns `T` by default. For key-modifying rules (`rename-key`, `remove-key`)
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

    const { valueRules, keyRules, needsPath } = compileRules(rules);

    // Fast path: single replace-value, no target, no key rules
    if (
        valueRules.length === 1 &&
        keyRules.length === 0 &&
        valueRules[0]!.action === 'replace-value' &&
        valueRules[0]!.matcher === null
    ) {
        return createFastWalker(valueRules[0]!.current, valueRules[0]!.replace)(obj);
    }

    return createGeneralWalker(valueRules, keyRules, needsPath)(obj);
}
