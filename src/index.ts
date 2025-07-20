import { DotPropPaths } from "./dot-prop-paths/index.js";
import type {  DotPropPathsRecord, DotPropPathsUnion, PathValue } from "./dot-prop-paths/index.js";
import safeKeyValue, { type PrimaryKeyGetter, type PrimaryKeyValue, PrimaryKeyValueSchema, makePrimaryKeyGetter } from "./utils/getKeyValue.js";
import isPlainObject from "./utils/isPlainObject.js";
import type { EnsureRecord } from "./types.js";
import { WhereFilter } from "./where-filter/index-old.ts";
import type { IPropertyMap, PreparedWhereClauseStatement, WhereFilterDefinition } from "./where-filter/index-old.ts";
import { isIUser, WriteActions } from "./write-actions/index.js";
import type { WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, DDL, WriteAction, WriteActionError, WriteActionFailures, WriteActionPayload, WriteActionFailuresErrorDetails, WriteActionSuccesses, IUser, ListOrdering, AppliedWritesOutputResponse, ApplyWritesToItemsOptions } from "./write-actions/index.js";
import { getTypedProperty, setTypedProperty } from "./dot-prop-paths/typed-dot-prop.js";
import cloneDeepSafe from "./utils/cloneDeepSafe.js";


export * from "./where-filter/index.ts";
export * from "./objects-delta/index.ts";

export {
    isPlainObject, 
    safeKeyValue, 
    cloneDeepSafe,
    makePrimaryKeyGetter, 
    PrimaryKeyValueSchema
};
export type {PrimaryKeyValue, PrimaryKeyGetter}

export {WhereFilter};
export type {
    WhereFilterDefinition,
    PreparedWhereClauseStatement,
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

export {
    WriteActions,
    isIUser
};
export type {
    WriteAction, 
    WriteActionPayload, 
    DDL, 
    ListOrdering,
    ApplyWritesToItemsOptions,
    WriteActionSuccesses, 
    WriteActionFailures, 
    WriteActionError, 
    AppliedWritesOutput, 
    AppliedWritesOutputResponse,
    WriteActionAffectedItem, 
    WriteActionFailureAffectedItem, 
    WriteActionFailuresErrorDetails,
    IUser
};

export type {EnsureRecord}
