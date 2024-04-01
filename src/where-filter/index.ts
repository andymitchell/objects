// Import the specific functions from the file
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject';
import postgresWhereClauseBuilder, { PropertySqlMap, postgresCreatePropertySqlMapFromSchema } from './postgresWhereClauseBuilder';
import { WhereFilterDefinition, WhereFilterSchema} from './types';

export const WhereFilter = {
    matchJavascriptObject, 
    filterJavascriptObjects,
    postgresWhereClauseBuilder,
    postgresCreatePropertySqlMapFromSchema,
    WhereFilterSchema
};

export type {WhereFilterDefinition, PropertySqlMap};



/*
// Create a namespace that encapsulates the imported functions
export namespace WhereFilter {
    export const matchJavascriptObject = matchJavascriptObject;
    export const matchObjectInFilter = matchJavascriptObjectInFilter;
}
*/