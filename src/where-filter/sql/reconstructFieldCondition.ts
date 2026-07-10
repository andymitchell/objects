import type { ElemMatchBody, Predicate } from "../ast/index.ts";
import type { WhereFilterDefinition } from "../types.ts";

/**
 * Render a parsed predicate back into the field condition it came from.
 *
 * Parsing a field condition normalises it — a multi-operator payload becomes a conjunction, range bounds merge
 * into one node — so an emitter that hands a condition back to the filter compiler (rather than to its own
 * operator emitters) cannot simply keep the original: once a conjunction is split, each part must stand alone.
 * This reverses the parse for those parts.
 *
 * @param predicate A predicate parsed from a field condition.
 * @returns An equivalent field condition. A conjunction merges its children into one payload, exactly like the
 *   payload they were parsed from.
 * @throws If the predicate describes a bare value rather than an operator payload. A bare value is not a filter,
 *   and the callers that need a filter never hold one.
 *
 * @example
 * reconstructFieldCondition({ kind: 'range', bounds: [{ operator: '$gt', operand: 5 }] });  // { $gt: 5 }
 * reconstructFieldCondition({ kind: 'not', inner: { kind: 'ne', operand: 9 } });            // { $not: { $ne: 9 } }
 */
export function reconstructFieldCondition(predicate: Predicate): WhereFilterDefinition {
    switch (predicate.kind) {
        case 'and': return Object.assign({}, ...predicate.children.map(reconstructFieldCondition));
        case 'compoundObject': return predicate.filter;
        case 'eq': return { $eq: predicate.operand };
        case 'ne': return { $ne: predicate.operand };
        case 'in': return { $in: [...predicate.operand] };
        case 'nin': return { $nin: [...predicate.operand] };
        case 'range': return Object.fromEntries(predicate.bounds.map(bound => [bound.operator, bound.operand]));
        case 'regex': return predicate.options === undefined
            ? { $regex: predicate.pattern }
            : { $regex: predicate.pattern, $options: predicate.options };
        case 'exists': return { $exists: predicate.expected };
        case 'type': return { $type: predicate.typeName };
        case 'size': return { $size: predicate.n };
        case 'all': return { $all: [...predicate.elements] };
        case 'not': return { $not: reconstructFieldCondition(predicate.inner) };
        case 'elemMatch': return { $elemMatch: elemMatchBody(predicate.body) };
        case 'scalar':
        case 'exactArray':
        case 'undefinedField':
            throw new Error(`A bare value is not an operator payload: ${predicate.kind}`);
    }
}

/** The `$elemMatch` operand, which is a whole field condition in its own right — an object, or a bare value. */
function elemMatchBody(body: ElemMatchBody): unknown {
    if (body.objectFilter !== undefined) return body.objectFilter;
    switch (body.scalarPredicate.kind) {
        case 'scalar': return body.scalarPredicate.value;
        case 'exactArray': return [...body.scalarPredicate.value];
        case 'undefinedField': return undefined;
        default: return reconstructFieldCondition(body.scalarPredicate);
    }
}
