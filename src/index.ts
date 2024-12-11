import { DotPropPaths, DotPropPathsRecord, DotPropPathsUnion, PathValue } from "./dot-prop-paths";
import safeKeyValue, { PrimaryKeyGetter, PrimaryKeyValue, PrimaryKeyValueSchema, makePrimaryKeyGetter } from "./utils/getKeyValue";
import isPlainObject from "./utils/isPlainObject";
import { EnsureRecord } from "./types";
import { IPropertyMap, PreparedWhereClauseStatement, WhereFilter, WhereFilterDefinition } from "./where-filter";
import { WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, DDL, WriteAction, WriteActionError, WriteActionFailures, WriteActionPayload, WriteActions, WriteActionFailuresErrorDetails, WriteActionSuccesses, IUser, isIUser, ListOrdering, AppliedWritesOutputResponse, ApplyWritesToItemsOptions } from "./write-actions";
import { getTypedProperty, setTypedProperty } from "./dot-prop-paths/typed-dot-prop";
import cloneDeepSafe from "./utils/cloneDeepSafe";


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
