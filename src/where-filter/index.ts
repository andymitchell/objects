
import matchJavascriptObject, { compileMatchJavascriptObject, filterJavascriptObjects } from './matchJavascriptObject.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { isLogicFilter, isPartialObjectFilter } from './typeguards.ts';
import { validateWhereFilter, compileValidateWhereFilter } from './validateWhereFilter.ts';
import type { WhereFilterValidationIssue } from './validateWhereFilter.ts';
import type { MatchJavascriptObject, LogicFilter, PartialObjectFilter, PartialObjectFilterStrict, ValueComparisonFlexi, WhereFilterDefinition, WhereFilterDefinitionDeep } from './types.ts';

// SQL re-exports
import {
    prepareWhereClause,
    prepareWhereClauseForPg,
    PropertyTranslatorPgJsonbSchema,
    PropertyTranslatorPgJsonb,
    prepareWhereClauseForSqlite,
    PropertyTranslatorSqliteJsonSchema,
    PropertyTranslatorSqliteJson,
    convertDotPropPathToPostgresJsonPath,
    convertDotPropPathToSqliteJsonPath,
} from './sql/index.ts';
import type { IPropertyTranslator, PreparedWhereClauseStatement, PreparedWhereClauseResult, SqlDialect, WhereClauseError } from './sql/index.ts';

// Schema shape-ambiguity detector — re-exported so a consumer building a schema-driven backend (or
// enforcing universal schema conformance on this matcher) can reject a `scalar | array` field up-front.
import { findShapeAmbiguousPaths } from '../dot-prop-paths/shape-ambiguity.ts';
import type { ShapeAmbiguity } from '../dot-prop-paths/shape-ambiguity.ts';
// Schema value-normalization detector — re-exported alongside the ambiguity detector so a consumer enforcing
// universal schema conformance can reject a coerce/transform/pipe field a schema-driven backend cannot replicate.
import { findNormalizingPaths } from '../dot-prop-paths/schema-normalization.ts';
import type { SchemaNormalization } from '../dot-prop-paths/schema-normalization.ts';

export {
    matchJavascriptObject,
    filterJavascriptObjects,
    compileMatchJavascriptObject,
    prepareWhereClause,
    prepareWhereClauseForPg,
    prepareWhereClauseForSqlite,
    PropertyTranslatorPgJsonbSchema,
    PropertyTranslatorPgJsonb,
    PropertyTranslatorSqliteJsonSchema,
    PropertyTranslatorSqliteJson,
    WhereFilterSchema,
    isWhereFilterDefinition,
    isPartialObjectFilter,
    isLogicFilter,
    validateWhereFilter,
    compileValidateWhereFilter,
    convertDotPropPathToPostgresJsonPath,
    convertDotPropPathToSqliteJsonPath,
    findShapeAmbiguousPaths,
    findNormalizingPaths,
};

export type {
    MatchJavascriptObject,
    WhereFilterDefinition,
    WhereFilterDefinitionDeep,
    LogicFilter,
    PartialObjectFilter,
    PartialObjectFilterStrict,
    PreparedWhereClauseStatement,
    PreparedWhereClauseResult,
    WhereClauseError,
    ValueComparisonFlexi,
    WhereFilterValidationIssue,
    IPropertyTranslator,
    SqlDialect,
    ShapeAmbiguity,
    SchemaNormalization,
};

// ─── Testing ───
// Published so a stackable-collection conformance suite can run the standard WhereFilter
// semantics battery against a real ICollection (it injects its own `matchJavascriptObject`).
export { standardTests } from './standardTests.ts';
export type { StandardTestConfig, MatchJavascriptObjectInTesting } from './standardTests.ts';
