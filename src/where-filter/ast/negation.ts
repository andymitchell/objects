import type { Predicate } from "./predicate.ts";

/**
 * The positive condition a negating predicate denies, or `undefined` if the predicate is not a negation.
 *
 * `$ne` and `$nin` are spellings of `$not` over `$eq` and `$in`, so all three reduce to one question: what would
 * have had to match for this predicate to fail?
 *
 * This matters on a path that descends through an array, where a field reaches many values rather than one. A
 * positive condition holds when SOME of them satisfies it; a negation holds only when NONE does. An engine that
 * folds a negation in with the positives asks each value "do you differ?" and accepts any yes — so an array
 * holding both `'b'` and `'c'` would satisfy `{$ne: 'b'}` through its `'c'`, and return a document the caller
 * asked to exclude. Reading the negation off the positive it denies is what keeps that from happening, and it is
 * why every engine derives it from here rather than restating the rule.
 *
 * @param predicate - Any field predicate.
 * @returns The condition to evaluate and then negate, or `undefined` when the predicate is not a negation.
 *
 * @example
 * negationCore({ kind: 'ne', operand: 'b' });   // { kind: 'eq', operand: 'b' }
 * negationCore({ kind: 'eq', operand: 'b' });   // undefined — nothing to deny
 *
 * @remarks
 * The core may itself be a negation (`{$not: {$ne: 'b'}}`), so a caller applies this until it returns
 * `undefined`. Each unwrapping flips the verdict, which is how a double negation comes back to the positive.
 */
export function negationCore(predicate: Predicate): Predicate | undefined {
    switch (predicate.kind) {
        case 'not': return predicate.inner;
        case 'ne': return { kind: 'eq', operand: predicate.operand };
        case 'nin': return { kind: 'in', operand: predicate.operand };
        default: return undefined;
    }
}

/**
 * Split a field condition into the positive part every engine folds over an array's leaves, and the negations
 * each engine must lift out and answer against the whole path.
 *
 * @param predicate - The field condition, which may be a conjunction of several operators.
 * @returns `positive` is the condition a single leaf must satisfy in full (absent when every operator negates);
 *   `negations` are the predicates whose verdict is decided across all leaves at once.
 *
 * @example
 * // {'items.k': {$ne: 'b', $gt: 'a'}}
 * // → positive: the range, which some ONE leaf must satisfy
 * // → negations: the $ne, which NO leaf may satisfy
 */
export function partitionNegations(predicate: Predicate): { positive?: Predicate, negations: readonly Predicate[] } {
    if (negationCore(predicate)) return { negations: [predicate] };
    if (predicate.kind !== 'and') return { positive: predicate, negations: [] };

    const negations = predicate.children.filter(child => negationCore(child));
    const positives = predicate.children.filter(child => !negationCore(child));
    if (positives.length === 0) return { negations };
    return { positive: positives.length === 1 ? positives[0]! : { kind: 'and', children: positives }, negations };
}
