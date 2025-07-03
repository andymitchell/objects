
import { convertDotPropPathToPostgresJsonPath } from './convertDotPropPathToPostgresJsonPath.ts';
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject.ts';
import postgresWhereClauseBuilder, { PropertyMapSchema } from './postgresWhereClauseBuilder.ts';
import type { IPropertyMap, PreparedWhereClauseStatement } from './postgresWhereClauseBuilder.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { isLogicFilter, isPartialObjectFilter } from './typeguards.ts';
import type {  LogicFilter, PartialObjectFilter, ValueComparison, WhereFilterDefinition} from './types.ts';

export {
    matchJavascriptObject, 
    filterJavascriptObjects,
    postgresWhereClauseBuilder,
    PropertyMapSchema,
    WhereFilterSchema,
    isWhereFilterDefinition,
    isPartialObjectFilter,
    isLogicFilter,
    convertDotPropPathToPostgresJsonPath
};

export type {
    WhereFilterDefinition,
    LogicFilter,
    PartialObjectFilter,
    PreparedWhereClauseStatement,
    IPropertyMap,
    ValueComparison
};
