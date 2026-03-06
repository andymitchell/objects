
import type { ValueComparisonRangeOperatorSqlFunctions } from "./types.ts";

/** Standard SQL range comparison operators shared by all dialects. */
export const ValueComparisonRangeOperatorsSqlFunctions: ValueComparisonRangeOperatorSqlFunctions = {
    '$gt': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} > ${parameterizedQueryPlaceholder}`,
    '$lt': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} < ${parameterizedQueryPlaceholder}`,
    '$gte': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} >= ${parameterizedQueryPlaceholder}`,
    '$lte': (sqlKey, parameterizedQueryPlaceholder) => `${sqlKey} <= ${parameterizedQueryPlaceholder}`,
};
