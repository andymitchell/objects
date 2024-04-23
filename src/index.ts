import { DotPropPaths, DotPropPathsRecord, DotPropPathsUnion } from "./dot-prop-paths";
import safeKeyValue, { PrimaryKeyGetter, PrimaryKeyValue, makePrimaryKeyGetter } from "./utils/getKeyValue";
import isPlainObject from "./utils/isPlainObject";
import { EnsureRecord } from "./types";
import { WhereFilter, WhereFilterDefinition } from "./where-filter";
import { AppliedWritesOutput, DDL, WriteAction, WriteActionError, WriteActionFailures, WriteActionPayload, WriteActions } from "./write-actions";

export {isPlainObject, safeKeyValue, makePrimaryKeyGetter};
export type {PrimaryKeyValue, PrimaryKeyGetter}

export {WhereFilter};
export type {WhereFilterDefinition};

export { DotPropPaths };
export type {DotPropPathsUnion, DotPropPathsRecord};

export {WriteActions};
export type {WriteAction, WriteActionPayload, DDL, WriteActionFailures, WriteActionError, AppliedWritesOutput};

export type {EnsureRecord}
