import type { PreparedWhereClauseStatement } from '../../where-filter/sql/types.ts';
import type { DotPropPathConversionResult } from '../../utils/sql/types.ts';
import { SortAndSliceSchema } from '../schemas.ts';
import { encodeSortValue, resolveSort } from '../sortCompare.ts';
import type { ColumnTableInfo, PreparedQueryClausesResult, QueryError, SortAndSlice } from '../types.ts';
import type { SqlDialect, SqlFragment } from './types.ts';
import { _buildOrderByClause } from './internals/buildOrderByClause.ts';
import { _buildLimitClause, _buildOffsetClause } from './internals/buildLimitOffset.ts';
import { _buildAfterPkWhereClause } from './internals/buildAfterPkWhere.ts';
import { _buildAfterBoundaryWhereClause, type BoundaryEntry } from './internals/buildAfterBoundaryWhere.ts';
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
 * @note A primary key tiebreaker is appended to the sort per `resolveSort` — always ascending,
 *   unless the sort already ends on the primary key.
 * @note Null values sort last (Postgres `NULLS LAST`; SQLite simulated). The per-dialect standard
 *   test suites verify parity with `sortAndSliceObjects`.
 * @note `after_boundary` pages by value and stays walk-complete even when the boundary row is deleted;
 *   `table.columnKinds` drives how each boundary value is bound. See `SortAndSlice` and `ColumnTableInfo`.
 * @note A column declared `'text'` has its ORDER BY and cursor comparisons pinned with `COLLATE "C"`
 *   (Postgres) so they match `compareValues`; a `'boolean'` column's boundary value is translated to the
 *   stored form (`1`/`0` for SQLite, a real boolean for Postgres). Undeclared columns bind raw and unpinned.
 * @note A column declared `'bigint'` orders bare (an int64 column already orders numerically, matching
 *   the comparator's merged numeric bracket) and binds boundary values exactly: the encoded
 *   `{ $bigint: '<decimal>' }` form produced by `encodeSortValue`, or a safe-integer number, within the
 *   int64 range — bound as a canonical decimal string for Postgres and a native JS BigInt for SQLite.
 *   Lossy shapes (unsafe-magnitude or fractional numbers, bare decimal strings, out-of-range values) are
 *   rejected as `cursor` errors rather than silently mis-anchoring the walk.
 *
 * @remarks
 * Minting a bigint boundary requires the driver to hydrate the column losslessly first: node-postgres
 * returns int8 as a string by default (fix with `types.setTypeParser(20, BigInt)`), and better-sqlite3
 * returns doubles that lose precision past 2^53 (fix with `statement.safeIntegers(true)`). Pass the
 * hydrated bigint through `encodeSortValue` when building the boundary; the `cursor` rejection
 * messages name these remedies when a lossy shape reaches the binder.
 *
 * A bigint-kind PRIMARY KEY has a narrower window: `SortBoundary.pk` is a `PrimaryKeyValue`
 * (string | number), so the synthetic pk tiebreaker cannot carry the encoded bigint form. Keyset
 * pagination over a bigint pk column therefore works only while pk values fit safe-integer
 * precision (≤ 2^53 − 1); beyond that, the build fails with a loud `cursor` error rather than
 * anchoring the walk on an imprecise value.
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
        // The pk is a runtime string here, so the sort is handled in its key-widened form.
        resolvedSort = resolveSort<Record<string, any>>(parsed.data.sort, table.pkColumnName);
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

    // Column names used directly (identity function — never fails). The declared kind rides along
    // so the sort/cursor builders can pin text collation, translate booleans, and validate boundary
    // values the same way the column is ordered. An undeclared column carries no kind (binds raw).
    // A text column is pinned to code-point (C) collation on Postgres so ORDER BY and cursor
    // comparisons match compareValues regardless of the database's locale.
    const pathToSqlExpression = (key: string): DotPropPathConversionResult => {
        const kind = table.columnKinds[key];
        if (kind === undefined) return { success: true, expression: quoteIdentifier(key) };
        const bareExpression = quoteIdentifier(key);
        const expression = dialect === 'pg' && kind === 'text' ? `${bareExpression} COLLATE "C"` : bareExpression;
        return { success: true, expression, kind };
    };

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

    // 5b. Build value-based keyset WHERE (if after_boundary present). Binds the boundary's values
    // directly — no correlated subquery — so a deleted boundary row does not truncate the walk.
    let boundaryStatement: SqlFragment | null = null;
    if (parsed.data.after_boundary !== undefined && resolvedSort) {
        const boundary = parsed.data.after_boundary;
        const userSort = parsed.data.sort ?? [];
        const entries: BoundaryEntry[] = userSort.map((e, i) => ({
            key: e.key,
            direction: e.direction,
            value: boundary.values[i]!,
        }));
        // Append the synthetic pk tiebreaker entry exactly when resolveSort appended one.
        if (resolvedSort.length > userSort.length) {
            entries.push({ key: table.pkColumnName, direction: 1, value: encodeSortValue(boundary.pk) });
        }
        const boundaryResult = _buildAfterBoundaryWhereClause(entries, pathToSqlExpression, dialect);
        if (!boundaryResult.success) {
            return { success: false, errors: boundaryResult.errors };
        }
        boundaryStatement = boundaryResult.statement;
    }

    // 6. Compose WHERE clauses
    const whereFragments: SqlFragment[] = [];
    if (cursorStatement) {
        whereFragments.push(cursorStatement);
    }
    if (boundaryStatement) {
        whereFragments.push(boundaryStatement);
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
