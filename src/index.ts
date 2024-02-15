import { DotPropPaths, DotPropPathsRecord, DotPropPathsUnion } from "./dot-prop-paths";
import safeKeyValue, { PrimaryKeyGetter, PrimaryKeyValue, makePrimaryKeyGetter } from "./getKeyValue";
import isPlainObject from "./isPlainObject";
import { WhereFilter, WhereFilterDefinition } from "./where-filter";
import { DDL, WriteAction, WriteActionPayload, WriteActions } from "./write-actions";

export {isPlainObject, safeKeyValue, makePrimaryKeyGetter};
export type {PrimaryKeyValue, PrimaryKeyGetter}

export {WhereFilter};
export type {WhereFilterDefinition};

export { DotPropPaths };
export type {DotPropPathsUnion, DotPropPathsRecord};

export {WriteActions};
export type {WriteAction, WriteActionPayload, DDL};

