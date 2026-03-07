import type { WhereFilterDefinition } from '../../where-filter/types.ts';
import { prepareWhereClauseForPg, PropertyTranslatorJsonbSchema } from '../../where-filter/sql/postgres/index.ts';
import { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema } from '../../where-filter/sql/sqlite/index.ts';
import type { PreparedWhereClauseStatement } from '../../where-filter/sql/types.ts';
import { convertDotPropPathToPostgresJsonPath } from '../../utils/sql/postgres/convertDotPropPathToPostgresJsonPath.ts';
import { convertDotPropPathToSqliteJsonPath } from '../../utils/sql/sqlite/convertDotPropPathToSqliteJsonPath.ts';
import { SortAndSliceSchema } from '../schemas.ts';
import type { ObjectTableInfo, PreparedQueryClausesResult, QueryError, SortAndSlice } from '../types.ts';
import type { SqlDialect, SqlFragment } from './types.ts';
import { _buildOrderByClause } from './internals/buildOrderByClause.ts';
import { _buildLimitClause, _buildOffsetClause } from './internals/buildLimitOffset.ts';
import { _buildAfterPkWhereClause } from './internals/buildAfterPkWhere.ts';
import { concatSqlParameters } from './internals/sqlParameterUtils.ts';

/** Converts internal SqlFragment to public PreparedWhereClauseStatement. */
function toWhereClauseStatement(fragment: SqlFragment): PreparedWhereClauseStatement {
    return { where_clause_statement: fragment.sql, statement_arguments: fragment.parameters };
}

/**
 * Prepares SQL clauses for a table storing JSON objects in a single column.
 * Composes WhereFilterDefinition (or pre-built WHERE) with SortAndSlice into a complete query.
 *
 * @example
 * const result = prepareObjectTableQuery('sqlite', table, { date: { $gt: '2024-01-01' } }, { sort: [{ key: 'date', direction: -1 }], limit: 20 });
 * if (result.success) { const flat = flattenQueryClausesToSql(result); }
 */
export function prepareObjectTableQuery<T extends Record<string, any>>(
    dialect: SqlDialect,
    table: ObjectTableInfo<T>,
    filter?: WhereFilterDefinition<T> | PreparedWhereClauseStatement,
    sortAndSlice?: SortAndSlice<T>,
    additionalWhereClauses?: PreparedWhereClauseStatement[]
): PreparedQueryClausesResult {
    // 1. Validate sortAndSlice
    if (sortAndSlice) {
        const parsed = SortAndSliceSchema.safeParse(sortAndSlice);
        if (!parsed.success) {
            const errors: QueryError[] = parsed.error.issues.map(issue => ({
                type: 'validation',
                message: issue.message,
            }));
            return { success: false, errors };
        }
    }

    // 2. Resolve sort with PK tiebreaker
    let resolvedSort: Array<{ key: string; direction: 1 | -1 }> | undefined;
    if (sortAndSlice?.sort && sortAndSlice.sort.length > 0) {
        const sortCopy = sortAndSlice.sort.map(e => ({ key: e.key as string, direction: e.direction }));
        const lastEntry = sortCopy[sortCopy.length - 1]!;
        if (lastEntry.key !== table.ddl.primary_key) {
            sortCopy.push({ key: table.ddl.primary_key, direction: 1 });
        }
        resolvedSort = sortCopy;
    }

    // Path-to-SQL converter for this table's JSON column
    const pathToSqlExpression = (dotPropPath: string): string => {
        if (dialect === 'pg') {
            return convertDotPropPathToPostgresJsonPath(table.objectColumnName, dotPropPath, table.schema);
        } else {
            return convertDotPropPathToSqliteJsonPath(table.objectColumnName, dotPropPath, table.schema);
        }
    };

    // 3. Build WHERE from filter
    let filterStatement: PreparedWhereClauseStatement | null = null;
    if (filter) {
        if (isPrebuiltWhereClause(filter)) {
            filterStatement = filter;
        } else {
            const filterResult = dialect === 'pg'
                ? prepareWhereClauseForPg(filter, new PropertyTranslatorJsonbSchema(table.schema, table.objectColumnName))
                : prepareWhereClauseForSqlite(filter, new PropertyTranslatorSqliteJsonSchema(table.schema, table.objectColumnName));

            if (!filterResult.success) {
                return {
                    success: false,
                    errors: filterResult.errors.map(e => ({ type: 'where_filter', message: e.message })),
                };
            }
            filterStatement = { where_clause_statement: filterResult.where_clause_statement, statement_arguments: filterResult.statement_arguments };
        }
    }

    // 4. Build ORDER BY
    const orderByStatement = resolvedSort
        ? _buildOrderByClause(resolvedSort, pathToSqlExpression, dialect)
        : null;

    // 5. Build cursor WHERE (if after_pk present)
    let cursorStatement: SqlFragment | null = null;
    if (sortAndSlice?.after_pk !== undefined && resolvedSort) {
        const pkExpression = pathToSqlExpression(table.ddl.primary_key);
        const cursorResult = _buildAfterPkWhereClause(
            sortAndSlice.after_pk,
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
    if (filterStatement) {
        whereFragments.push({ sql: filterStatement.where_clause_statement, parameters: filterStatement.statement_arguments });
    }
    if (cursorStatement) {
        whereFragments.push(cursorStatement);
    }
    if (additionalWhereClauses) {
        for (const clause of additionalWhereClauses) {
            whereFragments.push({ sql: clause.where_clause_statement, parameters: clause.statement_arguments });
        }
    }

    const composedWhere = whereFragments.length > 0
        ? toWhereClauseStatement(concatSqlParameters(whereFragments, dialect))
        : null;

    // 7. Build LIMIT/OFFSET
    const limitStatement = sortAndSlice?.limit !== undefined
        ? toWhereClauseStatement(_buildLimitClause(sortAndSlice.limit, dialect))
        : null;

    const offsetStatement = sortAndSlice?.offset !== undefined
        ? toWhereClauseStatement(_buildOffsetClause(sortAndSlice.offset, dialect))
        : null;

    return {
        success: true,
        where_statement: composedWhere,
        order_by_statement: orderByStatement,
        limit_statement: limitStatement,
        offset_statement: offsetStatement,
    };
}

/** Typeguard: value is a pre-built PreparedWhereClauseStatement (not a WhereFilterDefinition). */
function isPrebuiltWhereClause(value: unknown): value is PreparedWhereClauseStatement {
    return (
        typeof value === 'object' &&
        value !== null &&
        'where_clause_statement' in value &&
        'statement_arguments' in value
    );
}
