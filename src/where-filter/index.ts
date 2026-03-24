
import matchJavascriptObject, { compileMatchJavascriptObject, filterJavascriptObjects } from './matchJavascriptObject.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { isLogicFilter, isPartialObjectFilter } from './typeguards.ts';
import type { MatchJavascriptObject, LogicFilter, PartialObjectFilter, ValueComparisonFlexi, WhereFilterDefinition, WhereFilterDefinitionDeep } from './types.ts';

// SQL re-exports
import {
    prepareWhereClauseForPg,
    PropertyTranslatorJsonbSchema,
    PropertyTranslatorJsonb,
    prepareWhereClauseForSqlite,
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
    prepareWhereClauseForPg,
    prepareWhereClauseForSqlite,
    PropertyTranslatorJsonbSchema,
    PropertyTranslatorJsonb,
    PropertyTranslatorSqliteJsonSchema,
    PropertyTranslatorSqliteJson,
    WhereFilterSchema,
    isWhereFilterDefinition,
    isPartialObjectFilter,
    isLogicFilter,
    convertDotPropPathToPostgresJsonPath,
    convertDotPropPathToSqliteJsonPath,
};

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
    IPropertyTranslator,
};
