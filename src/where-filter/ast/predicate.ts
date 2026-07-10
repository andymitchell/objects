import type { ValueComparisonRangeOperators } from "../consts.ts";
import type { ValueComparisonType, WhereFilterDefinition } from "../types.ts";

/** A bare field value, and the operand of `$eq`. `null` is a value in its own right, distinct from missing. */
export type PredicateScalar = string | number | boolean | null;

export type RangeOperator = typeof ValueComparisonRangeOperators[number];

/** One bound of a range predicate. The operand is untrusted: the evaluator rejects a non-comparable one. */
export type RangeBound = { readonly operator: RangeOperator; readonly operand: unknown };

/** The two readings of an `$elemMatch` body, chosen per element by the element's own runtime shape. */
export type ElemMatchBody = {
    /** Applied to a scalar element. */
    readonly scalarPredicate: Predicate;
    /** Applied to an object element, as a sub-filter over that element's fields. Absent for a scalar body. */
    readonly objectFilter: WhereFilterDefinition | undefined;
};

/**
 * The meaning of one field condition, as a tree.
 *
 * A field condition is everything to the right of a field path in a filter — a bare value, an operator payload,
 * or a sub-document. Parsing it into a tree separates two concerns that every engine otherwise re-solves for
 * itself: *what the filter says* (this type) and *how to ask a particular store* (the JS evaluator, the SQL
 * emitters). The shape of the tree is therefore engine-neutral and total — every accepted field condition has
 * exactly one tree, and every tree has exactly one meaning.
 *
 * Two structural rules earn their place:
 *
 *  - **Several operators on one field mean their conjunction**, so a multi-operator payload becomes `and`.
 *    This holds at every depth, including inside `$not` and inside a scalar `$elemMatch` body.
 *  - **Range bounds and `$regex`/`$options` are single predicates**, not conjunctions of parts. A mixed-type
 *    bound is judged once against the value, and options tune a pattern rather than constraining it separately.
 */
export type Predicate =
    /** Conjunction. Children are evaluated in order, so a throwing predicate is reached before a later one. */
    | { readonly kind: 'and'; readonly children: readonly Predicate[] }
    /** A bare value: `{name: 'ann'}`. Against an array field this asks for containment. */
    | { readonly kind: 'scalar'; readonly value: PredicateScalar }
    /** An explicitly `undefined` field condition. It never matches. */
    | { readonly kind: 'undefinedField' }
    /** A bare array operand: `{tags: ['a','b']}` asks for structural equality with the whole array. */
    | { readonly kind: 'exactArray'; readonly value: readonly unknown[] }
    /** A sub-document with no operator keys: `{'child': {name: 'ann'}}`. */
    | { readonly kind: 'compoundObject'; readonly filter: WhereFilterDefinition }
    | { readonly kind: 'eq'; readonly operand: PredicateScalar }
    | { readonly kind: 'ne'; readonly operand: unknown }
    | { readonly kind: 'in'; readonly operand: readonly unknown[] }
    | { readonly kind: 'nin'; readonly operand: readonly unknown[] }
    | { readonly kind: 'range'; readonly bounds: readonly RangeBound[] }
    | { readonly kind: 'regex'; readonly pattern: string; readonly options?: string }
    | { readonly kind: 'exists'; readonly expected: boolean }
    | { readonly kind: 'type'; readonly typeName: ValueComparisonType['$type'] }
    | { readonly kind: 'size'; readonly n: number }
    /** Negation. It complements its operand — there is no separate rule for a missing field. */
    | { readonly kind: 'not'; readonly inner: Predicate }
    /** One array element must satisfy the whole body. */
    | { readonly kind: 'elemMatch'; readonly body: ElemMatchBody }
    /** Every operand must be an element of the array, compared structurally. */
    | { readonly kind: 'all'; readonly elements: readonly unknown[] };
