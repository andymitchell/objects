
import type { WhereFilterDefinition } from "./types.js";
import { isWhereFilterArray, isWhereFilterDefinition } from './schemas.ts';
import { isLogicFilter } from "./typeguards.ts";
import { WhereFilterLogicOperators } from "./consts.ts";
import { safeJson } from "./safeJson.ts";

/**
 * Dialect-specific abstraction for converting a single dot-prop path + filter value into SQL.
 * Implementations know how to map WhereFilterDefinition leaf values to dialect-specific SQL fragments.
 */
export interface IPropertyMap<T extends Record<string, any>> {
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string;
}

/** Error detail for a sub-filter that could not be compiled to SQL. */
export type WhereClauseError = {
    sub_filter: WhereFilterDefinition;
    root_filter: WhereFilterDefinition;
    message: string;
};

/**
 * Discriminated union result from SQL where-clause builders.
 * Consumers must check `.success` before accessing statement fields.
 */
export type PreparedWhereClauseResult =
    | { success: true; where_clause_statement: string; statement_arguments: PreparedStatementArgument[] }
    | { success: false; errors: WhereClauseError[] };

/** @deprecated Use `PreparedWhereClauseResult` instead. */
export type PreparedWhereClauseStatement = { whereClauseStatement: string, statementArguments: PreparedStatementArgument[] };
export type PreparedStatementArgument = string | number | boolean | null;
export type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;

/** Typeguard: value is a primitive that can be used as a parameterised query argument. */
export function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}

/**
 * Validates a WhereFilterDefinition then delegates to the recursive builder engine.
 * Returns error-as-value: check `result.success` before accessing fields.
 *
 * @example
 * const result = buildWhereClause(filter, propertyMap);
 * if (result.success) { use(result.where_clause_statement, result.statement_arguments); }
 */
export function buildWhereClause<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, propertySqlMap: IPropertyMap<T>): PreparedWhereClauseResult {
    const errors: WhereClauseError[] = [];
    if (!isWhereFilterDefinition(filter)) {
        errors.push({
            sub_filter: filter as any,
            root_filter: filter as any,
            message: `filter was not well-defined. Received: ${safeJson(filter)}`
        });
        return { success: false, errors };
    }

    const statement_arguments: PreparedStatementArgument[] = [];
    const where_clause_statement = whereClauseBuilder<T>(filter, statement_arguments, propertySqlMap, errors, filter);
    if (errors.length > 0) {
        return { success: false, errors };
    }
    return { success: true, where_clause_statement, statement_arguments };
}

/**
 * Recursive engine: normalises multi-key filters into $and, handles $and/$or/$nor logic,
 * and delegates single-key property filters to the IPropertyMap dialect layer.
 */
export function whereClauseBuilder<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], propertySqlMap: IPropertyMap<T>, errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {

    const keys = Object.keys(filter) as Array<keyof typeof filter>;
    if (keys.length === 0) {
        return '';
    } else if (keys.length > 1) {
        filter = {
            $and: keys.map(key => ({ [key]: filter[key] }))
        }
    }

    if (isLogicFilter(filter)) {
        let andClauses: string[] = [];

        for (const type of WhereFilterLogicOperators) {
            const filterType = filter[type];
            if (isWhereFilterArray(filterType)) {
                let subClauseString = '';
                const subClauses = [...filterType].map(subFilter => whereClauseBuilder(subFilter, statementArguments, propertySqlMap, errors, rootFilter));
                if (type === '$nor') {
                    subClauseString = `NOT (${subClauses.join(' OR ')})`;
                } else if (subClauses.length > 0) {
                    if (typeof subClauses[0] !== 'string') throw new Error("subClauses[0] was empty");
                    const sqlKeyword = type === '$and' ? 'AND' : 'OR';
                    subClauseString = subClauses.length === 1 ? subClauses[0] : `(${subClauses.join(` ${sqlKeyword} `)})`;
                } else {
                    if (type === '$and') {
                        subClauseString = '1 = 1';
                    } else {
                        subClauseString = '1 = 0';
                    }
                }
                andClauses = [...andClauses, subClauseString];
            }
        }

        return andClauses.length === 1 ? andClauses[0]! : `(${andClauses.join(' AND ')})`;

    } else {
        const key = keys[0];
        if (typeof key !== 'string') throw new Error("Bad number of keys - should have gone to logic filter.");

        return propertySqlMap.generateSql(key, filter[key] as WhereFilterDefinition, statementArguments, errors, rootFilter);
    }
}
