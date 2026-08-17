import type { z } from "zod";
import type { DotPropPathsUnion } from "../dot-prop-paths/types.ts";
import type { PrimaryKeyValue } from '../utils/getKeyValue.ts';
import type { PreparedStatementArgument, SortValueKind } from '../utils/sql/types.ts';
import type { PreparedWhereClauseStatement } from '../where-filter/sql/types.ts';
import type { EncodedSortValue } from './sortCompare.ts';
import type { SortAndSliceSchema, SortAndSliceBaseSchema, SortAndSliceCursorSchema, SortBoundarySchema, EncodedSortValueSchema, SortDefinitionSchema, SortEntrySchema } from './schemas.ts';
import { isTypeEqual } from "@andyrmitchell/utils";

// Re-export for consumer convenience
export type { PrimaryKeyValue } from '../utils/getKeyValue.ts';

/**
 * A single sort entry: key + direction. Mongo-style: 1 = ascending, -1 = descending.
 *
 * @remarks
 * A sort key must resolve to ONE value per row, so the key domain is the plain dot-prop path union —
 * narrower than a filter's, which also offers paths that step into an array and fan out to a value per
 * element. Such a path has no single value to order rows by, so it is deliberately not offered here.
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
 * A pagination boundary captured by value: the encoded sort-key values of the last row on a
 * page, plus that row's primary key. Feeding it back as `after_boundary` resumes the walk
 * strictly after this position.
 *
 * Unlike `after_pk` (which re-finds the boundary row by identity), a boundary carries the
 * position itself, so the next page is correct even if the boundary row has since been deleted —
 * the walk stays complete. `values` are the {@link EncodedSortValue}s of the user's `sort` keys,
 * in the same order, and are safe to serialise inside an opaque cursor.
 *
 * @example
 * // Mint a boundary from the last row of a page, then request the next page
 * const last = page[page.length - 1];
 * const boundary: SortBoundary = { values: [encodeSortValue(last.date)], pk: last.id };
 * const next: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, after_boundary: boundary };
 *
 * @remarks `values.length` must equal the user's `sort.length` (aligned 1:1, before the automatic
 * primary-key tiebreaker is appended).
 */
export type SortBoundary = {
    values: EncodedSortValue[];
    pk: PrimaryKeyValue;
};

/**
 * Unified query configuration for sorting and paginating a collection. Accepted by all query
 * functions — `sortAndSliceObjects` (JS runtime), `prepareObjectTableQuery` (JSON-column SQL),
 * and `prepareColumnTableQuery` (relational SQL) — so the same config produces identical
 * ordering whether applied in-memory or in a database.
 *
 * Supports these independent capabilities, all optional:
 * - **Sorting:** Multi-key sort via `sort` (Mongo-style: `1` = ASC, `-1` = DESC).
 * - **Pagination:** One of three mutually-exclusive modes (enforced at the type level):
 *   - `after_boundary` — value-based keyset: resume after the last row's encoded sort values.
 *     The walk stays complete even if the boundary row is deleted mid-walk. Requires a non-empty `sort`.
 *   - `after_pk` — identity-anchor keyset: resume after the row with this PK. Cheaper to express
 *     but truncates the walk if the anchor row is deleted. Requires a non-empty `sort`.
 *   - `offset` — skip a fixed number of rows.
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
 * // Next page, walk-complete: resume after the last row's values (survives deletion of that row)
 * const boundary: SortBoundary = { values: [encodeSortValue(last.date)], pk: last.id };
 * const page2: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, after_boundary: boundary };
 *
 * @example
 * // Next page, identity-anchor: resume after the PK of the last item from page 1
 * const page2b: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, after_pk: 'email_abc' };
 *
 * @example
 * // Offset-based pagination
 * const page3: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, offset: 40 };
 *
 * @note When using `after_pk` cursor pagination in SQL, the generated subquery count grows
 * O(N²) with the number of sort keys. Recommend ≤3 sort keys with `after_pk`. `after_boundary`
 * has no subqueries — it binds the boundary values directly — and scales linearly.
 *
 * @see SortBoundary — the value-based boundary passed as `after_boundary`
 * @see SortAndSliceBase — shared sort + limit fields (constraint for ICollection's 5th generic)
 * @see SortAndSliceCursor — opaque cursor mode for API bridges
 */
export type SortAndSlice<T> = SortAndSliceBase<T> & (
    | { offset?: number; after_pk?: never; after_boundary?: never }
    | { offset?: never; after_pk?: PrimaryKeyValue; after_boundary?: never }
    | { offset?: never; after_pk?: never; after_boundary?: SortBoundary }
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
 * A sort key is read as a JSON extraction expression, not a bare column, so an index meant to serve
 * a sorted or paged query must be an expression index built on that exact expression — cast and
 * collation included, since Postgres matches an index to a query structurally. Ask
 * `buildSortKeyExpression` for the text rather than reconstructing it: a hand-written rendering of
 * the same path produces an index the emitted queries cannot use.
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
 * `columnKinds` declares each column's comparison family (see {@link SortValueKind}). Unlike an
 * object table — whose Zod schema lets the converter infer each leaf's kind — a relational table
 * has no schema to introspect, so the kind must be declared. It drives text-collation pinning
 * (`'text'` → `COLLATE "C"`), boundary-value binding (`'boolean'` → dialect-correct `1`/`0` vs a
 * real boolean; `'bigint'` → exact int64 binding of encoded or safe-integer boundary values,
 * rejecting lossy shapes — note that a bigint-kind PRIMARY KEY supports keyset pagination only
 * for pk values within safe-integer precision, since `SortBoundary.pk` cannot carry the encoded
 * form), and boundary-value validation (`'numeric'`). A column left undeclared
 * is bound raw and left unpinned — correct only when its natural ordering already matches the
 * comparator (which does not hold for text on a non-`C` database, nor for booleans on SQLite),
 * so declare every column you sort or paginate on. An empty object (`{}`) is valid.
 *
 * A `'text'` column's ORDER BY and cursor comparisons are emitted as `col COLLATE "C"`, so any index
 * meant to serve them must be built on that same pinned expression (e.g. `CREATE INDEX ... ON t (col
 * COLLATE "C")`) — a plain index on `col` will not be used. An undeclared column carries no pin, so a
 * plain index serves it, at the cost of the code-point ordering guarantee above.
 *
 * @example
 * const table: ColumnTableInfo = {
 *   tableName: 'users',
 *   pkColumnName: 'id',
 *   allowedColumns: ['id', 'created_at', 'name', 'email'],
 *   columnKinds: { id: 'text', created_at: 'text', name: 'text', email: 'text' },
 * };
 */
export type ColumnTableInfo = TableInfo & {
    pkColumnName: string;
    allowedColumns: string[];
    columnKinds: Partial<Record<string, SortValueKind>>;
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

// EncodedSortValue: schema is the runtime witness of the string | number | EncodedBigInt | null contract.
isTypeEqual<z.infer<typeof EncodedSortValueSchema>, EncodedSortValue>(true);

// SortBoundary: manual type and schema must stay in lockstep (values + pk).
isTypeEqual<z.infer<typeof SortBoundarySchema>, SortBoundary>(true);

// SortAndSlice: the manual type has a discriminated union for offset/after_pk/after_boundary that
// z.infer cannot express. We verify the schema's flat inferred shape matches the base fields.
type SortAndSliceSchemaInferred = z.infer<typeof SortAndSliceSchema>;
isTypeEqual<SortAndSliceSchemaInferred, {
    sort?: Array<{ key: string; direction: 1 | -1 }> | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    after_pk?: string | number | undefined;
    after_boundary?: SortBoundary | undefined;
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
