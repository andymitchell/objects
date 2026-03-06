// Import the specific functions from the file
import { convertDotPropPathToPostgresJsonPath } from './sql/postgres/convertDotPropPathToPostgresJsonPath.ts';
import matchJavascriptObject, { filterJavascriptObjects } from './matchJavascriptObject.ts';
import { postgresWhereClauseBuilder, PropertyTranslatorJsonbSchema as PropertyMapSchema } from './sql/postgres/index.ts';
import type { IPropertyTranslator as IPropertyMap } from './sql/types.ts';
import type { PreparedWhereClauseStatement } from './sql/types.ts';
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
