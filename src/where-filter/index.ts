
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
};
