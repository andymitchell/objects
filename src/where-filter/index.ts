
import { convertDotPropPathToPostgresJsonPath } from './convertDotPropPathToPostgresJsonPath.ts';
import matchJavascriptObject, { compileMatchJavascriptObject, filterJavascriptObjects } from './matchJavascriptObject.ts';
import postgresWhereClauseBuilder, { PropertyMapSchema } from './postgresWhereClauseBuilder.ts';
import type { IPropertyMap, PreparedWhereClauseStatement } from './postgresWhereClauseBuilder.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { isLogicFilter, isPartialObjectFilter } from './typeguards.ts';
import type {  MatchJavascriptObject, LogicFilter, PartialObjectFilter, ValueComparisonFlexi, WhereFilterDefinition} from './types.ts';

export {
    matchJavascriptObject, 
    filterJavascriptObjects,
    compileMatchJavascriptObject,
    postgresWhereClauseBuilder,
    PropertyMapSchema,
    WhereFilterSchema,
    isWhereFilterDefinition,
    isPartialObjectFilter,
    isLogicFilter,
    convertDotPropPathToPostgresJsonPath
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
