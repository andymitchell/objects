import type { WhereFilterDefinition } from '../../where-filter/types.ts';
import { prepareWhereClauseForPg, PropertyTranslatorPgJsonbSchema } from '../../where-filter/sql/postgres/index.ts';
import { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema } from '../../where-filter/sql/sqlite/index.ts';
import type { PreparedWhereClauseStatement } from '../../where-filter/sql/types.ts';
import type { DotPropPathConversionResult } from '../../utils/sql/types.ts';
import { buildSortKeyExpression } from './buildSortKeyExpression.ts';
import { SortAndSliceSchema } from '../schemas.ts';
import { encodeSortValue, resolveSort } from '../sortCompare.ts';
import type { ObjectTableInfo, PreparedQueryClausesResult, QueryError, SortAndSlice } from '../types.ts';
import type { SqlDialect, SqlFragment } from './types.ts';
import { _buildOrderByClause } from './internals/buildOrderByClause.ts';
import { _buildLimitClause, _buildOffsetClause } from './internals/buildLimitOffset.ts';
import { _buildAfterPkWhereClause } from './internals/buildAfterPkWhere.ts';
import { _buildAfterBoundaryWhereClause, type BoundaryEntry } from './internals/buildAfterBoundaryWhere.ts';
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
 * @note A primary key tiebreaker is appended to the sort per `resolveSort` — always ascending,
 *   unless the sort already ends on the primary key.
 * @note Null values sort last (Postgres `NULLS LAST`; SQLite simulated). The per-dialect standard
 *   test suites verify parity with `sortAndSliceObjects`.
 * @note Sort keys must address scalar leaves. A key whose schema type is an object or array is
 *   refused (`unexpected_kind`): structural values have no ordering the JS comparator and both
 *   SQL dialects agree on.
 * @note Bigint-classified sort keys are refused (`unsupported_kind`): JSON cannot carry a bigint,
 *   so no stored value can order by one — sort by a serialisable form instead, or use a column
 *   table. The refusal follows schema classification, including transparent wrappers
 *   (nullable/optional/default/catch/readonly) and unions whose winning arm is bigint;
 *   compositions with no clean scalar family (e.g. a union won by a non-bigint arm, pipes) follow
 *   the pre-existing kind-less path, which promises no cross-engine ordering for any type family.
 *   Because the pk tiebreaker resolves through the same converter, a bigint primary key refuses
 *   every sorted or cursor query on the table.
 * @note `after_boundary` pages by value (the previous page's encoded sort values plus its pk), binding
 *   those values directly with no correlated subquery, so the walk stays complete even if the boundary
 *   row has since been deleted. See `SortAndSlice`.
 * @note Postgres text sort and cursor comparisons are pinned with `COLLATE "C"` (code-point order), so
 *   ORDER BY and keyset predicates match `compareValues` regardless of the database's default locale.
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
        // The pk is a runtime string here, so the sort is handled in its key-widened form.
        resolvedSort = resolveSort<Record<string, any>>(
            sortAndSlice.sort.map(e => ({ key: e.key as string, direction: e.direction })),
            table.ddl.primary_key
        );
    }

    // Every clause that reads a sort key — ORDER BY and both keyset builders — resolves it here, so
    // all of them, and any expression index built to serve them, carry byte-identical text.
    const pathToSqlExpression = (dotPropPath: string): DotPropPathConversionResult =>
        buildSortKeyExpression(dialect, table.objectColumnName, dotPropPath, table.schema);

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
            return { success: false, errors: [{ type: pkResult.error.type, message: pkResult.error.message }] };
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

    // 5b. Build value-based keyset WHERE (if after_boundary present). Binds the boundary's values
    // directly — no correlated subquery — so a deleted boundary row does not truncate the walk.
    let boundaryStatement: SqlFragment | null = null;
    if (sortAndSlice?.after_boundary !== undefined && resolvedSort) {
        const boundary = sortAndSlice.after_boundary;
        const userSort = sortAndSlice.sort ?? [];
        const entries: BoundaryEntry[] = userSort.map((e, i) => ({
            key: e.key as string,
            direction: e.direction,
            value: boundary.values[i]!,
        }));
        // Append the synthetic pk tiebreaker entry exactly when resolveSort appended one.
        if (resolvedSort.length > userSort.length) {
            entries.push({ key: table.ddl.primary_key, direction: 1, value: encodeSortValue(boundary.pk) });
        }
        const boundaryResult = _buildAfterBoundaryWhereClause(entries, pathToSqlExpression, dialect);
        if (!boundaryResult.success) {
            return { success: false, errors: boundaryResult.errors };
        }
        boundaryStatement = boundaryResult.statement;
    }

    // 6. Compose WHERE clauses
    const whereFragments: SqlFragment[] = [];
    if (filterStatement) {
        whereFragments.push({ sql: filterStatement.where_clause_statement, parameters: filterStatement.statement_arguments });
    }
    if (cursorStatement) {
        whereFragments.push(cursorStatement);
    }
    if (boundaryStatement) {
        whereFragments.push(boundaryStatement);
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
