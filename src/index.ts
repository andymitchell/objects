import { DotPropPaths } from "./dot-prop-paths/index.js";
import type {  DotPropPathsRecord, DotPropPathsUnion, PathValue } from "./dot-prop-paths/index.js";
import safeKeyValue, { type PrimaryKeyGetter, type PrimaryKeyValue, PrimaryKeyValueSchema, makePrimaryKeyGetter } from "./utils/getKeyValue.js";
import isPlainObject from "./utils/isPlainObject.js";
import type { EnsureRecord } from "./types.js";


import { getTypedProperty, setTypedProperty } from "./dot-prop-paths/typed-dot-prop.js";
import cloneDeepSafe from "./utils/cloneDeepSafe.js";
import type { IPropertyMap, PreparedWhereClauseStatement, PreparedWhereClauseResult, WhereClauseError, WhereFilterDefinition } from "./where-filter/index.ts";
import { WhereFilter } from "./where-filter/index-old.ts";
import  { orderList } from "./utils/orderList.ts";


export * from "./where-filter/index.ts";
export * from "./objects-delta/index.ts";
export * from './write-actions/index.ts';

// Query — omit PrimaryKeyValue to avoid duplicate export (already exported from getKeyValue.ts)
export type {
    SortEntry,
    SortDefinition,
    SortAndSlice,
    QueryError,
    SortAndSliceObjectsResult,
    PreparedQueryClauses,
    PreparedQueryClausesResult,
    TableInfo,
    ObjectTableInfo,
    ColumnTableInfo,
    FlattenedQuerySql,
    SqlDialect,
    SqlFragment,
} from "./query/index.ts";
export { SortEntrySchema, SortDefinitionSchema, SortAndSliceSchema } from "./query/index.ts";
export { sortAndSliceObjects } from "./query/index.ts";
export { prepareObjectTableQuery, prepareColumnTableQuery, flattenQueryClausesToSql } from "./query/index.ts";

export {
    isPlainObject, 
    safeKeyValue, 
    cloneDeepSafe,
    makePrimaryKeyGetter, 
    PrimaryKeyValueSchema,
    orderList
};
export type {PrimaryKeyValue, PrimaryKeyGetter}

export {WhereFilter};
export type {
    WhereFilterDefinition,
    PreparedWhereClauseStatement,
    PreparedWhereClauseResult,
    WhereClauseError,
    IPropertyMap
};

export { DotPropPaths };
export type {
    DotPropPathsUnion, 
    DotPropPathsRecord,
    PathValue
};
export {
    getTypedProperty,
    setTypedProperty
}


export type {EnsureRecord}
