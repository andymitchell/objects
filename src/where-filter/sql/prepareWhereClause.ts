
import type { WhereFilterDefinition } from "../types.ts";
import type { IPropertyTranslator, PreparedWhereClauseResult, SqlDialect } from "./types.ts";
import { prepareWhereClauseForPg } from "./postgres/prepareWhereClauseForPg.ts";
import { prepareWhereClauseForSqlite } from "./sqlite/prepareWhereClauseForSqlite.ts";

/**
 * Compiles a MongoDB-style filter into a parameterised SQL WHERE clause for Postgres (`$N` placeholders) or SQLite (`?` placeholders).
 * One helper for both dialects so query code stays dialect-agnostic; the translator carries the schema and JSON column mapping.
 *
 * On success returns `{ success: true, where_clause_statement, statement_arguments }`.
 * On failure returns `{ success: false, errors }` — including a `kind: 'dialect_mismatch'` error if the translator was built for a different dialect.
 *
 * @example
 * // Postgres
 * const translator = new PropertyTranslatorPgJsonbSchema(ContactSchema, 'data');
 * const r = prepareWhereClause('pg', { name: 'Andy', age: { $gt: 18 } }, translator);
 * if (r.success) {
 *     await db.query(`SELECT * FROM contacts WHERE ${r.where_clause_statement}`, r.statement_arguments);
 * }
 *
 * @example
 * // SQLite
 * const translator = new PropertyTranslatorSqliteJsonSchema(ContactSchema, 'data');
 * const r = prepareWhereClause('sqlite', { name: 'Andy', age: { $gt: 18 } }, translator);
 * if (r.success) {
 *     db.prepare(`SELECT * FROM contacts WHERE ${r.where_clause_statement}`).all(...r.statement_arguments);
 * }
 */
export function prepareWhereClause<T extends Record<string, any> = any>(
    dialect: SqlDialect,
    filter: WhereFilterDefinition<T>,
    translator: IPropertyTranslator<T>
): PreparedWhereClauseResult {
    if (translator.dialect !== dialect) {
        return {
            success: false,
            errors: [{
                kind: 'dialect_mismatch',
                expected: dialect,
                actual: translator.dialect,
                message: `Translator dialect '${translator.dialect}' does not match requested dialect '${dialect}'.`,
            }],
        };
    }
    return dialect === 'pg'
        ? prepareWhereClauseForPg(filter, translator)
        : prepareWhereClauseForSqlite(filter, translator);
}
