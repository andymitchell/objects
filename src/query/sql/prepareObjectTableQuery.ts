import type { WhereFilterDefinition } from '../../where-filter/types.ts';
import { prepareWhereClauseForPg, PropertyTranslatorPgJsonbSchema } from '../../where-filter/sql/postgres/index.ts';
import { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema } from '../../where-filter/sql/sqlite/index.ts';
import type { PreparedWhereClauseStatement } from '../../where-filter/sql/types.ts';
import type { DotPropPathConversionResult } from '../../utils/sql/types.ts';
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
 * Builds parameterised SQL clauses (WHERE, ORDER BY, LIMIT, OFFSET) for a table that stores
 * objects as JSON in a single column (e.g. Postgres JSONB or SQLite JSON TEXT). This is the
 * SQL counterpart to `sortAndSliceObjects` — both accept `SortAndSlice` and produce identical
 * ordering semantics for the same data.
 *
 * Sort keys are dot-prop paths into the JSON object (e.g. `'sender.name'`), converted to
 * dialect-specific JSON extraction expressions. The table's Zod schema validates that paths
 * exist and determines type casting (Postgres `::numeric`, `::text`, etc.).
 *
 * Optionally composes a `WhereFilterDefinition` (Mongo-style filter) or a pre-built WHERE
 * clause with cursor/offset pagination and additional WHERE clauses. All WHERE sources are
 * combined with AND, and parameter numbering is handled automatically.
 *
 * Returns decomposed `PreparedQueryClauses` — use `flattenQueryClausesToSql` to assemble
 * into a single SQL string, or access individual clauses for custom composition.
 *
 * @param dialect - SQL dialect: `'pg'` for Postgres (`$N` params) or `'sqlite'` (`?` params).
 * @param table - Table descriptor with JSON column name, primary key, and Zod schema. See `ObjectTableInfo`.
 * @param filter - Optional WHERE filter: a `WhereFilterDefinition` (Mongo-style, compiled internally)
 *   or a pre-built `PreparedWhereClauseStatement` (passed through as-is).
 * @param sortAndSlice - Optional sorting and pagination config. See `SortAndSlice`.
 * @param additionalWhereClauses - Optional extra WHERE clauses (e.g. access control, soft-delete filters)
 *   combined with AND alongside the filter and cursor clauses.
 * @returns `{ success: true, ...PreparedQueryClauses }` on success,
 *   `{ success: false, errors: QueryError[] }` on validation or building failure. Never throws.
 *
 * @example
 * // Sort + filter + limit → flatten to SQL
 * const result = prepareObjectTableQuery('pg', table, { sender: 'Andy' }, {
 *   sort: [{ key: 'date', direction: -1 }], limit: 20,
 * });
 * if (result.success) {
 *   const { sql, parameters } = flattenQueryClausesToSql(result, 'pg');
 *   db.query(`SELECT * FROM emails ${sql}`, parameters);
 * }
 *
 * @example
 * // Cursor pagination for page 2
 * const page2 = prepareObjectTableQuery('sqlite', table, undefined, {
 *   sort: [{ key: 'date', direction: -1 }], limit: 20, after_pk: 'email_abc',
 * });
 *
 * @example
 * // Filter + additional access-control WHERE clause
 * const result = prepareObjectTableQuery('pg', table, { status: 'active' }, { limit: 50 }, [
 *   { where_clause_statement: 'owner_id = $1', statement_arguments: ['user_123'] },
 * ]);
 *
 * @note A primary key tiebreaker is automatically appended to the sort to ensure deterministic ordering.
 * @note Null values sort last (Postgres `NULLS LAST`, SQLite simulated), matching `sortAndSliceObjects` behaviour.
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
    const pathToSqlExpression = (dotPropPath: string): DotPropPathConversionResult => {
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
                ? prepareWhereClauseForPg(filter, new PropertyTranslatorPgJsonbSchema(table.schema, table.objectColumnName))
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
    let orderByStatement: string | null = null;
    if (resolvedSort) {
        const orderByResult = _buildOrderByClause(resolvedSort, pathToSqlExpression, dialect);
        if (!orderByResult.success) {
            return { success: false, errors: orderByResult.errors };
        }
        orderByStatement = orderByResult.orderBy;
    }

    // 5. Build cursor WHERE (if after_pk present)
    let cursorStatement: SqlFragment | null = null;
    if (sortAndSlice?.after_pk !== undefined && resolvedSort) {
        const pkResult = pathToSqlExpression(table.ddl.primary_key);
        if (!pkResult.success) {
            return { success: false, errors: [{ type: 'path_conversion', message: pkResult.error.message }] };
        }
        const pkExpression = pkResult.expression;
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
