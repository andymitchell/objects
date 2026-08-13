// Types
export type {
    SortEntry,
    SortDefinition,
    SortAndSliceBase,
    SortAndSlice,
    SortAndSliceCursor,
    SortBoundary,
    QueryError,
    SortAndSliceObjectsResult,
    PrimaryKeyValue,
    PreparedQueryClauses,
    PreparedQueryClausesResult,
    TableInfo,
    ObjectTableInfo,
    ColumnTableInfo,
    FlattenedQuerySql,
} from './types.ts';

// The comparison family a sort key resolves to — needed to declare `ColumnTableInfo.columnKinds`.
export type { SortValueKind } from '../utils/sql/types.ts';

// Schemas
export { SortEntrySchema, SortDefinitionSchema, SortAndSliceBaseSchema, SortAndSliceSchema, SortAndSliceCursorSchema, SortBoundarySchema, EncodedSortValueSchema, EncodedBigIntSchema } from './schemas.ts';

// JS Runtime
export { sortAndSliceObjects } from './sortAndSliceObjects.ts';

// Ordering contract — the single JS statement of the sort-value/null/pk-tiebreak rules.
export type { EncodedSortValue, EncodedBigInt } from './sortCompare.ts';
export { encodeSortValue, compareValues, compareStringsByCodePoint, isEncodedBigInt, resolveSort, buildSortComparator, compareToBoundary } from './sortCompare.ts';

// SQL
export type { SqlDialect, SqlFragment } from './sql/index.ts';
export { prepareObjectTableQuery } from './sql/index.ts';
export { prepareColumnTableQuery } from './sql/index.ts';
// The one expression a JSON sort key resolves to — needed to build an index that can serve it.
export { buildSortKeyExpression } from './sql/index.ts';
export { flattenQueryClausesToSql } from './sql/index.ts';

// Standard test fixtures + DDL — published so adapters can build a real ICollection
// against the standard sort/slice tests, and so they can override `sortable_keys`
// to declare a restricted set.
export type {
    NumericItem,
    NullableItem,
    UndefinedItem,
    NestedItem,
    TiedItem,
    StandardTestItem,
} from './standardTestFixtures.ts';
export {
    NumericItemSchema,
    NullableItemSchema,
    UndefinedItemSchema,
    NestedItemSchema,
    TiedItemSchema,
    StandardTestItemSchema,
    numericItems,
    nullableItems,
    undefinedItems,
    nestedItems,
    tiedItems,
    tenItems,
    STANDARD_TEST_DDL,
} from './standardTestFixtures.ts';

// Standard tests runner
export type { Execute } from './standardTests.ts';
export { standardTests } from './standardTests.ts';

// Re-export DotPropPathsUnion for consumers that need to type `sortable_keys`
// alongside the SortEntry/SortDefinition types.
export type { DotPropPathsUnion } from '../dot-prop-paths/types.ts';

// Re-export SortableKeyRule so consumers can type `sortable_keys` entries (`{ key, direction? }`).
export type { SortableKeyRule } from '../ddl/types.ts';
