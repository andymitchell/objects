type EnsureRecord<T> = T extends Record<string, any> ? T : never;

type Path<T, Depth extends number = 6> = Depth extends 0 ? '' : T extends Array<any> ? never : T extends object ? {
    [K in keyof T]-?: K extends string | number ? `${string & K}` | `${string & K}.${Path<NonNullable<T[K]>, Prev[Depth]>}` : never;
}[keyof T] : '';
type RemoveTrailingDot<T> = T extends `${infer S}.` ? never : T;
type DotPropPathsUnion<T> = {
    [K in Path<T>]: RemoveTrailingDot<K>;
}[Path<T>];
type DotPropPathsIncArrayUnion<T extends Record<string, any>> = DotPropPathToObjectArraySpreadingArrays<T> | DotPropPathsUnion<T>;
type PathValueIncDiscrimatedUnions<T extends Record<string, any>, P> = T extends unknown ? P extends `${infer Key}.${infer Rest}` ? Key extends keyof T ? NonNullable<T[Key]> extends Array<infer U> ? PathValueIncDiscrimatedUnions<EnsureRecord<U>, Rest> : PathValueIncDiscrimatedUnions<NonNullable<T[Key]>, Rest> : never : P extends keyof T ? NonNullable<T[P]> : never : never;
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, ...0[]];
type DotPropPathToArraySpreadingArrays<T extends Record<string, any>, Depth extends number = 8, Prefix extends string = ''> = Depth extends 0 ? never : T extends object ? {
    [K in keyof T]?: K extends string ? NonNullable<T[K]> extends Array<infer U> ? U extends object ? `${Prefix}${K}.${DotPropPathToArraySpreadingArrays<U, Prev[Depth], ''>}` | `${Prefix}${K}` : `${Prefix}${K}` : T[K] extends object ? `${Prefix}${K}.${DotPropPathToArraySpreadingArrays<T[K], Prev[Depth], ''>}` : never : never;
}[keyof T] : '';
type DotPropPathToObjectArraySpreadingArrays<T extends Record<string, any>, Depth extends number = 8, Prefix extends string = ''> = Depth extends 0 ? never : T extends object ? {
    [K in keyof T]-?: K extends string ? NonNullable<T[K]> extends Array<infer U> ? U extends object ? `${Prefix}${K}.${DotPropPathToObjectArraySpreadingArrays<U, Prev[Depth], ''>}` | `${Prefix}${K}` : never : T[K] extends object ? `${Prefix}${K}.${DotPropPathToObjectArraySpreadingArrays<T[K], Prev[Depth], ''>}` : never : never;
}[keyof T] : '';

declare const WhereFilterLogicOperators: readonly ["AND", "OR", "NOT"];
declare const ValueComparisonNumericOperators: readonly ["lt", "gt", "lte", "gte"];

type WhereFilterLogicOperatorsTyped = typeof WhereFilterLogicOperators[number];
type ValueComparisonNumericOperatorsTyped = typeof ValueComparisonNumericOperators[number];
type ValueComparisonNumeric = Partial<Record<ValueComparisonNumericOperatorsTyped, number>>;
type ValueComparisonContains = {
    contains: string;
};
type ValueComparison<T = any> = (T extends string ? ValueComparisonContains : T extends number ? ValueComparisonNumeric : never) | T;
type ArrayValueComparisonElemMatch<T = any> = {
    elem_match: T extends Record<string, any> ? WhereFilterDefinition<T> : ValueComparison<T>;
};
type ArrayValueComparison<T = any> = ArrayValueComparisonElemMatch<T>;
type IsAssignableTo<A, B> = A extends B ? true : false;
type ArrayElementFilter<T = any> = (T extends Record<string, any> ? WhereFilterDefinition<T> : T extends string | number ? T : never) | ArrayValueComparison<T>;
type ArrayFilter<T extends []> = ArrayElementFilter<T[number]> | T;
type PartialObjectFilter<T extends Record<string, any>> = Partial<{
    [P in DotPropPathsIncArrayUnion<T>]: IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>> extends true ? ArrayFilter<PathValueIncDiscrimatedUnions<T, P>> : ValueComparison<PathValueIncDiscrimatedUnions<T, P>>;
}>;
type LogicFilter<T extends Record<string, any>> = {
    [K in WhereFilterLogicOperatorsTyped]?: WhereFilterDefinition<T>[];
};
/**
 * Define a search term using either the (nestable) keys of an object or boolean logic filters.
 *
 * Note if you use this as a parameter in a function, TypeScript cannot infer whether it's a logic filter or partial object filter and will claim it has no properties.
 * In this case, use isLogicFilter or isPartialObjectFilter to first narrow it, then you can use it.
 */
type WhereFilterDefinition<T extends Record<string, any> = any> = PartialObjectFilter<T> | LogicFilter<T>;

export type { WhereFilterDefinition };
