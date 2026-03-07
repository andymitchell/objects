import type { PreparedWhereClauseStatement } from '../../where-filter/sql/types.ts';
import type { DotPropPathConversionResult } from '../../utils/sql/types.ts';
import { SortAndSliceSchema } from '../schemas.ts';
import type { ColumnTableInfo, PreparedQueryClausesResult, QueryError, SortAndSlice } from '../types.ts';
import type { SqlDialect, SqlFragment } from './types.ts';
import { _buildOrderByClause } from './internals/buildOrderByClause.ts';
import { _buildLimitClause, _buildOffsetClause } from './internals/buildLimitOffset.ts';
import { _buildAfterPkWhereClause } from './internals/buildAfterPkWhere.ts';
import { quoteIdentifier } from './internals/quoteIdentifier.ts';
import { concatSqlParameters } from './internals/sqlParameterUtils.ts';

/** Converts internal SqlFragment to public PreparedWhereClauseStatement. */
function toWhereClauseStatement(fragment: SqlFragment): PreparedWhereClauseStatement {
    return { where_clause_statement: fragment.sql, statement_arguments: fragment.parameters };
}

/**
 * Builds parameterised SQL clauses (WHERE, ORDER BY, LIMIT, OFFSET) for a traditional
 * relational table where sort keys map directly to column names (no JSON path extraction).
 * This is the relational-table counterpart to `prepareObjectTableQuery`.
 *
 * Sort keys are validated against `table.allowedColumns` — any key not in the whitelist
 * is rejected with a `QueryError`, preventing SQL injection. Column names are double-quoted
 * in the output to safely handle reserved words and special characters.
 *
 * Unlike `prepareObjectTableQuery`, this function does not accept a `WhereFilterDefinition`
 * (which is designed for JSON columns). Instead, pass pre-built `PreparedWhereClauseStatement`
 * arrays via `whereClauses` for any filtering.
 *
 * Returns decomposed `PreparedQueryClauses` — use `flattenQueryClausesToSql` to assemble
 * into a single SQL string, or access individual clauses for custom composition.
 *
 * @param dialect - SQL dialect: `'pg'` for Postgres (`$N` params) or `'sqlite'` (`?` params).
 * @param table - Table descriptor with PK column name and allowed column whitelist. See `ColumnTableInfo`.
 * @param sortAndSlice - Sorting and pagination config. See `SortAndSlice`.
 * @param whereClauses - Optional pre-built WHERE clauses combined with AND alongside cursor clauses.
 * @returns `{ success: true, ...PreparedQueryClauses }` on success,
 *   `{ success: false, errors: QueryError[] }` on validation or building failure. Never throws.
 *
 * @example
 * // Sort + limit → flatten to SQL
 * const result = prepareColumnTableQuery('pg', {
 *   tableName: 'users', pkColumnName: 'id', allowedColumns: ['id', 'created_at', 'name'],
 * }, { sort: [{ key: 'created_at', direction: -1 }], limit: 50 });
 * if (result.success) {
 *   const { sql, parameters } = flattenQueryClausesToSql(result, 'pg');
 *   db.query(`SELECT * FROM users ${sql}`, parameters);
 * }
 *
 * @example
 * // Cursor pagination with additional WHERE filter
 * const result = prepareColumnTableQuery('sqlite', table, {
 *   sort: [{ key: 'created_at', direction: -1 }], limit: 20, after_pk: 'user_abc',
 * }, [
 *   { where_clause_statement: 'active = ?', statement_arguments: [1] },
 * ]);
 *
 * @note Sort keys not in `allowedColumns` produce a `QueryError`. The PK column must be included
 *   in `allowedColumns` since it is used as an automatic sort tiebreaker.
 * @note A primary key tiebreaker is automatically appended to the sort to ensure deterministic ordering.
 * @note Null values sort last (Postgres `NULLS LAST`, SQLite simulated), matching `sortAndSliceObjects` behaviour.
 */
export function prepareColumnTableQuery<T extends Record<string, any>>(
    dialect: SqlDialect,
    table: ColumnTableInfo,
    sortAndSlice: SortAndSlice<T>,
    whereClauses?: PreparedWhereClauseStatement[]
): PreparedQueryClausesResult {
    // 1. Validate sortAndSlice
    const parsed = SortAndSliceSchema.safeParse(sortAndSlice);
    if (!parsed.success) {
        const errors: QueryError[] = parsed.error.issues.map(issue => ({
            type: 'validation',
            message: issue.message,
        }));
        return { success: false, errors };
    }

    // 2. Resolve sort with PK tiebreaker
    let resolvedSort: Array<{ key: string; direction: 1 | -1 }> | undefined;
    if (parsed.data.sort && parsed.data.sort.length > 0) {
        const sortCopy = [...parsed.data.sort];
        const lastEntry = sortCopy[sortCopy.length - 1]!;
        if (lastEntry.key !== table.pkColumnName) {
            sortCopy.push({ key: table.pkColumnName, direction: 1 });
        }
        resolvedSort = sortCopy;
    }

    // 3. Validate sort keys against allowedColumns
    if (resolvedSort) {
        const invalidKeys = resolvedSort
            .map(e => e.key)
            .filter(k => !table.allowedColumns.includes(k));
        if (invalidKeys.length > 0) {
            return {
                success: false,
                errors: invalidKeys.map(k => ({
                    type: 'invalid_column',
                    message: `Sort key "${k}" is not in allowedColumns`,
                })),
            };
        }
    }

    // Column names used directly (identity function — never fails)
    const pathToSqlExpression = (key: string): DotPropPathConversionResult => ({ success: true, expression: quoteIdentifier(key) });

    // 4. Build ORDER BY
    let orderByStatement: string | null = null;
    if (resolvedSort) {
        const orderByResult = _buildOrderByClause(resolvedSort, pathToSqlExpression, dialect);
        if (!orderByResult.success) {
            return { success: false, errors: orderByResult.errors };
        }
        orderByStatement = orderByResult.orderBy;
    }

    // 5. Build cursor WHERE (if after_pk)
    let cursorStatement: SqlFragment | null = null;
    if (parsed.data.after_pk !== undefined && resolvedSort) {
        const pkExpression = quoteIdentifier(table.pkColumnName);
        const cursorResult = _buildAfterPkWhereClause(
            parsed.data.after_pk,
            resolvedSort,
            pathToSqlExpression,
            pkExpression,
            table.tableName,
            dialect
        );
        if (!cursorResult.success) {
            return { success: false, errors: cursorResult.errors };
        }
        cursorStatement = cursorResult.statement;
    }

    // 6. Compose WHERE clauses
    const whereFragments: SqlFragment[] = [];
    if (cursorStatement) {
        whereFragments.push(cursorStatement);
    }
    if (whereClauses) {
        for (const clause of whereClauses) {
            whereFragments.push({ sql: clause.where_clause_statement, parameters: clause.statement_arguments });
        }
    }

    const composedWhere = whereFragments.length > 0
        ? toWhereClauseStatement(concatSqlParameters(whereFragments, dialect))
        : null;

    // 7. Build LIMIT/OFFSET
    const limitStatement = parsed.data.limit !== undefined
        ? toWhereClauseStatement(_buildLimitClause(parsed.data.limit, dialect))
        : null;

    const offsetStatement = parsed.data.offset !== undefined
        ? toWhereClauseStatement(_buildOffsetClause(parsed.data.offset, dialect))
        : null;

    return {
        success: true,
        where_statement: composedWhere,
        order_by_statement: orderByStatement,
        limit_statement: limitStatement,
        offset_statement: offsetStatement,
    };
}
