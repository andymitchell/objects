import type { z } from "zod";
import type { DotPropPathsUnion } from "../dot-prop-paths/types.ts";
import type { PrimaryKeyValue } from '../utils/getKeyValue.ts';
import type { PreparedStatementArgument } from '../utils/sql/types.ts';
import type { PreparedWhereClauseStatement } from '../where-filter/sql/types.ts';
import type { SortAndSliceSchema, SortAndSliceBaseSchema, SortAndSliceCursorSchema, SortDefinitionSchema, SortEntrySchema } from './schemas.ts';
import { isTypeEqual } from "@andyrmitchell/utils";

// Re-export for consumer convenience
export type { PrimaryKeyValue } from '../utils/getKeyValue.ts';

/**
 * A single sort entry: key + direction. Mongo-style: 1 = ascending, -1 = descending.
 */
export type SortEntry<T> = { key: DotPropPathsUnion<T>; direction: 1 | -1 };

/**
 * Ordered list of sort keys with direction, applied in priority order (first entry is the
 * primary sort). Uses Mongo-style direction values: `1` = ascending, `-1` = descending.
 * Keys are dot-prop paths into `T` (e.g. `'sender.name'`), the same path format used
 * by `WhereFilterDefinition`.
 *
 * Used as the `sort` field of `SortAndSlice`. All query functions (`sortAndSliceObjects`,
 * `prepareObjectTableQuery`, `prepareColumnTableQuery`) automatically append a primary key
 * tiebreaker to the end of the sort definition to guarantee deterministic ordering.
 *
 * @example
 * const sort: SortDefinition<Email> = [
 *   { key: 'date', direction: -1 },       // primary: newest first
 *   { key: 'sender.name', direction: 1 }   // secondary: alphabetical
 * ];
 *
 * @note Dot-prop keys work with relational tables too — they just have no depth (e.g. `'created_at'`).
 */
export type SortDefinition<T> = Array<SortEntry<T>>;

/**
 * Shared query fields available in all pagination modes: sort and limit.
 * Constraint for ICollection's 5th generic (`S extends SortAndSliceBase<T>`),
 * guaranteeing `sort` and `limit` are always accessible regardless of pagination mode.
 *
 * @see SortAndSlice — offset/after_pk pagination (databases, in-memory)
 * @see SortAndSliceCursor — opaque cursor pagination (API bridges)
 *
 * @example
 * function processQuery<S extends SortAndSliceBase<T>>(query: S) {
 *   if (query.limit) { ... }  // always available
 * }
 */
export type SortAndSliceBase<T> = {
    sort?: SortDefinition<T>;
    limit?: number;
}

/**
 * Unified query configuration for sorting and paginating a collection. Accepted by all query
 * functions — `sortAndSliceObjects` (JS runtime), `prepareObjectTableQuery` (JSON-column SQL),
 * and `prepareColumnTableQuery` (relational SQL) — so the same config produces identical
 * ordering whether applied in-memory or in a database.
 *
 * Supports three independent capabilities, all optional:
 * - **Sorting:** Multi-key sort via `sort` (Mongo-style: `1` = ASC, `-1` = DESC).
 * - **Pagination:** Either cursor-based (`after_pk` — the PK of the last item on the previous
 *   page) or offset-based (`offset`). These are mutually exclusive, enforced at the type level.
 *   `after_pk` requires a non-empty `sort`.
 * - **Limiting:** `limit` caps the number of returned items.
 *
 * All query functions automatically append a primary key tiebreaker to the sort, ensuring
 * deterministic ordering. Null/undefined values always sort last, matching SQL `NULLS LAST`.
 *
 * @example
 * // First page, 20 items, newest first
 * const page1: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20 };
 *
 * @example
 * // Next page using cursor (pass the PK of the last item from page 1)
 * const page2: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, after_pk: 'email_abc' };
 *
 * @example
 * // Offset-based pagination
 * const page3: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, offset: 40 };
 *
 * @example
 * // Limit only, no sorting
 * const limited: SortAndSlice<Email> = { limit: 100 };
 *
 * @note When using `after_pk` cursor pagination in SQL, the generated subquery count grows
 * O(N²) with the number of sort keys. Recommend ≤3 sort keys with `after_pk`.
 *
 * @see SortAndSliceBase — shared sort + limit fields (constraint for ICollection's 5th generic)
 * @see SortAndSliceCursor — opaque cursor mode for API bridges
 */
export type SortAndSlice<T> = SortAndSliceBase<T> & (
    | { offset?: number; after_pk?: never }
    | { offset?: never; after_pk?: PrimaryKeyValue }
);

/**
 * Opaque-cursor pagination mode for API bridges (Gmail, Stripe, Notion) where the
 * next-page token is a string returned by the provider, not computable by the caller.
 * Extends {@link SortAndSliceBase} — `sort` and `limit` are always available.
 *
 * On the first call, omit `cursor`. On subsequent calls, pass the `next_page_cursor`
 * from the previous response.
 *
 * @example
 * // First page
 * const page1: SortAndSliceCursor<Thread> = { limit: 20 };
 *
 * @example
 * // Next page
 * const page2: SortAndSliceCursor<Thread> = { limit: 20, cursor: response.next_page_cursor };
 */
export type SortAndSliceCursor<T> = SortAndSliceBase<T> & {
    cursor?: string;
}

/** Error from query validation or building. */
export type QueryError = { type: string; message: string };

/**
 * Result of sortAndSliceObjects — success with items, or failure with errors.
 */
export type SortAndSliceObjectsResult<T> =
    | { success: true; items: T[] }
    | { success: false; errors: QueryError[] };

/**
 * Decomposed SQL query output — each clause is a separate, independent fragment so the caller
 * can compose, inspect, or discard individual clauses before assembling the final SQL.
 * Returned by both `prepareObjectTableQuery` and `prepareColumnTableQuery`.
 *
 * No SQL keywords are included (no `WHERE`, `ORDER BY`, etc.) — the caller or
 * `flattenQueryClausesToSql` adds them. Parameterised fragments use `PreparedWhereClauseStatement`
 * (`{ where_clause_statement, statement_arguments }`), while `order_by_statement` is a plain
 * string (no parameters).
 *
 * @example
 * const result = prepareObjectTableQuery('pg', table, filter, sortAndSlice);
 * if (result.success) {
 *   // Use individual clauses
 *   console.log(result.order_by_statement); // e.g. "(data->>'date')::text DESC NULLS LAST"
 *   // Or flatten into a single SQL string
 *   const { sql, parameters } = flattenQueryClausesToSql(result, 'pg');
 * }
 */
export type PreparedQueryClauses = {
    where_statement: PreparedWhereClauseStatement | null;
    order_by_statement: string | null;
    limit_statement: PreparedWhereClauseStatement | null;
    offset_statement: PreparedWhereClauseStatement | null;
};

/**
 * Discriminated union result from SQL query builders. Check `.success` before accessing clauses.
 * On failure, `errors` contains validation or building errors (e.g. invalid sort keys, schema
 * violations) as values — never thrown.
 */
export type PreparedQueryClausesResult =
    | ({ success: true } & PreparedQueryClauses)
    | { success: false; errors: QueryError[] };

export type TableInfo = { tableName: string };

/**
 * Table descriptor for a JSON-column table — a relational table where objects are stored as
 * JSON in a single column (e.g. Postgres JSONB or SQLite JSON TEXT). Used by `prepareObjectTableQuery`
 * to generate sort expressions that extract values from the JSON column via dot-prop paths.
 *
 * The `schema` serves two purposes: it validates that sort key paths actually exist in the
 * object shape (preventing SQL injection via arbitrary paths), and it provides type information
 * for dialect-specific casting (e.g. Postgres `::numeric` vs `::text`).
 *
 * @example
 * const table: ObjectTableInfo<Email> = {
 *   tableName: 'emails',
 *   objectColumnName: 'data',
 *   ddl: { primary_key: 'id' },
 *   schema: EmailSchema, // Zod schema defining the JSON object shape
 * };
 */
export type ObjectTableInfo<T extends Record<string, any>> = TableInfo & {
    objectColumnName: string;
    ddl: { primary_key: string };
    schema: z.ZodSchema<T>;
};

/**
 * Table descriptor for a traditional relational table where columns map directly to fields.
 * Used by `prepareColumnTableQuery` to generate sort expressions using column names directly
 * (no JSON path extraction).
 *
 * `allowedColumns` is a whitelist that prevents SQL injection — sort keys are validated against
 * this list, and any key not present causes a `QueryError`. The PK column must be included
 * in `allowedColumns` since it is used as an automatic tiebreaker.
 *
 * @example
 * const table: ColumnTableInfo = {
 *   tableName: 'users',
 *   pkColumnName: 'id',
 *   allowedColumns: ['id', 'created_at', 'name', 'email'],
 * };
 */
export type ColumnTableInfo = TableInfo & {
    pkColumnName: string;
    allowedColumns: string[];
};

/**
 * A fully assembled SQL fragment with its parameter array, ready to append to
 * `SELECT * FROM table`. Produced by `flattenQueryClausesToSql` from decomposed `PreparedQueryClauses`.
 *
 * @example
 * const { sql, parameters } = flattenQueryClausesToSql(result, 'pg');
 * db.query(`SELECT * FROM emails ${sql}`, parameters);
 * // sql: "WHERE (data->>'sender')::text = $1 ORDER BY (data->>'date')::text DESC NULLS LAST LIMIT $2"
 * // parameters: ['Andy', 20]
 */
export type FlattenedQuerySql = {
    sql: string;
    parameters: PreparedStatementArgument[];
};


// --- Type alignment checks ---
// SortEntry: manual type uses DotPropPathsUnion<T> for key, schema uses plain string.
// The schema is intentionally looser at runtime. Verify the non-generic structural shape matches.
isTypeEqual<z.infer<typeof SortEntrySchema>, { key: string; direction: 1 | -1 }>(true);

// SortDefinition: schema infers Array<{key: string, direction: 1 | -1}>, manual type uses DotPropPaths<T>.
// Verify the non-generic structural shape matches.
isTypeEqual<z.infer<typeof SortDefinitionSchema>, Array<{ key: string; direction: 1 | -1 }>>(true);

// SortAndSlice: the manual type has a discriminated union for offset/after_pk that z.infer cannot express.
// We verify the schema's flat inferred shape matches the base fields.
type SortAndSliceSchemaInferred = z.infer<typeof SortAndSliceSchema>;
isTypeEqual<SortAndSliceSchemaInferred, {
    sort?: Array<{ key: string; direction: 1 | -1 }> | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    after_pk?: string | number | undefined;
}>(true);

// SortAndSliceBase: schema infers the shared base fields (sort + limit).
isTypeEqual<z.infer<typeof SortAndSliceBaseSchema>, {
    sort?: Array<{ key: string; direction: 1 | -1 }> | undefined;
    limit?: number | undefined;
}>(true);

// SortAndSliceCursor: schema infers base fields + cursor.
isTypeEqual<z.infer<typeof SortAndSliceCursorSchema>, {
    sort?: Array<{ key: string; direction: 1 | -1 }> | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
}>(true);
