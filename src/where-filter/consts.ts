export const WhereFilterLogicOperators = ['$and', '$or', '$nor'] as const;
export const ValueComparisonRangeOperators = ['$lt', '$gt', '$lte', '$gte'] as const;

/**
 * The operators a scalar (value) field condition may carry. A payload of several of these means their
 * conjunction (Mongo AND). The single source of truth consumed by the gate ({@link schemas.ts}), the JS
 * matcher, both SQL emitters, and the validator — so "which operators exist" is declared once.
 */
export const ValueOperators = ['$eq', '$ne', '$in', '$nin', '$not', '$exists', '$type', '$regex', '$options', '$gt', '$gte', '$lt', '$lte'] as const;

/**
 * The operators an array field condition may carry. `$in`/`$nin`/`$not`/`$exists`/`$type` are SHARED with
 * {@link ValueOperators} (meaningful on both scalars and arrays); `$elemMatch`/`$all`/`$size` are array-only.
 * A payload mixing an array-only operator with a value-only one is cross-category and rejected by the gate.
 */
export const ArrayOperators = ['$elemMatch', '$all', '$size', '$in', '$nin', '$not', '$exists', '$type'] as const;