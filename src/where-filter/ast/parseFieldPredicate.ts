import isPlainObject from "../../utils/isPlainObject.ts";
import { ValueComparisonRangeOperators } from "../consts.ts";
import { isOperatorKey } from "./operators.ts";
import { safeJson } from "../safeJson.ts";
import type { ValueComparisonType } from "../types.ts";
import type { ElemMatchBody, Predicate, PredicateScalar, RangeBound, RangeOperator } from "./predicate.ts";

const RANGE_OPERATOR_KEYS: ReadonlySet<string> = new Set<string>(ValueComparisonRangeOperators);

const isRangeOperator = (key: string): key is RangeOperator => RANGE_OPERATOR_KEYS.has(key);

/**
 * Parse one field condition into its {@link Predicate} tree.
 *
 * A field condition is the value a filter attaches to a field path — `'ann'`, `{$gt: 5, $lt: 10}`,
 * `{$not: {$exists: true}}`, `['a','b']`, or a sub-document. This function decides, once, what such a value
 * means; the engines then only decide how to ask their store.
 *
 * @param condition A field condition that has already passed the filter validity gate.
 * @returns The tree. A payload carrying several operators becomes an `and` whose children are those operators,
 *   with the range bounds first so a wrong-typed bound is judged before a later operator can mask it.
 * @throws If `condition` is not a shape the filter language admits — which a gated filter never is.
 *
 * @example
 * parseFieldPredicate('ann');                  // { kind: 'scalar', value: 'ann' }
 * parseFieldPredicate({ $gt: 5, $lt: 10 });    // { kind: 'range', bounds: [ … ] }   — one predicate, not two
 * parseFieldPredicate({ $ne: 9, $gt: 5 });     // { kind: 'and', children: [ range, ne ] }
 * parseFieldPredicate({ $not: { $ne: 9, $gt: 5 } });   // { kind: 'not', inner: { kind: 'and', … } }
 *
 * @remarks
 * `$regex` and its `$options` form a single `regex` predicate: options tune the pattern rather than constrain
 * the value separately, and `$options` alone is not a predicate at all.
 */
export function parseFieldPredicate(condition: unknown): Predicate {
    if (condition === undefined) return { kind: 'undefinedField' };
    if (condition === null) return { kind: 'scalar', value: null };
    if (typeof condition === 'string' || typeof condition === 'number' || typeof condition === 'boolean') {
        return { kind: 'scalar', value: condition };
    }
    if (Array.isArray(condition)) return { kind: 'exactArray', value: condition };
    if (!isPlainObject(condition)) throw new Error(`Unknown filter shape: ${safeJson(condition)}`);

    const payload: Record<string, unknown> = condition;
    const keys = Object.keys(payload);
    if (!keys.some(isOperatorKey)) return { kind: 'compoundObject', filter: condition };

    const children: Predicate[] = [];

    // The range bounds are one predicate, and they lead: a bound whose operand is not comparable must be
    // reached before any operator that could short-circuit past it.
    const bounds: RangeBound[] = keys.filter(isRangeOperator).map(operator => ({ operator, operand: payload[operator] }));
    if (bounds.length > 0) children.push({ kind: 'range', bounds });

    for (const key of keys) {
        if (key === '$options' || isRangeOperator(key)) continue; // $options travels with $regex; bounds are grouped above
        children.push(parseOperator(key, payload[key], payload));
    }

    return children.length === 1 ? children[0]! : { kind: 'and', children };
}

function parseOperator(key: string, operand: unknown, payload: Record<string, unknown>): Predicate {
    switch (key) {
        case '$eq': return { kind: 'eq', operand: asScalar(key, operand) };
        case '$ne': return { kind: 'ne', operand };
        case '$in': return { kind: 'in', operand: asArray(key, operand) };
        case '$nin': return { kind: 'nin', operand: asArray(key, operand) };
        case '$regex': return typeof payload.$options === 'string'
            ? { kind: 'regex', pattern: asString(key, operand), options: payload.$options }
            : { kind: 'regex', pattern: asString(key, operand) };
        case '$exists': return { kind: 'exists', expected: operand === true };
        case '$type': return { kind: 'type', typeName: asTypeName(operand) };
        case '$size': return { kind: 'size', n: asNumber(key, operand) };
        case '$all': return { kind: 'all', elements: asArray(key, operand) };
        case '$not': return { kind: 'not', inner: parseFieldPredicate(operand) };
        case '$elemMatch': return { kind: 'elemMatch', body: parseElemMatchBody(operand) };
        default: throw new Error(`Unknown filter shape: operator ${key} in ${safeJson(payload)}`);
    }
}

/**
 * An `$elemMatch` body serves two readings at once, because an array's elements need not share a shape: an
 * object element is matched as a sub-document, a scalar element as a value predicate. Both readings are derived
 * here so the choice at evaluation time is a lookup rather than a re-parse.
 */
function parseElemMatchBody(body: unknown): ElemMatchBody {
    return {
        scalarPredicate: parseElemMatchScalarPredicate(body),
        objectFilter: isPlainObject(body) ? body : undefined,
    };
}

const FIELD_LEVEL_OPERATORS: ReadonlySet<string> = new Set(['$exists', '$type']);

/**
 * `$exists` and `$type` ask whether a *field* is present and what type it holds. An array element is neither:
 * it exists by virtue of being an element, and its type is a property of the array's contents. A body resting on
 * one of them therefore describes no element, and is compared as data — which nothing matches.
 *
 * Both operators keep their ordinary meaning under `$not` inside the body, where they interrogate the element's
 * own value rather than a field's presence.
 */
function parseElemMatchScalarPredicate(body: unknown): Predicate {
    if (isPlainObject(body) && Object.keys(body).some(key => FIELD_LEVEL_OPERATORS.has(key))) {
        return { kind: 'compoundObject', filter: body };
    }
    return parseFieldPredicate(body);
}

const TYPE_NAMES: ReadonlySet<string> = new Set<ValueComparisonType['$type']>(['string', 'number', 'bool', 'object', 'array', 'null']);

const asScalar = (key: string, operand: unknown): PredicateScalar => {
    if (operand === null || typeof operand === 'string' || typeof operand === 'number' || typeof operand === 'boolean') return operand;
    throw new Error(`Unknown filter shape: ${key} requires a scalar operand, got ${safeJson(operand)}`);
};
const asArray = (key: string, operand: unknown): unknown[] => {
    if (!Array.isArray(operand)) throw new Error(`Unknown filter shape: ${key} requires an array operand, got ${safeJson(operand)}`);
    return operand;
};
const asString = (key: string, operand: unknown): string => {
    if (typeof operand !== 'string') throw new Error(`Unknown filter shape: ${key} requires a string operand, got ${safeJson(operand)}`);
    return operand;
};
const asNumber = (key: string, operand: unknown): number => {
    if (typeof operand !== 'number') throw new Error(`Unknown filter shape: ${key} requires a number operand, got ${safeJson(operand)}`);
    return operand;
};
const asTypeName = (operand: unknown): ValueComparisonType['$type'] => {
    if (typeof operand === 'string' && TYPE_NAMES.has(operand)) return operand as ValueComparisonType['$type'];
    throw new Error(`Unknown filter shape: $type requires one of ${[...TYPE_NAMES].join(', ')}, got ${safeJson(operand)}`);
};
