import isPlainObject from "../utils/isPlainObject.js";
import { ValueOperators, ArrayOperators, ValueComparisonRangeOperators } from "./consts.ts";

// The operators that mark a value as a field condition's operator payload, as opposed to a bare scalar, an
// exact-array operand, or a compound sub-document. Sourced from the single-source operator lists.
const OPERATOR_KEYS: ReadonlySet<string> = new Set<string>([...ValueOperators, ...ArrayOperators]);
const isRangeOperator = (k: string): boolean => (ValueComparisonRangeOperators as readonly string[]).includes(k);

/**
 * Splits a field's operator payload into independent predicate groups whose conjunction is the payload's
 * meaning — MongoDB reads several operators on one field as an implicit AND. Returns `null` when the value is
 * not an operator payload (a bare scalar, an exact-array operand, or a compound sub-document), so those paths
 * keep their existing single-value handling.
 *
 * Used by the SQL emitters at the top of a field condition only. It sees a payload's outermost operators and
 * nothing else, so a payload nested inside `$not` or inside a scalar `$elemMatch` never reaches it — those the
 * emitters still dispatch by hand, and only the first operator of such a payload survives. The predicate tree
 * (`ast/parseFieldPredicate.ts`), which the in-memory matcher uses, groups a payload at every depth instead;
 * this function exists until the emitters read that tree too.
 *
 * Two operators are deliberately NOT split apart: `$regex` keeps its `$options` (options tunes the pattern,
 * it is not a predicate of its own), and the range operators (`$gt`/`$gte`/`$lt`/`$lte`) stay one group so a
 * mixed-type bound is handled exactly as a lone range payload would be. Every other operator becomes its own
 * single-key group.
 *
 * @param condition The field-condition value to inspect.
 * @returns One record per predicate group (order: range group first, then remaining operators in key order),
 *   or `null` if `condition` is not an operator payload.
 * @example
 * splitIntoPredicateGroups({ $exists: true, $ne: 'x' });   // [{ $exists: true }, { $ne: 'x' }]
 * splitIntoPredicateGroups({ $gt: 5, $lt: 10 });           // [{ $gt: 5, $lt: 10 }]  (range stays one group)
 * splitIntoPredicateGroups('alice');                       // null  (a bare scalar, not an operator payload)
 */
export function splitIntoPredicateGroups(condition: unknown): Record<string, unknown>[] | null {
    if (!isPlainObject(condition)) return null;
    const payload = condition as Record<string, unknown>;
    const keys = Object.keys(payload);
    if (!keys.some(k => OPERATOR_KEYS.has(k))) return null;

    const groups: Record<string, unknown>[] = [];
    const rangeKeys = keys.filter(isRangeOperator);
    if (rangeKeys.length > 0) groups.push(Object.fromEntries(rangeKeys.map(k => [k, payload[k]])));

    for (const key of keys) {
        if (key === '$options' || isRangeOperator(key)) continue; // $options travels with $regex; range grouped above
        if (key === '$regex') {
            groups.push('$options' in payload ? { $regex: payload.$regex, $options: payload.$options } : { $regex: payload.$regex });
        } else {
            groups.push({ [key]: payload[key] });
        }
    }
    return groups;
}
