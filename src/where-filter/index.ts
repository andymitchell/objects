// Import the specific functions from the file
import { convertDotPropPathToPostgresJsonPath } from './convertDotPropPathToPostgresJsonPath.js';
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject.js';
import postgresWhereClauseBuilder, { PropertyMapSchema } from './postgresWhereClauseBuilder.js';
import type { IPropertyMap, PreparedWhereClauseStatement } from './postgresWhereClauseBuilder.js';
import { type WhereFilterDefinition, WhereFilterSchema, isWhereFilterDefinition} from './types.js';

export const WhereFilter = {
    matchJavascriptObject, 
    filterJavascriptObjects,
    postgresWhereClauseBuilder,
    PropertyMapSchema,
    WhereFilterSchema,
    isWhereFilterDefinition,
    convertDotPropPathToPostgresJsonPath
};

export type {
    WhereFilterDefinition,
    PreparedWhereClauseStatement,
    IPropertyMap
};



/*
// Create a namespace that encapsulates the imported functions
export namespace WhereFilter {
    export const matchJavascriptObject = matchJavascriptObject;
    export const matchObjectInFilter = matchJavascriptObjectInFilter;
}
*/