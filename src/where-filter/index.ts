// Import the specific functions from the file
import { convertDotPropPathToPostgresJsonPath } from './convertDotPropPathToPostgresJsonPath';
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject';
import postgresWhereClauseBuilder, { IPropertyMap, PropertyMapSchema } from './postgresWhereClauseBuilder';
import { WhereFilterDefinition, WhereFilterSchema} from './types';

export const WhereFilter = {
    matchJavascriptObject, 
    filterJavascriptObjects,
    postgresWhereClauseBuilder,
    PropertyMapSchema,
    WhereFilterSchema,
    convertDotPropPathToPostgresJsonPath
};

export type {
    WhereFilterDefinition,
    IPropertyMap
};



/*
// Create a namespace that encapsulates the imported functions
export namespace WhereFilter {
    export const matchJavascriptObject = matchJavascriptObject;
    export const matchObjectInFilter = matchJavascriptObjectInFilter;
}
*/