export const WhereFilterLogicOperators = ['$and', '$or', '$nor'] as const;
// The range subset of the value operators. Kept here as the primitive tuple the operator registry
// (`ast/operators.ts`), the parser, the validator and the SQL emitters all reference; the full value/array
// operator vocabulary is declared once in the registry.
export const ValueComparisonRangeOperators = ['$lt', '$gt', '$lte', '$gte'] as const;
