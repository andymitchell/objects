import type { PreparedWhereClauseStatement } from '../../where-filter/sql/types.ts';
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
 * Prepares SQL clauses for a traditional relational table.
 * Sort keys map to column names directly (no JSON path extraction).
 *
 * @example
 * const result = prepareColumnTableQuery('pg', { tableName: 'users', pkColumnName: 'id', allowedColumns: ['id', 'created_at', 'name'] }, { sort: [{ key: 'created_at', direction: -1 }], limit: 50 });
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

    // Column names used directly (identity function)
    const pathToSqlExpression = (key: string): string => quoteIdentifier(key);

    // 4. Build ORDER BY
    const orderByStatement = resolvedSort
        ? _buildOrderByClause(resolvedSort, pathToSqlExpression, dialect)
        : null;

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
