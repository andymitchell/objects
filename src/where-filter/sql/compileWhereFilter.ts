
import type { WhereFilterDefinition } from "../types.ts";
import { isWhereFilterArray, isWhereFilterDefinition } from '../schemas.ts';
import { isLogicFilter } from "../typeguards.ts";
import { WhereFilterLogicOperators } from "../consts.ts";
import { safeJson } from "../safeJson.ts";
import type { IPropertyTranslator, PreparedWhereClauseResult, PreparedStatementArgument, WhereClauseError } from "./types.ts";

/**
 * Tree-walks a WhereFilterDefinition, delegates leaf property filters to the given IPropertyTranslator,
 * and joins results with AND/OR/NOT. Returns error-as-value: check `result.success` before accessing fields.
 *
 * @example
 * const result = compileWhereFilter(filter, translator);
 * if (result.success) { use(result.where_clause_statement, result.statement_arguments); }
 */
export function compileWhereFilter<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, propertySqlMap: IPropertyTranslator<T>): PreparedWhereClauseResult {
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
    const where_clause_statement = compileWhereFilterRecursive<T>(filter, statement_arguments, propertySqlMap, errors, filter);
    if (errors.length > 0) {
        return { success: false, errors };
    }
    return { success: true, where_clause_statement, statement_arguments };
}

/**
 * Recursive engine: normalises multi-key filters into $and, handles $and/$or/$nor logic,
 * and delegates single-key property filters to the IPropertyTranslator dialect layer.
 */
export function compileWhereFilterRecursive<T extends Record<string, any> = any>(filter: WhereFilterDefinition<T>, statementArguments: PreparedStatementArgument[], propertySqlMap: IPropertyTranslator<T>, errors: WhereClauseError[], rootFilter: WhereFilterDefinition<T>): string {

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
                const subClauses = [...filterType].map(subFilter => compileWhereFilterRecursive(subFilter, statementArguments, propertySqlMap, errors, rootFilter));
                if (type === '$nor') {
                    subClauseString = subClauses.length === 0 ? '1 = 1' : `NOT (${subClauses.join(' OR ')})`;
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
