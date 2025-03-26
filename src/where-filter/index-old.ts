// Import the specific functions from the file
import { convertDotPropPathToPostgresJsonPath } from './convertDotPropPathToPostgresJsonPath.ts';
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject.ts';
import postgresWhereClauseBuilder, { PropertyMapSchema } from './postgresWhereClauseBuilder.ts';
import type { IPropertyMap, PreparedWhereClauseStatement } from './postgresWhereClauseBuilder.ts';
import { isWhereFilterDefinition, WhereFilterSchema } from './schemas.ts';
import { type WhereFilterDefinition} from './types.ts';

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