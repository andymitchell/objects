# Query Module — Intent

## Purpose

Provides **ordering, cursor pagination, offset pagination, and limits** as a composable layer alongside `WhereFilterDefinition`. Works across JS runtime and SQL backends (Postgres, SQLite) with a unified type (`SortAndSlice`), following Mongo-style conventions.

Consumers combine `WhereFilterDefinition` (WHERE) with `SortAndSlice` (ORDER BY + LIMIT + OFFSET + cursor) to produce a complete query.

---

## Stakeholders & Expectations

### 1. Store (`breef/store`) — Primary Consumer

- **What they use:** `SortAndSlice` for paginated views with cursor-based boundaries, across both in-memory and SQL backends.
- **Expectations at boundary:**
  - JS runtime (`sortAndSliceObjects`) and SQL builders produce **identical ordering** for the same dataset — no JS/SQL divergence.
  - Cursor pagination (`after_pk`) is stable: paginating through the full dataset yields every item exactly once, with no gaps or duplicates.
  - `SortAndSlice` composes cleanly with `WhereFilterDefinition` — adding a WHERE clause never corrupts sort/pagination semantics.
  - Errors returned as values, never thrown — Store can relay errors to its own consumers.

### 2. Direct SQL Consumers

- **What they use:** `prepareObjectTableQuery` (JSON-column tables) and `prepareColumnTableQuery` (relational tables), composed with `flattenQueryClausesToSql`.
- **Expectations at boundary:**
  - Output is parameterised SQL — no raw user values in the SQL string (injection-safe).
  - Clauses are independent (`PreparedQueryClauses`) — consumers can compose or discard individual clauses.
  - Parameter numbering is correct after flattening — no collisions or gaps.
  - Invalid sort keys are rejected (ObjectTable: validated against Zod schema; ColumnTable: validated against `allowedColumns` whitelist).
  - Both Postgres and SQLite dialects produce semantically equivalent queries.

### 3. In-Memory / JS Runtime Consumers

- **What they use:** `sortAndSliceObjects` to sort + paginate a plain array of objects.
- **Expectations at boundary:**
  - Same `SortAndSlice` type used for SQL — no separate in-memory config.
  - Null/undefined values sort last (matching SQL `NULLS LAST` behaviour).
  - Input array is never mutated.
  - Stale cursor (`after_pk` pointing to a deleted item) returns empty results, not an error.
  - Multi-key sort is stable (PK tiebreaker ensures deterministic order).

### 4. `where-filter/` Module (Composable Peer)

- **Relationship:** `query/` depends on `where-filter/` (for WHERE clause building), not vice versa. Both share `utils/sql/` for dot-prop-path-to-SQL conversion.
- **Expectations at boundary:**
  - `query/` never reaches into `where-filter/` internals — only uses public exports (`prepareWhereClauseForPg`, `prepareWhereClauseForSqlite`).
  - Shared SQL utilities (`convertDotPropPath*`, `PreparedStatementArgument`) live in `utils/sql/`, not duplicated.

---

## Key Invariants

- **Pagination consistency:** Sequentially paginating (via `after_pk` or `offset`) through a stable dataset yields every item exactly once.
- **Sorting stability:** PK tiebreaker ensures deterministic order when sort keys have duplicate values.
- **JS/SQL equivalence:** `sortAndSliceObjects` and SQL builders produce the same ordering for the same data and `SortAndSlice`.
- **Filter commutativity:** `WHERE A AND B` === `WHERE B AND A` — clause composition order doesn't affect results.
- **Read idempotency:** Repeated queries with the same input produce the same output (no side effects).
- **Null consistency:** Nulls sort last in both JS and SQL (Postgres `NULLS LAST`, SQLite simulated `IS NULL` trick).
