import { DotPropPaths, DotPropPathsRecord, DotPropPathsUnion } from "./dot-prop-paths";
import safeKeyValue, { PrimaryKeyGetter, PrimaryKeyValue, makePrimaryKeyGetter } from "./utils/getKeyValue";
import isPlainObject from "./utils/isPlainObject";
import { EnsureRecord } from "./types";
import { IPropertyMap, PreparedWhereClauseStatement, WhereFilter, WhereFilterDefinition } from "./where-filter";
import { WriteActionAffectedItem, WriteActionFailureAffectedItem, AppliedWritesOutput, DDL, WriteAction, WriteActionError, WriteActionFailures, WriteActionPayload, WriteActions, WriteActionFailuresErrorDetails, WriteActionSuccesses, IUser } from "./write-actions";


export {isPlainObject, safeKeyValue, makePrimaryKeyGetter};
export type {PrimaryKeyValue, PrimaryKeyGetter}

export {WhereFilter};
export type {
    WhereFilterDefinition,
    PreparedWhereClauseStatement,
    IPropertyMap
};

export { DotPropPaths };
export type {DotPropPathsUnion, DotPropPathsRecord};

export {WriteActions};
export type {
    WriteAction, 
    WriteActionPayload, 
    DDL, 
    WriteActionSuccesses, 
    WriteActionFailures, 
    WriteActionError, 
    AppliedWritesOutput, 
    WriteActionAffectedItem, 
    WriteActionFailureAffectedItem, 
    WriteActionFailuresErrorDetails,
    IUser
};

export type {EnsureRecord}
