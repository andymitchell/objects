
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
    // A schema-driven translator may have found a shape-ambiguous (`scalar | array`) field at construction;
    // that whole-schema defect makes every clause untranslatable, so reject before walking the filter.
    if (propertySqlMap.schemaErrors && propertySqlMap.schemaErrors.length > 0) {
        return { success: false, errors: [...propertySqlMap.schemaErrors] };
    }
    if (!isWhereFilterDefinition(filter)) {
        errors.push({
            kind: 'filter',
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
 * Join clauses with a boolean keyword as a BALANCED binary tree of parentheses rather than a flat left-deep
 * chain. `AND`/`OR` are associative, so the grouping is semantically irrelevant — but a flat `a AND b AND …`
 * of N terms parses into an N-deep expression tree, overflowing SQLite's maximum expression depth (1000) and
 * crashing PGlite's WASM stack on a wide implicit `$and` (e.g. a 1000-key record filter). Balancing keeps the
 * parse-tree depth at ~log2(N). A single clause returns unwrapped; two or more are wrapped once at each split.
 */
function joinBalanced(clauses: string[], keyword: string): string {
    if (clauses.length === 1) return clauses[0]!;
    const mid = clauses.length >> 1;
    return `(${joinBalanced(clauses.slice(0, mid), keyword)} ${keyword} ${joinBalanced(clauses.slice(mid), keyword)})`;
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
                // An empty sub-filter `{}` compiles to '' — it is Mongo's match-all, so inside a logic join it
                // contributes `1 = 1` (else the join would emit a dangling `(F AND )` → SQL syntax error). Match-all
                // is the identity of $and, the absorber of $or, and empties $nor — all correct via this substitution.
                const subClauses = [...filterType].map(subFilter => {
                    const clause = compileWhereFilterRecursive(subFilter, statementArguments, propertySqlMap, errors, rootFilter);
                    return clause === '' ? '1 = 1' : clause;
                });
                if (type === '$nor') {
                    subClauseString = subClauses.length === 0 ? '1 = 1' : `NOT (${joinBalanced(subClauses, 'OR')})`;
                } else if (subClauses.length > 0) {
                    if (typeof subClauses[0] !== 'string') throw new Error("subClauses[0] was empty");
                    const sqlKeyword = type === '$and' ? 'AND' : 'OR';
                    subClauseString = joinBalanced(subClauses, sqlKeyword);
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

        return joinBalanced(andClauses, 'AND');

    } else {
        const key = keys[0];
        if (typeof key !== 'string') throw new Error("Bad number of keys - should have gone to logic filter.");

        return propertySqlMap.generateSql(key, filter[key] as WhereFilterDefinition, statementArguments, errors, rootFilter);
    }
}
