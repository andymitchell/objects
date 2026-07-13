
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

// The battery ships every property expressible against the seam alone. A `FuzzPropertyRegistrar` is the seam for
// a property needing an independent implementation of the query language to check the reference against — kept
// injectable so that implementation stays in the caller's test run and never reaches a consumer's bundle.
export type { FuzzPropertyRegistrar, SectionCtx } from './standardTests.ts';

// A partial implementation answers `undefined` for a filter it cannot express, which the battery records as
// an acknowledged seam rather than a failure. Collect those acknowledgements and freeze them against a
// capability manifest, and an implementation's known gaps become a pinned contract: a new gap fails the
// guard rather than hiding behind a skip, and a closed one demands the manifest record the win. This is the
// machinery the in-repo engines hold themselves to, published so any consumer can do the same.
export { AcknowledgementCollector, assertNoCapabilityDrift } from './standardTests.ts';
export type { AcknowledgementEvent, AcknowledgementKind, ExpectLike } from './standardTests.ts';
