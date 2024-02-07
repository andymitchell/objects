// Import the specific functions from the file
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject';
import postgresWhereClauseBuilder, { postgresCreatePropertySqlMapFromSchema } from './postgresWhereClauseBuilder';
import {WhereFilter as WhereFilterDefinition, WhereFilterSchema} from './types';

export const WhereFilter = {
    matchJavascriptObject, 
    filterJavascriptObjects,
    postgresWhereClauseBuilder,
    postgresCreatePropertySqlMapFromSchema,
    WhereFilterSchema
};

export type {WhereFilterDefinition};



/*
// Create a namespace that encapsulates the imported functions
export namespace WhereFilter {
    export const matchJavascriptObject = matchJavascriptObject;
    export const matchObjectInFilter = matchJavascriptObjectInFilter;
}
*/