// Types
export type {
    SortEntry,
    SortDefinition,
    SortAndSliceBase,
    SortAndSlice,
    SortAndSliceCursor,
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

// Schemas
export { SortEntrySchema, SortDefinitionSchema, SortAndSliceBaseSchema, SortAndSliceSchema, SortAndSliceCursorSchema } from './schemas.ts';

// JS Runtime
export { sortAndSliceObjects } from './sortAndSliceObjects.ts';

// SQL
export type { SqlDialect, SqlFragment } from './sql/index.ts';
export { prepareObjectTableQuery } from './sql/index.ts';
export { prepareColumnTableQuery } from './sql/index.ts';
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
