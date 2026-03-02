
import { convertDotPropPathToPostgresJsonPath } from './convertDotPropPathToPostgresJsonPath.ts';
import { convertDotPropPathToSqliteJsonPath } from './convertDotPropPathToSqliteJsonPath.ts';
import matchJavascriptObject, { compileMatchJavascriptObject, filterJavascriptObjects } from './matchJavascriptObject.ts';
import postgresWhereClauseBuilder, { PropertyMapSchema } from './postgresWhereClauseBuilder.ts';
import sqliteWhereClauseBuilder, { SqlitePropertyMapSchema } from './sqliteWhereClauseBuilder.ts';
import type { IPropertyMap, PreparedWhereClauseStatement } from './whereClauseEngine.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { isLogicFilter, isPartialObjectFilter } from './typeguards.ts';
import type {  MatchJavascriptObject, LogicFilter, PartialObjectFilter, ValueComparisonFlexi, WhereFilterDefinition} from './types.ts';

export {
    matchJavascriptObject,
    filterJavascriptObjects,
    compileMatchJavascriptObject,
    postgresWhereClauseBuilder,
    PropertyMapSchema,
    sqliteWhereClauseBuilder,
    SqlitePropertyMapSchema,
    WhereFilterSchema,
    isWhereFilterDefinition,
    isPartialObjectFilter,
    isLogicFilter,
    convertDotPropPathToPostgresJsonPath,
    convertDotPropPathToSqliteJsonPath
};

export type {
    MatchJavascriptObject,
    WhereFilterDefinition,
    LogicFilter,
    PartialObjectFilter,
    PreparedWhereClauseStatement,
    IPropertyMap,
    ValueComparisonFlexi
};
