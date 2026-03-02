
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
    generateSql(dotpropPath: string, filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[]): string;
}

export type PreparedWhereClauseStatement = { whereClauseStatement: string, statementArguments: PreparedStatementArgument[] };
export type PreparedStatementArgument = string | number | boolean | null;
export type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;

/** Typeguard: value is a primitive that can be used as a parameterised query argument. */
export function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}

/**
 * Validates a WhereFilterDefinition then delegates to the recursive builder engine.
 * Shared entry-point logic used by both Postgres and SQLite where-clause builders.
 *
 * @example
 * const { whereClauseStatement, statementArguments } = buildWhereClause(filter, propertyMap);
 */
export function buildWhereClause<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, propertySqlMap: IPropertyMap<T>): PreparedWhereClauseStatement {
    if (!isWhereFilterDefinition(filter)) {
        throw new Error("filter was not well-defined. Received: " + safeJson(filter));
    }

    const statementArguments: PreparedStatementArgument[] = [];
    const whereClauseStatement = whereClauseBuilder<T>(filter, statementArguments, propertySqlMap);
    return { whereClauseStatement, statementArguments };
}

/**
 * Recursive engine: normalises multi-key filters into $and, handles $and/$or/$nor logic,
 * and delegates single-key property filters to the IPropertyMap dialect layer.
 */
export function whereClauseBuilder<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], propertySqlMap: IPropertyMap<T>): string {

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
                const subClauses = [...filterType].map(subFilter => whereClauseBuilder(subFilter, statementArguments, propertySqlMap));
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

        return propertySqlMap.generateSql(key, filter[key] as WhereFilterDefinition, statementArguments);
    }
}
