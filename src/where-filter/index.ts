
import matchJavascriptObject, { compileMatchJavascriptObject, filterJavascriptObjects } from './matchJavascriptObject.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { isLogicFilter, isPartialObjectFilter } from './typeguards.ts';
import type { MatchJavascriptObject, LogicFilter, PartialObjectFilter, ValueComparisonFlexi, WhereFilterDefinition, WhereFilterDefinitionDeep } from './types.ts';

// SQL re-exports
import {
    prepareWhereClauseForPg,
    postgresWhereClauseBuilder,
    PropertyTranslatorJsonbSchema,
    PropertyTranslatorJsonb,
    prepareWhereClauseForSqlite,
    sqliteWhereClauseBuilder,
    PropertyTranslatorSqliteJsonSchema,
    PropertyTranslatorSqliteJson,
    convertDotPropPathToPostgresJsonPath,
    convertDotPropPathToSqliteJsonPath,
} from './sql/index.ts';
import type { IPropertyTranslator, PreparedWhereClauseStatement, PreparedWhereClauseResult, WhereClauseError } from './sql/index.ts';

export {
    matchJavascriptObject,
    filterJavascriptObjects,
    compileMatchJavascriptObject,
    // New names
    prepareWhereClauseForPg,
    prepareWhereClauseForSqlite,
    PropertyTranslatorJsonbSchema,
    PropertyTranslatorJsonb,
    PropertyTranslatorSqliteJsonSchema,
    PropertyTranslatorSqliteJson,
    // Deprecated aliases
    postgresWhereClauseBuilder,
    sqliteWhereClauseBuilder,
    WhereFilterSchema,
    isWhereFilterDefinition,
    isPartialObjectFilter,
    isLogicFilter,
    convertDotPropPathToPostgresJsonPath,
    convertDotPropPathToSqliteJsonPath,
};

// Backwards-compat aliases
/** @deprecated Use `PropertyTranslatorJsonbSchema` instead. */
export const PropertyMapSchema = PropertyTranslatorJsonbSchema;
/** @deprecated Use `PropertyTranslatorSqliteJsonSchema` instead. */
export const SqlitePropertyMapSchema = PropertyTranslatorSqliteJsonSchema;

export type {
    MatchJavascriptObject,
    WhereFilterDefinition,
    WhereFilterDefinitionDeep,
    LogicFilter,
    PartialObjectFilter,
    PreparedWhereClauseStatement,
    PreparedWhereClauseResult,
    WhereClauseError,
    ValueComparisonFlexi,
    // New name
    IPropertyTranslator,
};

/** @deprecated Use `IPropertyTranslator` instead. */
export type { IPropertyTranslator as IPropertyMap };
