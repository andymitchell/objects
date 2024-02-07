import { DotPropPaths, DotPropPathsRecord, DotPropPathsUnion } from "./dot-prop-paths";
import safeKeyValue, { PrimaryKeyValue, makePrimaryKeyGetter } from "./getKeyValue";
import isPlainObject from "./isPlainObject";
import { WhereFilter, WhereFilterDefinition } from "./where-filter";
import { WriteAction, WriteActionPayload, WriteActions } from "./write-actions";

export {isPlainObject, safeKeyValue, makePrimaryKeyGetter};
export type {PrimaryKeyValue}

export {WhereFilter};
export type {WhereFilterDefinition};

export { DotPropPaths };
export type {DotPropPathsUnion, DotPropPathsRecord};

export {WriteActions};
export type {WriteAction, WriteActionPayload};

