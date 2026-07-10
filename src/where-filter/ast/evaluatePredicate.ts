import deepEql from "deep-eql";
import isPlainObject from "../../utils/isPlainObject.ts";
import type { ValueComparisonType, WhereFilterDefinition } from "../types.ts";
import type { Predicate, RangeBound, RangeOperator } from "./predicate.ts";

/**
 * Match an object element against a sub-filter. Supplied by the caller because a sub-filter is a whole filter,
 * whose evaluation belongs to the matcher rather than to a single field's predicate.
 */
export type SubFilterMatcher = (element: Record<string, unknown>, filter: WhereFilterDefinition) => boolean;

type RangeCompare = <X extends number | string>(value: X, bound: X) => boolean;
const RANGE_COMPARES: Readonly<Record<RangeOperator, RangeCompare>> = {
    '$gt': (value, bound) => value > bound,
    '$lt': (value, bound) => value < bound,
    '$gte': (value, bound) => value >= bound,
    '$lte': (value, bound) => value <= bound,
};

/**
 * Evaluate a field predicate against the value stored at that field.
 *
 * An engine-neutral tree meets one concrete value here. The value's own runtime shape chooses the reading: an
 * array field asks for containment where a scalar field asks for equality, which is how MongoDB behaves and why
 * `{owner: 'a'}` matches both `'a'` and `['a','b']`.
 *
 * @param value The stored value, or `undefined` when the field is absent.
 * @param predicate The parsed field condition.
 * @param matchSubFilter Applies a sub-filter to an object element of an array.
 * @returns Whether the value satisfies the predicate.
 * @throws If a range bound's operand is not a string or number — a broken filter rather than a non-matching row.
 *
 * @example
 * evaluatePredicate(30, { kind: 'range', bounds: [{ operator: '$gte', operand: 18 }] }, m);  // true
 * evaluatePredicate(undefined, { kind: 'ne', operand: 5 }, m);                               // true — absent differs from 5
 *
 * @remarks
 * A range bound against a value of another type does not match, and does not error: comparison operators
 * *type-bracket*, so a wrong-typed row is simply not in the answer. Only a bound whose own operand is
 * uncomparable is an error, because that is a defect in the filter.
 */
export function evaluatePredicate(value: unknown, predicate: Predicate, matchSubFilter: SubFilterMatcher): boolean {
    switch (predicate.kind) {
        case 'and':
            return predicate.children.every(child => evaluatePredicate(value, child, matchSubFilter));

        // $exists and $type read the value itself, whatever its shape. An explicit `null` is a present value.
        case 'exists':
            return predicate.expected ? value !== undefined : value === undefined;
        case 'type':
            return matchesJsType(value, predicate.typeName);

        // Negation complements its operand — including on a missing field, where the operand decides.
        case 'not':
            return !evaluatePredicate(value, predicate.inner, matchSubFilter);

        case 'undefinedField':
            return Array.isArray(value) && value.indexOf(undefined) > -1;

        case 'scalar':
            if (Array.isArray(value)) return value.indexOf(predicate.value) > -1;
            if (predicate.value === null) return value === null || value === undefined;
            return value === predicate.value;

        case 'exactArray':
            return Array.isArray(value) && deepEql(value, predicate.value);

        case 'compoundObject':
            return Array.isArray(value)
                ? value.some(element => isPlainObject(element) && matchSubFilter(element, predicate.filter))
                : deepEql(value, predicate.filter);

        // $in / $nin read an array field as a set: they intersect it rather than compare it whole.
        case 'in':
            if (Array.isArray(value)) return predicate.operand.some(operand => value.includes(operand));
            if (value === undefined || value === null) return false;
            return predicate.operand.includes(value);
        case 'nin':
            if (Array.isArray(value)) return !predicate.operand.some(operand => value.includes(operand));
            if (value === undefined || value === null) return true;
            return !predicate.operand.includes(value);

        case 'size':
            return Array.isArray(value) && value.length === predicate.n;
        case 'all':
            return Array.isArray(value) && predicate.elements.every(operand => value.some(element => deepEql(element, operand)));
        case 'elemMatch': {
            if (!Array.isArray(value)) return false;
            const { scalarPredicate, objectFilter } = predicate.body;
            return value.some(element => (isPlainObject(element) && objectFilter !== undefined)
                ? matchSubFilter(element, objectFilter)
                : evaluatePredicate(element, scalarPredicate, matchSubFilter));
        }

        // The scalar operators. Against an array field they read as a sub-document match over its elements,
        // the same reading a bare sub-document gets, because the operator does not describe the array itself.
        case 'eq':
            if (Array.isArray(value)) return matchesElementsAsSubFilter(value, { $eq: predicate.operand }, matchSubFilter);
            if (predicate.operand === null) return value === null || value === undefined;
            if (value === undefined || value === null) return false;
            return value === predicate.operand;
        case 'ne':
            if (Array.isArray(value)) return matchesElementsAsSubFilter(value, { $ne: predicate.operand }, matchSubFilter);
            if (value === undefined || value === null) return true;
            return value !== predicate.operand;
        case 'regex':
            if (Array.isArray(value)) return matchesElementsAsSubFilter(value, rebuildRegexPayload(predicate), matchSubFilter);
            if (typeof value !== 'string') return false;
            return new RegExp(predicate.pattern, predicate.options).test(value);
        case 'range':
            if (Array.isArray(value)) return matchesElementsAsSubFilter(value, rebuildRangePayload(predicate.bounds), matchSubFilter);
            if (typeof value !== 'number' && typeof value !== 'string') return false;
            return predicate.bounds.every(bound => satisfiesBound(value, bound));
    }
}

/**
 * Whether a predicate matches a field that is absent.
 *
 * A store that compiles a filter into a query must decide, before it sees any row, what an absent field means
 * for each operator: `$ne` and `$nin` match it, `$eq: null` matches it, `$in` and a range do not. That decision
 * is the evaluator's answer for `undefined`, so it is taken from the evaluator rather than restated as a table
 * a second implementation could drift from.
 *
 * @param predicate The parsed field condition.
 * @returns Whether a row lacking the field satisfies it.
 * @example
 * matchesMissingField({ kind: 'ne', operand: 5 });                              // true
 * matchesMissingField({ kind: 'not', inner: { kind: 'ne', operand: 5 } });      // false
 */
export function matchesMissingField(predicate: Predicate): boolean {
    return evaluatePredicate(undefined, predicate, unreachableSubFilterMatcher);
}

/**
 * A sub-filter is only ever applied to an element of an array, and a missing field holds no array, so
 * {@link matchesMissingField} can never reach one. Reaching this is a bug in the evaluator, not in a filter.
 */
const unreachableSubFilterMatcher: SubFilterMatcher = () => {
    throw new Error('evaluatePredicate: a missing field cannot hold array elements to match a sub-filter against');
};

/** Whether a value's runtime type is the one `$type` names. A missing field is reported as `null`. */
function matchesJsType(value: unknown, typeName: ValueComparisonType['$type']): boolean {
    if (value === undefined || value === null) return typeName === 'null';
    switch (typeName) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number';
        case 'bool': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return isPlainObject(value) && !Array.isArray(value);
        case 'null': return false;
    }
}

/** Read an array field's elements as sub-documents, matching the operator payload against each in turn. */
function matchesElementsAsSubFilter(value: unknown[], payload: Record<string, unknown>, matchSubFilter: SubFilterMatcher): boolean {
    return value.some(element => isPlainObject(element) && matchSubFilter(element, payload));
}

const rebuildRegexPayload = (predicate: Predicate & { kind: 'regex' }): Record<string, unknown> =>
    predicate.options === undefined ? { $regex: predicate.pattern } : { $regex: predicate.pattern, $options: predicate.options };

const rebuildRangePayload = (bounds: readonly RangeBound[]): Record<string, unknown> =>
    Object.fromEntries(bounds.map(bound => [bound.operator, bound.operand]));

/**
 * A single range bound. A bound whose operand is not comparable is a malformed filter and throws; a bound
 * against a value of a different type simply does not match.
 */
function satisfiesBound(value: number | string, bound: RangeBound): boolean {
    const { operator, operand } = bound;
    if (typeof operand !== 'string' && typeof operand !== 'number') {
        throw new Error(`Range operator '${operator}' requires a string or number filter value, got ${typeof operand}`);
    }
    if (typeof value === 'number' && typeof operand === 'number') return RANGE_COMPARES[operator](value, operand);
    if (typeof value === 'string' && typeof operand === 'string') return RANGE_COMPARES[operator](value, operand);
    return false;
}
