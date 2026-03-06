# Implementation Plan


## INTENT

The `query/` module provides **ordering, cursor pagination, offset pagination, and limits** as standalone, or as a composable layer alongside `WhereFilterDefinition`. It works across JS runtime and SQL backends (Postgres, SQLite) with a unified type (`SortAndSlice`), following Mongo-style conventions. 

Consumers can combine a `WhereFilterDefinition` (the WHERE) with a `SortAndSlice` (the ORDER BY + LIMIT + OFFSET + cursor) to produce a complete query.

## CORE TERMS

### SQL Table Types
This library deals with two set ups: 
* ObjectTable: a relational table with 1 JSON column to store objects (that match a schema). This is also what `where-filter` sql works on exclusively (it can't do relational flat tables)
* ColumnTable: a traditional relational table

---

## Analysis: Shared SQL Utilities → `src/utils/sql/`

ORDER BY on JSON columns needs dot-prop-path to SQL-expression conversion. The existing `convertDotPropPathToPostgresJsonPath` and `convertDotPropPathToSqliteJsonPath` handle this with correct type casting (Pg: `::numeric`, `::text`; SQLite: `json_extract` returns native types). These currently live in `where-filter/sql/` but have **no dependency on WhereFilterDefinition** — they're general SQL utilities that both `where-filter/` and `query/` need.

**Decision: Extract to `src/utils/sql/`.** This avoids `query/` reaching into `where-filter/`'s internals. Both modules import from `utils/sql/` instead. The project already has `src/utils/` for shared utilities.

### What moves to `src/utils/sql/`

**Path converters** (moved from `where-filter/sql/postgres/` and `where-filter/sql/sqlite/`):
- `convertDotPropPathToPostgresJsonPath` — depends only on `TreeNodeMap` from `dot-prop-paths`
- `convertDotPropPathToSqliteJsonPath` — same

**Base SQL types** (moved from `where-filter/sql/types.ts`):
- `PreparedStatementArgument` = `string | number | boolean | null`
- `PreparedStatementArgumentOrObject` = `PreparedStatementArgument | object`
- `isPreparedStatementArgument` typeguard

**Stays in `where-filter/sql/`** (depends on `WhereFilterDefinition`):
- `IPropertyTranslator`, `WhereClauseError`, `PreparedWhereClauseResult`, `PreparedWhereClauseStatement`
- `ValueComparisonRangeOperatorSqlFunctions`, `sharedSqlOperators.ts`
- `compileWhereFilter.ts`
- `PropertyTranslatorJsonb` / `PropertyTranslatorSqliteJson` (import path converters from `utils/sql/`)

### File structure: `src/utils/sql/`

```
src/utils/sql/
  types.ts                    — PreparedStatementArgument, isPreparedStatementArgument
  postgres/
    convertDotPropPathToPostgresJsonPath.ts  — moved from where-filter
  sqlite/
    convertDotPropPathToSqliteJsonPath.ts    — moved from where-filter
  index.ts                    — barrel
```

### Import graph after extraction

- `utils/sql/` ← imports from `dot-prop-paths/` (TreeNodeMap)
- `where-filter/sql/` ← imports from `utils/sql/` (path converters, base types)
- `query/sql/` ← imports from `utils/sql/` (path converters, base types)
- `query/sql/` ← imports from `where-filter/` (only `prepareWhereClauseForPg`/`ForSqlite` — needed by `prepareObjectTableQuery` to convert `WhereFilterDefinition` to SQL)
- `query/sql/` ← imports from `@andyrmitchell/utils` (`concatSqlParametersForDialect`, `SqlDialect`)

---

## File Structure

```
src/utils/sql/
  types.ts                    — PreparedStatementArgument, isPreparedStatementArgument
  postgres/
    convertDotPropPathToPostgresJsonPath.ts
  sqlite/
    convertDotPropPathToSqliteJsonPath.ts
  index.ts                    — barrel

src/query/
  types.ts                  — SortAndSlice, SortDefinition, result types, TableInfo variants
  schemas.ts                — Zod schemas for SortAndSlice types; source of truth for runtime validation
  sortAndSliceObjects.ts    — JS runtime: sort + paginate an array of objects
  sortAndSliceObjects.test.ts
  index.ts                  — Public barrel: types + schemas + JS runtime
  sql/
    types.ts                — SQL-specific internal types
    prepareObjectTableQuery.ts   — JSON-column table query builder
    prepareColumnTableQuery.ts   — Relational table sort+slice builder
    flattenQueryClauses.ts                   — Helper: PreparedQueryClauses -> single SQL string
    internals/
      buildOrderByClause.ts       — ORDER BY clause generation (with NULLS LAST)
      buildAfterPkWhere.ts        — Cursor WHERE clause (NULL-safe subquery strategy)
      buildLimitOffset.ts         — LIMIT/OFFSET clause generation
      quoteIdentifier.ts          — SQL identifier quoting (prevents reserved word / special char issues)
    prepareObjectTableQuery.test.ts
    prepareColumnTableQuery.test.ts
    index.ts                — SQL barrel
```

---

## Types

All in `query/types.ts`. Names match `implementation_concept.md`.

### `SortDefinition<T>`

```ts
/**
 * Ordered list of sort keys with direction. Mongo-style: 1 = ascending, -1 = descending.
 * Keys are dot-prop paths into T (same as WhereFilterDefinition property paths).
 *
 * @example
 * const sort: SortDefinition<Email> = [
 *   { key: 'date', direction: -1 },
 *   { key: 'sender.name', direction: 1 }
 * ];
 * 
 * @note dot-prop keys can still be used with a regular relational DB table, they just have no depth 
 */
type SortDefinition<T> = Array<{ key: DotPropPaths<T>; direction: 1 | -1 }>;
```

### `SortAndSlice<T>`

```ts
/**
 * Optional sorting and slicing of a collection. 
 *
 * `offset` and `after_pk` are mutually exclusive (enforced at type level).
 *
 * @example
 * // First page, 20 items, newest first
 * const page1: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20 };
 *
 * @example
 * // Next page using cursor
 * const page2: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, after_pk: 'email_abc' };
 *
 * @example
 * // Offset-based pagination
 * const page3: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, offset: 40 };
 *
 * @note When using `after_pk` cursor pagination in SQL, the generated subquery count
 * grows O(N²) with the number of sort keys. Recommend ≤3 sort keys with `after_pk`.
 */
type SortAndSlice<T> = {
  sort?: SortDefinition<T>;
  limit?: number;
} & ({ offset?: number; after_pk?: never } | { offset?: never; after_pk?: PrimaryKeyValue });
```

### `PrimaryKeyValue`

Imported from `src/utils/getKeyValue.ts` (already exists). Not redefined.

```ts
import { PrimaryKeyValue } from '../utils/getKeyValue.ts';
```

### Result Types

```ts
/**
 * Full prepared SQL output — each clause is independent so the caller can compose freely.
 * No SQL keywords included (no 'WHERE', 'ORDER BY', etc.) — the caller or flattenQueryClausesToSql adds them.
 * Uses PreparedWhereClauseStatement from where-filter/sql for parameterised clause fragments.
 * Shared by both prepareObjectTableQuery and prepareColumnTableQuery.
 */
type PreparedQueryClauses = {
  where_statement: PreparedWhereClauseStatement | null;
  order_by_statement: string | null;
  limit_statement: PreparedWhereClauseStatement | null;
  offset_statement: PreparedWhereClauseStatement | null;
};

type QueryError = { type: string; message: string };

type PreparedQueryClausesResult =
  | ({ success: true } & PreparedQueryClauses)
  | { success: false; errors: QueryError[] };
```

### Table Info

```ts
type TableInfo = { tableName: string };

/**
 * JSON-column table: objects stored as JSON in a single column.
 * Schema provides path validation (prevents SQL injection) and type-aware casting for ORDER BY.
 */
type ObjectTableInfo<T extends Record<string, any>> = TableInfo & {
  objectColumnName: string;
  ddl: { primary_key: string };   // Subset of DDL — only what query needs
  schema: z.ZodSchema<T>;
};

/**
 * Traditional relational table: columns map directly to fields.
 * allowedColumns prevents SQL injection — sort keys are validated against this whitelist.
 */
type ColumnTableInfo = TableInfo & {
  pkColumnName: string;
  allowedColumns: string[];
};
```

### Flattening Helper

```ts
/**
 * Single SQL fragment + parameters, ready to append to `SELECT * FROM table`.
 */
type FlattenedQuerySql = {
  sql: string;
  parameters: PreparedStatementArgument[];
};
```

---

## Schemas

**File:** `query/schemas.ts` — Zod schemas for runtime validation. Types in `types.ts` are **manually authored** (to support JSDoc and the `offset`/`after_pk` discriminated union that `z.infer` cannot express). Bidirectional `expectTypeOf` tests verify the manual type stays aligned with the schema's inferred type.

`PrimaryKeyValueSchema` is imported from `src/utils/getKeyValue.ts` (already exists there).

```ts
import { PrimaryKeyValueSchema } from '../utils/getKeyValue.ts';

/**
 * Zod schema for a single sort entry: { key: string, direction: 1 | -1 }.
 * Runtime source of truth for SortEntry shape.
 */
const SortEntrySchema = z.object({
  key: z.string(),
  direction: z.union([z.literal(1), z.literal(-1)]),
});

/**
 * Zod schema for SortDefinition — array of sort entries.
 * Validates sort keys exist and directions are 1 | -1.
 *
 * @note The generic DotPropPaths<T> constraint is compile-time only.
 *       At runtime, keys are validated as strings; path validity against a
 *       specific schema is checked by the SQL builders (via convertDotPropPath*).
 */
const SortDefinitionSchema = z.array(SortEntrySchema);

/**
 * Zod schema for SortAndSlice — the core query config.
 * Enforces: limit >= 0, offset >= 0, offset/after_pk mutual exclusion,
 * after_pk requires non-empty sort.
 *
 * @example
 * const parsed = SortAndSliceSchema.parse({ sort: [{ key: 'date', direction: -1 }], limit: 20 });
 */
const SortAndSliceSchema = z.object({
  sort: SortDefinitionSchema.optional(),
  limit: z.number().int().nonneg().optional(),
  offset: z.number().int().nonneg().optional(),
  after_pk: PrimaryKeyValueSchema.optional(),
}).refine(
  data => !(data.offset !== undefined && data.after_pk !== undefined),
  { message: 'offset and after_pk are mutually exclusive' }
).refine(
  data => !(data.after_pk !== undefined && (!data.sort || data.sort.length === 0)),
  { message: 'after_pk requires a non-empty sort to define deterministic ordering' }
);
```

All runtime validation uses `SortAndSliceSchema.safeParse()`. All public functions (`sortAndSliceObjects`, `prepareObjectTableQuery`, `prepareColumnTableQuery`) return errors as values (`QueryError`) on validation failure — no throws.

---

## JS Runtime: `sortAndSliceObjects`

**File:** `query/sortAndSliceObjects.ts`

```ts
type SortAndSliceObjectsResult<T> =
  | { success: true; items: T[] }
  | { success: false; errors: QueryError[] };

/**
 * Sorts and paginates an in-memory array of objects.
 * JS runtime equivalent of the SQL query builders — same SortAndSlice type, applied to a plain array.
 *
 * @example
 * const result = sortAndSliceObjects(emails, { sort: [{ key: 'date', direction: -1 }], limit: 20 }, 'id');
 * if (result.success) { use(result.items); }
 */
function sortAndSliceObjects<T extends Record<string, any>>(
  items: T[],
  sortAndSlice: SortAndSlice<T>,
  primaryKey: keyof T & string
): SortAndSliceObjectsResult<T>
```

**Algorithm:**

1. **Validate** `sortAndSlice` via `SortAndSliceSchema.safeParse()` — return `{ success: false, errors }` on failure
2. **Resolve sort with tiebreaker:** If `sort` is provided, append `{ key: primaryKey, direction: 1 }` if PK not already last. This `resolvedSort` is used for sorting and cursor lookup — same pattern as the SQL builders.
3. **Copy** the input array (immutability)
4. **Sort** using `resolvedSort`:
   - Build a comparator from `resolvedSort` entries (includes PK tiebreaker)
   - For each entry, resolve value via dot-prop path (`getProperty` from `dot-prop-paths`)
   - Compare: numbers numerically, strings lexicographically, nulls/undefined last
   - Apply `direction` multiplier (1 or -1)
5. **Apply `after_pk` cursor** (if present):
   - Scan sorted array for item where `item[primaryKey] === after_pk`
   - If not found, return `[]` (stale cursor → safe empty)
   - Slice to items after that index
6. **Apply `offset`** (if present):
   - `array.slice(offset)`
7. **Apply `limit`** (if present):
   - `array.slice(0, limit)`
8. Return result

---

## SQL: `prepareObjectTableQuery`

**File:** `query/sql/prepareObjectTableQuery.ts`

```ts
/**
 * Prepares SQL clauses for a table storing JSON objects in a single column.
 * Composes WhereFilterDefinition (or pre-built WHERE) with SortAndSlice into a complete query.
 *
 * @example
 * const result = prepareObjectTableQuery('sqlite', table, { date: { $gt: '2024-01-01' } }, { sort: [{ key: 'date', direction: -1 }], limit: 20 });
 * if (result.success) { const flat = flattenQueryClausesToSql(result); }
 */
function prepareObjectTableQuery<T extends Record<string, any>>(
  dialect: SqlDialect,
  table: ObjectTableInfo<T>,
  filter?: WhereFilterDefinition<T> | PreparedWhereClauseStatement,
  sortAndSlice?: SortAndSlice<T>,
  additionalWhereClauses?: PreparedWhereClauseStatement[]
): PreparedQueryClausesResult
```

**Algorithm:**

1. **Validate** `sortAndSlice` via `SortAndSliceSchema.safeParse()` — returns `QueryError` on failure
2. **Resolve sort with tiebreaker:** If `sort` is provided, append `{ key: table.ddl.primary_key, direction: 1 }` to the sort array if PK is not already the last entry. This single `resolvedSort` array is passed to both ORDER BY and cursor WHERE builders, preventing desync.
3. **Build WHERE** from filter:
   - If `WhereFilterDefinition`: convert via `prepareWhereClauseForPg`/`prepareWhereClauseForSqlite` (using `table.schema` + `table.objectColumnName`)
   - If `PreparedWhereClauseStatement`: use as-is
   - If omitted: null
4. **Build ORDER BY** via `_buildOrderByClause(resolvedSort, ...)`:
   - Uses `convertDotPropPathTo*JsonPath(table.objectColumnName, key, table.schema)` for each sort key
5. **Build cursor WHERE** (if `after_pk` present) via `_buildAfterPkWhereClause(resolvedSort, ...)`:
   - Uses subquery strategy
   - PK expression: `convertDotPropPathTo*JsonPath(table.objectColumnName, table.ddl.primary_key, table.schema)`
6. **Compose WHERE clauses**: `concatSqlParametersForDialect([filterWhere, cursorWhere, ...additionalWhereClauses], dialect)` with AND
7. **Build LIMIT/OFFSET** via `_buildLimitClause` / `_buildOffsetClause`
8. **Convert** internal `{ sql, parameters }` shapes to `PreparedWhereClauseStatement` at the boundary (see Internal Shape Convention)
9. Return `PreparedQueryClausesResult`

---

## SQL: `prepareColumnTableQuery`

**File:** `query/sql/prepareColumnTableQuery.ts`

```ts
/**
 * Prepares SQL clauses for a traditional relational table.
 * Sort keys map to column names directly (no JSON path extraction).
 *
 * @example
 * const result = prepareColumnTableQuery('pg', { tableName: 'users', pkColumnName: 'id' }, { sort: [{ key: 'created_at', direction: -1 }], limit: 50 });
 */
function prepareColumnTableQuery<T extends Record<string, any>>(
  dialect: SqlDialect,
  table: ColumnTableInfo,
  sortAndSlice: SortAndSlice<T>,
  whereClauses?: PreparedWhereClauseStatement[]
): PreparedQueryClausesResult
```

**Algorithm:**

Same as `prepareObjectTableQuery` but simpler:
1. **Validate** `sortAndSlice` via `SortAndSliceSchema.safeParse()`
2. **Resolve sort with tiebreaker:** Append `{ key: table.pkColumnName, direction: 1 }` if PK not already last. Single `resolvedSort` array used for both ORDER BY and cursor WHERE.
3. **Validate sort keys** against `table.allowedColumns` (including the PK tiebreaker) — return `QueryError` if any key is not in the whitelist
4. **Build ORDER BY** via `_buildOrderByClause(resolvedSort, ...)`: sort keys used as column names directly (no `convertDotPropPath*`)
5. **Build cursor WHERE** (if `after_pk`) via `_buildAfterPkWhereClause(resolvedSort, ...)`: PK expression is just `table.pkColumnName`
6. **Compose WHERE**: `concatSqlParametersForDialect(whereClauses, dialect)` — no filter conversion (caller provides pre-built)
7. **Build LIMIT/OFFSET**
8. **Convert** internal shapes to `PreparedWhereClauseStatement` at the boundary
9. Return `PreparedQueryClausesResult`

---

## SQL: `flattenQueryClausesToSql`

**File:** `query/sql/flattenQueryClauses.ts`

```ts
/**
 * Flattens a PreparedQueryClauses into a single SQL fragment + parameter array.
 * Appends to "SELECT * FROM table" — adds WHERE, ORDER BY, LIMIT, OFFSET keywords.
 *
 * @example
 * const { sql, parameters } = flattenQueryClausesToSql(result, 'sqlite');
 * db.query(`SELECT * FROM emails ${sql}`, parameters);
 */
function flattenQueryClausesToSql(
  result: PreparedQueryClauses,
  dialect: SqlDialect
): FlattenedQuerySql
```

**Algorithm:**

1. Start with empty `sql` parts array and `parameters` array
2. If `where_statement`: prepend `WHERE`, append statement + args (using `appendSqlParametersForDialect` for renumbering)
3. If `order_by_statement`: append `ORDER BY <statement>` (no params — pure string)
4. If `limit_statement`: append `LIMIT`, append statement + args
5. If `offset_statement`: append `OFFSET`, append statement + args
6. Join parts with space, return `{ sql, parameters }`

**Note:** The public `PreparedQueryClauses` type uses `PreparedWhereClauseStatement` (`{ where_clause_statement, statement_arguments }`). The flatten helper converts these to `{ sql, parameters }` internally before calling `appendSqlParametersForDialect` for parameter renumbering.

---

## Internal Shape Convention

Internal SQL functions (`_buildAfterPkWhereClause`, `_buildLimitClause`, `_buildOffsetClause`) return `{ sql: string, parameters: PreparedStatementArgument[] }` — the same shape that `concatSqlParametersForDialect` expects. This avoids field-name conversion at every composition step.

The public result type `PreparedQueryClauses` uses `PreparedWhereClauseStatement` (`{ where_clause_statement, statement_arguments }`) for API consumers. A small `toWhereClauseStatement` converter is applied once at the public boundary (inside `prepareObjectTableQuery` / `prepareColumnTableQuery`) when assembling the final result.

---

## SQL Internals

### `_buildOrderByClause`

**File:** `query/sql/internals/buildOrderByClause.ts`

```ts
/**
 * Generates an ORDER BY expression string from a SortDefinition.
 * No 'ORDER BY' keyword — just the column list with directions.
 * Appends NULLS LAST to match JS runtime null-sorting behaviour.
 */
function _buildOrderByClause(
  sort: SortDefinition<any>,
  pathToSqlExpression: (dotPropPath: string) => string,
  dialect: SqlDialect
): string
```

**Algorithm:**

1. Map each sort entry to an ORDER BY fragment with NULLS LAST:
   - **Postgres:** `pathToSqlExpression(entry.key) ASC NULLS LAST` or `... DESC NULLS LAST`
   - **SQLite:** SQLite has no `NULLS LAST` syntax. Simulate via: `pathToSqlExpression(entry.key) IS NULL ASC, pathToSqlExpression(entry.key) ASC` (the `IS NULL` expression sorts NULLs after non-NULLs)
2. Join with `, `
3. Caller is responsible for passing the right `pathToSqlExpression`:
   - JSON tables: wraps `convertDotPropPathTo*JsonPath`
   - Relational tables: identity function (key = column name)

**Rationale:** JS runtime explicitly sorts nulls/undefined last. Without NULLS LAST in SQL, Postgres defaults to nulls-first for DESC and SQLite defaults to nulls-first for ASC — causing JS/SQL ordering divergence for the same dataset.

### `_buildAfterPkWhereClause`

**File:** `query/sql/internals/buildAfterPkWhere.ts`

```ts
/**
 * Generates a WHERE clause fragment that excludes rows up to and including the cursor row.
 * Uses subquery strategy: tuple comparison via correlated subquery.
 *
 * Defense-in-depth: returns QueryError if sort is empty (primary enforcement is in SortAndSliceSchema).
 */
function _buildAfterPkWhereClause(
  afterPk: PrimaryKeyValue,
  sort: SortDefinition<any>,
  pathToSqlExpression: (dotPropPath: string) => string,
  pkExpression: string,
  tableName: string,
  dialect: SqlDialect
): { success: true; statement: PreparedWhereClauseStatement } | { success: false; errors: QueryError[] }
```

**Subquery strategy** — tuple comparison via subquery. For sort `[date DESC, id ASC]` with cursor PK `abc`:

```sql
-- Single sort key (DESC → use <):
(date_expr) < (SELECT date_expr FROM table WHERE pk_expr = $1)
OR ((date_expr) IS NOT DISTINCT FROM (SELECT date_expr FROM table WHERE pk_expr = $1)
    AND pk_expr > (SELECT pk_expr FROM table WHERE pk_expr = $1))

-- Generalised multi-key: lexicographic tuple comparison
-- Operator selection: direction -1 (DESC) → <, direction 1 (ASC) → >
-- Equality: use NULL-safe comparison (Pg: IS NOT DISTINCT FROM, SQLite: IS)
-- (a, b, c) after cursor means:
-- a < cursor_a (if DESC) OR a > cursor_a (if ASC) OR
-- (a IS NOT DISTINCT FROM cursor_a AND b > cursor_b (if ASC)) OR
-- (a IS NOT DISTINCT FROM cursor_a AND b IS NOT DISTINCT FROM cursor_b AND c > cursor_c) ...
-- Final: all equal + PK tiebreaker (always >)
```

**NULL handling:** Standard SQL `=` returns UNKNOWN when either operand is NULL, breaking cursor pagination. Equality comparisons use `IS NOT DISTINCT FROM` (Pg) / `IS` (SQLite). For `<`/`>` comparisons, NULL-aware logic is required: rows with NULL sort values compared against a non-NULL cursor value (or vice versa) must be ordered consistently with the NULLS LAST convention used in ORDER BY.

**Algorithm:**
1. Guard: if `sort` is empty, return `{ success: false, errors: [...] }` (defense in depth)
2. Build subquery: `SELECT <sort_expr>, <pk_expr> FROM <table> WHERE <pk_expr> = $N`
3. For each sort entry, select comparison operator based on `direction`: `1` (ASC) → `>`, `-1` (DESC) → `<`
4. Build OR chain: for each prefix of sort keys, NULL-safe equality on prefix + direction-correct comparison on next key
5. Final OR branch: all sort keys NULL-safe equal + PK tiebreaker comparison (always `>`, PK is always ASC)
6. Return `{ success: true, statement: { sql, parameters } }` (internal `{ sql, parameters }` shape — see Internal Shape Convention)

**Note:** Alternative strategies (`row_number` CTE, `two_query` preliminary lookup) can be evaluated later if benchmarking shows the subquery approach has performance issues.

**Performance note:** The subquery count grows O(N²) relative to sort keys (a 2-key sort produces ~5 subqueries). Recommend keeping sort definitions to ≤3 keys when using `after_pk`. This is documented in the JSDoc for `SortAndSlice`.

### `quoteIdentifier`

**File:** `query/sql/internals/quoteIdentifier.ts`

```ts
/**
 * Wraps a SQL identifier in double quotes, escaping any embedded double quotes.
 * Prevents syntax errors from reserved words or special characters in table/column names.
 * Works for both Postgres and SQLite (both use " for identifier quoting).
 *
 * @example quoteIdentifier('user-data') → '"user-data"'
 * @example quoteIdentifier('order') → '"order"'
 * @example quoteIdentifier('col"name') → '"col""name"'
 */
function quoteIdentifier(identifier: string): string
```

Used by `_buildAfterPkWhereClause` (for `tableName` in subqueries) and by the callers when constructing `pkExpression` for ColumnTable. ObjectTable's `pkExpression` comes from `convertDotPropPathTo*JsonPath` which already handles quoting.

### `_buildLimitClause` / `_buildOffsetClause`

**File:** `query/sql/internals/buildLimitOffset.ts`

```ts
/** Generates a parameterised LIMIT fragment (internal { sql, parameters } shape). */
function _buildLimitClause(
  limit: number,
  dialect: SqlDialect
): { sql: string; parameters: PreparedStatementArgument[] }

/** Generates a parameterised OFFSET fragment (internal { sql, parameters } shape). */
function _buildOffsetClause(
  offset: number,
  dialect: SqlDialect
): { sql: string; parameters: PreparedStatementArgument[] }
```

**Algorithm:**
- Pg: `{ sql: '$1', parameters: [limit] }` (rebased by caller via `appendSqlParametersForDialect`)
- SQLite: `{ sql: '?', parameters: [limit] }` (no rebasing needed — `?` is positional)
- Same pattern for OFFSET

---

## Validation Rules (enforced via Zod schemas at runtime)

All input validation uses `SortAndSliceSchema.safeParse()`. Zod enforces:

- `offset` and `after_pk` mutually exclusive (`.refine()` + type-level union)
- `after_pk` requires non-empty `sort` (`.refine()` — deterministic ordering required for cursor pagination)
- `limit` must be non-negative integer (`.int().nonneg()`)
- `offset` must be non-negative integer (`.int().nonneg()`)
- `direction` must be `1 | -1` (`z.literal`)
- `after_pk` must be string or number (`PrimaryKeyValueSchema`)

Defense-in-depth runtime checks (in addition to Zod):
- `_buildAfterPkWhereClause` guards against empty `sort` (returns `QueryError`)
- Sort key paths validated against Zod schema via `convertDotPropPath*` (ObjectTable only) — invalid paths → `QueryError`
- Sort key names validated against `allowedColumns` (ColumnTable only) — unknown columns → `QueryError`


# Guidance on Testing (general)


**1. Structure & Coverage**
- Derive intent and stakeholder perspectives from docs, proposed types, and API interfaces.
- Nest `describe` blocks to represent these perspectives and boundary contracts (e.g., Consumer API vs Internal AST builder).
- Prioritize by risk (e.g., error cost, data leaks). Cover: happy path, expected errors, edges, forbidden states (e.g., leaking PII in logs, cross-tenant data access), and state/time invariants.

**2. Design & Paradigm (Black-Box / TDD)**
- Because the library is incomplete, test strictly against the **public contract (types/interfaces)**. Never assume or assess internal algorithms. 
- Use DAMP (Descriptive and Meaningful Phrases) naming to express intent. Never reference internal code details (e.g., class names, specific variable names).
- Favor property-based (e.g., 'reversing twice returns original string') and metamorphic (e.g., 'adding a WHERE clause strictly reduces or maintains result size') tests over hardcoded I/O examples.
- Test outcomes, not mechanics. A refactor that preserves behavior must never break a test.
- Assertions must validate the **correctness of values**, not just the presence of fields.

**3. Test Reliability & Data**
- Avoid mocks; use real modules with deterministic fake data. (If external systems are queried, assume an in-memory adapter or Testcontainers will be used).
- No async races; strictly use deterministic/fake timers.
- State mutation must be explicitly bounded (e.g., ensure tests don't pollute the in-memory state for subsequent queries).

# Constraints
* This is exclusively about testing the 'query' part of the library (`./query/**`).
* Query-specific invariants must be considered: Pagination consistency, Sorting stability, Filter commutativity (`A AND B` === `B AND A`), and Idempotency of read operations.

# Steps 

### [ ] Step 1: Update the INTENT.MD with the main consumers / stakeholders of this library and what they're using it for 

The goal is to understand expectations at the boundaries. Interview me about what you think, and let me challenge you. You can also ask questions to try to clarify who the stakeholders are. 

Be declarative, conscise, bullet points. 

Update INTENT.MD with new sections on this

### [ ] Step 2: For each function, identify tests: 

Go through every proposed function, assess its intent, I/O and steps/contract, and identify: 
- tests for the happy path
- tests for likely errors
- tests for edge cases
- tests for forbidden states
- state/time invariants (e.g. idempotency, eventual consistency)
- intent/property invariants

Output to `functions-tests.md`

### [ ] Step 3: Synthesise a skeleton hierarchial outline of tests

Use `functions-tests.md` and `INTENT.MD` to come up with a hierarchy of tests that captures the spirit of 'query' part of the library, especially the interests and expectations of stake holders at the boundary. 

The hierarchy is enforced by `describe` blocks (nested). 

Aim for a hierarchy that would make sense to a senior developer looking at the library, thinking about its intent and what is expected at the boundaries, and that every area is covered. It should prove/convey that every boundary and risk area is covered.

Important: this is high level describe blocks, not yet the tests that'll go within them. 

Output to 'proposed-test-structure.md'

### [ ] Step 4: Define the skeleton tests under each section of the hierarchy 

Using the hierarchy from Step 3 and the deep analysis from Step 2, output the actual skeleton test files (e.g., `xxx.test.ts`).
Deeply use everything you found in `functions-tests.md`

You're going to expand 'Output to 'proposed-test-structure.md'. 

Rules for the skeleton:
- Output nested `describe` blocks containing empty `it` blocks.
- Use DAMP naming for `it` blocks (e.g., `it('preserves sorting order when identical pagination limits are applied sequentially')`).
- Inside each empty `it` block, include a 1-2 line comment specifying the **Given/When/Then** or the **Properties/Arbitraries** required to make this test work (e.g., `// Needs: fast-check arbitrary generating nested AST filters up to depth 5`).
- Ensure no implementation details leak into the test names.

Important: you're still not writing the tests. This is the test names in empty `it` blocks. 

Update 'Output to 'proposed-test-structure.md'. 

### [x] Step 5: Let Gemini criticise 

Output a prompt for Gemini of the testing outline, with the context of what the library does and its functions (so it understands everything the tests are doing). 

Ask it for critical feedback of the tests. 



