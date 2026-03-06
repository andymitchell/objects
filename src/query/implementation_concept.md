### Design Principles

1. **Option A primitives are internal.** Consumers never import `buildOrderByClause` or `buildAfterPkWhereClause` directly.
2. **WHERE composition is the builder's job.** Filter WHERE, cursor WHERE, and any custom WHERE clauses are all collected internally and combined via `concatSqlParameters`. The consumer never rebases parameters.
3. **Two table modes.** `WhereFilterDefinition` operates exclusively on JSON columns. But ordering/pagination should work for both JSON-column tables and traditional relational tables. Two functions, two `TableInfo` variants.
4. **Table name is a function parameter, not baked into types.** `TableInfo` is a plain argument object.
5. **Filter accepts both raw and high-level forms.** Pass a `WhereFilterDefinition<T>` (converted internally via the appropriate dialect's where-clause builder) or a pre-built `PreparedWhereClauseStatement`. Either works.
6. **Dialect is a parameter.** `'pg' | 'sqlite'` as first argument — no duplicated function names per dialect.

### Revised Types

```ts
type SqlDialect = 'pg' | 'sqlite';

type SortDefinition<T> = Array<{ key: DotPropPaths<T>; direction: 1 | -1 }>;

type PrimaryKeyValue = string | number;

/**
 * Optional sorting and slicing of a collection.
 * All fields optional — omit entirely for unordered full results.
 */
type SortAndSlice<T> = {
  /** Sort keys. Falls back to DDL's default_order_by when omitted. */
  sort?: SortDefinition<T>;
  /** Max items to return. */
  limit?: number;
  /** Skip this many items (offset-based pagination). */
  offset?: number;
  /** Return items after this primary key value (cursor-based pagination). */
  after_pk?: PrimaryKeyValue;
};
```

Existing system types used as-is (import these)

```ts
type PreparedStatementArgument = string | number | boolean | null;
type PreparedWhereClauseStatement = {
  whereClauseStatement: string;
  statementArguments: PreparedStatementArgument[];
};
```

### Result Types

```ts
/** Canonical type — full prepared query output (WHERE + ORDER BY + LIMIT + OFFSET). */
type PreparedQueryStatement = {
  /** Combined WHERE clause (filter + cursor + additional). No 'WHERE' keyword. */
  where_statement: PreparedWhereClauseStatement | null;
  /** ORDER BY clause. No 'ORDER BY' keyword. */
  order_by_statement: string | null;
  /** LIMIT clause. No 'LIMIT' keyword. */
  limit_statement: PreparedWhereClauseStatement | null;
  /** OFFSET clause. No 'OFFSET' keyword. */
  offset_statement: PreparedWhereClauseStatement | null;
};

/** Alias — nicer DX when working with prepareTableSortAndSlice (where "query" overpromises). */
type PreparedSortAndSliceStatement = PreparedQueryStatement;

type QueryError = { type: string; message: string };

type PreparedQueryResult =
  | ({ success: true } & PreparedQueryStatement)
  | { success: false; errors: QueryError[] };

/** Alias — pairs with prepareTableSortAndSlice. */
type PreparedSortAndSliceResult = PreparedQueryResult;
```

### Table Info Variants

```ts
/** Base — only needed when after_pk is used (for the CTE subquery). */
type TableInfo = {
  tableName: string;
};

/** JSON-column table: objects stored as JSON in a single column. */
type TableInfoJsonObject<T extends Record<string, any>> = TableInfo & {
  objectColumnName: string;
  ddl: DDL<T>;         // Provides primary_key for after_pk resolution
  schema: z.ZodSchema<T>; // Needed to convert WhereFilterDefinition → PreparedWhereClauseStatement
};

/** Traditional relational table: columns map directly to fields. */
type TableInfoRelational = TableInfo & {
  pkColumnName: string; // Column name of the primary key
};
```

### Public API — Prepare Functions

```ts
/**
 * Prepare SQL clauses for a table storing JSON objects.
 *
 * Accepts filter as WhereFilterDefinition (converted internally) or
 * pre-built PreparedWhereClauseStatement. Cursor (after_pk), filter,
 * and additionalWhereClauses are all ANDed together internally.
 */
function prepareObjectsTableQuery<T extends Record<string, any>>(
  dialect: SqlDialect,
  table: TableInfoJsonObject<T>,
  filter?: WhereFilterDefinition<T> | PreparedWhereClauseStatement,
  sortAndSlice?: SortAndSlice<T>,
  additionalWhereClauses?: PreparedWhereClauseStatement[]
): PreparedQueryResult;

/**
 * Prepare SQL clauses for a traditional relational table.
 *
 * Sort keys map to column names directly (no JSON path extraction).
 */
function prepareTableSortAndSlice<T extends Record<string, any>>(
  dialect: SqlDialect,
  table: TableInfoRelational,
  sortAndSlice: SortAndSlice<T>,
  whereClauses?: PreparedWhereClauseStatement[]
): PreparedSortAndSliceResult;
```

### Public API — Flattening Helper

```ts
type FlattenedQuerySql = {
  /** "WHERE x = $1 ORDER BY y DESC LIMIT $2 OFFSET $3" */
  sql: string;
  /** All parameters in correct positional order. */
  parameters: PreparedStatementArgument[];
};

/**
 * Flatten a successful PreparedQueryStatement into a single SQL
 * fragment + parameter array. Useful for the common case of appending
 * to a "SELECT * FROM table" string.
 */
function flattenPreparedQueryStatementToSql(
  result: PreparedQueryStatement
): FlattenedQuerySql;
```

### Internal Implementation (Option A Primitives)

Internally, each builder delegates to the same primitives from Option A. These are **not exported**:

```ts
// internal: generates "data->>'date' DESC, data->>'id' ASC"
function _buildOrderByClause<T>(
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>
): string;

// internal: generates WHERE fragment for cursor pagination
function _buildAfterPkWhereClause<T>(
  afterPk: PrimaryKeyValue,
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>,
  tableName: string,
  pkExpression: string  // e.g. "data->>'id'" or "id"
): PreparedWhereClauseStatement;

// internal: generates "$N" or "?" with parameter depending on dialect
function _buildLimitClause(limit: number, paramOffset: number): PreparedWhereClauseStatement;
function _buildOffsetClause(offset: number, paramOffset: number): PreparedWhereClauseStatement;
```
