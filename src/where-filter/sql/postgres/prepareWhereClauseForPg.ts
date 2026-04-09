
import type { WhereFilterDefinition } from "../../types.ts";
import { compileWhereFilter } from "../compileWhereFilter.ts";
import type { IPropertyTranslator, PreparedWhereClauseResult } from "../types.ts";

/**
 * Converts a WhereFilterDefinition into a parameterised Postgres WHERE clause for a JSONB column.
 * The mental model: your Zod schema describes the shape stored in a JSONB column, and this function
 * turns a MongoDB-style query object into the equivalent SQL WHERE clause with positional `$N` parameters.
 * Internally validates the filter, walks the filter tree, and delegates leaf comparisons to a PropertyTranslator.
 *
 * @example
 * const pm = new PropertyTranslatorPgJsonbSchema(myZodSchema, 'data');
 * const result = prepareWhereClauseForPg({ name: 'Andy' }, pm);
 * if (result.success) { use(result.where_clause_statement, result.statement_arguments); }
 */
export function prepareWhereClauseForPg<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, propertySqlMap: IPropertyTranslator<T>): PreparedWhereClauseResult {
    return compileWhereFilter(filter, propertySqlMap);
}
