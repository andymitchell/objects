# Function-Level Test Analysis

For each proposed function: intent, I/O, contract, and test categories.

---

## 1. `SortAndSliceSchema` (Zod validation)

**Intent:** Runtime validation of `SortAndSlice` input. Source of truth for shape constraints.

**I/O:** `unknown` → `SortAndSlice<any>` or Zod error.

**Contract:**
- `sort` optional array of `{ key: string, direction: 1 | -1 }`
- `limit` optional non-negative integer
- `offset` optional non-negative integer
- `after_pk` optional string or number
- `offset` and `after_pk` mutually exclusive
- `after_pk` requires non-empty `sort`

### Happy path
- Valid sort-only config parses
- Valid sort + limit parses
- Valid sort + limit + offset parses
- Valid sort + limit + after_pk parses
- Empty object `{}` parses (all optional)
- Numeric after_pk parses
- String after_pk parses

### Likely errors
- `direction: 0` rejected
- `direction: 2` rejected
- `limit: -1` rejected
- `limit: 1.5` (non-integer) rejected
- `offset: -1` rejected
- `offset: 2.5` (non-integer) rejected
- Unrecognized properties stripped or rejected (schema strictness)
- Multiple simultaneous validation errors returned together
- `after_pk` with empty sort `[]` rejected
- `after_pk` with no sort rejected
- Both `offset` and `after_pk` present rejected
- `after_pk: true` (boolean) rejected
- `after_pk: null` rejected

### Edge cases
- `sort: []` (empty array) parses — no sort keys is valid
- `limit: 0` parses — zero is non-negative
- `offset: 0` parses

### Forbidden states
- Type alignment: `z.infer<typeof SortAndSliceSchema>` matches manual `SortAndSlice` type (bidirectional `expectTypeOf`)

### Invariants
- Parsing is idempotent: `parse(parse(x))` === `parse(x)` for valid inputs

---

## 2. `sortAndSliceObjects`

**Intent:** Sort + paginate an in-memory array. JS runtime equivalent of SQL builders — same `SortAndSlice`, applied to a plain array.

**I/O:** `(items: T[], sortAndSlice: SortAndSlice<T>, primaryKey: keyof T & string)` → `{ success: true, items: T[] } | { success: false, errors: QueryError[] }`

**Contract:**
1. Validate via `SortAndSliceSchema`
2. Append PK tiebreaker to sort if not already last
3. Copy input (immutability)
4. Sort: numbers numerically, strings lexicographically, nulls/undefined last
5. Apply `after_pk` cursor: find item, slice after it; stale cursor → empty `[]`
6. Apply `offset`: slice
7. Apply `limit`: slice
8. Return result

### Happy path
- Single-key ascending sort returns items in correct order
- Single-key descending sort returns items in correct order
- Multi-key sort: primary key breaks ties on secondary key
- Limit returns only N items
- Offset skips first N items
- Sort + limit + offset together
- `after_pk` cursor returns items after the cursor item (exclusive)
- `after_pk` with limit returns correct page
- Sequential cursor pagination covers all items exactly once
- No sort, no limit, no offset → returns items in original order
- Empty `SortAndSlice` `{}` → returns all items unchanged

### Likely errors
- Invalid `SortAndSlice` (e.g. negative limit) → `{ success: false, errors }`
- `after_pk` without sort → error
- Both `offset` and `after_pk` → error

### Edge cases
- Empty input array → `{ success: true, items: [] }`
- All items have same sort value → PK tiebreaker provides deterministic order
- Null/undefined sort values sort after all non-null values
- Mixed types in sort key (numbers and strings) — deterministic handling
- `after_pk` pointing to last item → empty result
- `after_pk` pointing to first item → all items except first
- Stale `after_pk` (no matching item) → empty `[]`
- `limit: 0` → empty result
- `offset` >= array length → empty result
- Dot-prop path sort key (e.g. `'sender.name'`) resolves nested values
- Single item array

### Forbidden states
- Input array is never mutated (verify original array unchanged after call)
- Items in result are referentially the same objects (no deep clone of items themselves)

### Invariants
- **Pagination completeness:** Sequential `after_pk` pagination over stable data yields every item exactly once
- **Pagination completeness (property-based):** fast-check with random data (nulls, duplicates) + random page sizes
- **Idempotency:** Calling twice with same input returns same result
- **Sort stability:** Items with equal sort values maintain consistent relative order (PK tiebreaker)
- **Limit metamorphic:** `result(limit=N).items` is a prefix of `result(limit=N+1).items`
- **Offset metamorphic:** `result(offset=0, limit=N)` + `result(offset=N, limit=M)` covers same items as `result(limit=N+M)`

---

## 3. `prepareObjectTableQuery`

**Intent:** Prepare parameterised SQL clauses for a JSON-column table. Composes WHERE filter + SortAndSlice into independent clause fragments.

**I/O:** `(dialect, table: ObjectTableInfo<T>, filter?, sortAndSlice?, additionalWhereClauses?)` → `PreparedQueryClausesResult`

**Contract:**
1. Validate `sortAndSlice` via schema
2. Append PK tiebreaker to sort
3. Build WHERE from filter (WhereFilterDefinition or PreparedWhereClauseStatement)
4. Build ORDER BY via JSON path extraction
5. Build cursor WHERE if `after_pk`
6. Compose all WHERE clauses with AND
7. Build LIMIT/OFFSET
8. Return `PreparedQueryClauses` or errors

### Happy path
- Sort-only → `order_by_statement` populated, others null
- Limit-only → `limit_statement` populated
- Sort + limit + filter → all relevant clauses populated
- WhereFilterDefinition filter produces correct parameterised WHERE
- Pre-built PreparedWhereClauseStatement filter passed through
- `after_pk` produces cursor WHERE clause
- `additionalWhereClauses` merged into composite WHERE
- Postgres dialect produces `$N` placeholders
- SQLite dialect produces `?` placeholders
- No filter, no sortAndSlice → all clauses null (success)

### Likely errors
- Invalid sort key path (not in schema) → `QueryError`
- Invalid `SortAndSlice` → `QueryError`

### Edge cases
- Sort key is the PK itself → no duplicate tiebreaker appended
- Multiple additional WHERE clauses all composed with AND
- Filter + cursor WHERE + additional WHERE all combined correctly
- Sort on nested JSON path (e.g. `'address.city'`)
- Null values in sort columns → NULLS LAST in ORDER BY

### Forbidden states
- No raw values in SQL strings — all user values are parameters
- Sort key paths validated against schema (prevents SQL injection via crafted paths)

### Invariants
- **Dialect equivalence:** Pg and SQLite produce semantically equivalent queries for same input
- **Parameter correctness:** Flattened SQL has no parameter numbering gaps or collisions
- **Idempotency:** Same input → same output
- **PK tiebreaker:** ORDER BY always ends with PK column (deterministic ordering)

---

## 4. `prepareColumnTableQuery`

**Intent:** Prepare parameterised SQL clauses for a traditional relational table. Sort keys map to column names directly.

**I/O:** `(dialect, table: ColumnTableInfo, sortAndSlice, whereClauses?)` → `PreparedQueryClausesResult`

**Contract:**
1. Validate `sortAndSlice`
2. Append PK tiebreaker
3. Validate sort keys against `allowedColumns`
4. Build ORDER BY (column names directly)
5. Build cursor WHERE if `after_pk`
6. Compose WHERE clauses
7. Build LIMIT/OFFSET
8. Return result

### Happy path
- Sort by allowed column → correct ORDER BY
- Multiple sort keys → multi-column ORDER BY
- Limit + offset → correct clauses
- `after_pk` cursor → cursor WHERE clause
- Pre-built WHERE clauses composed correctly
- Both dialects produce correct output

### Likely errors
- Sort key not in `allowedColumns` → `QueryError`
- PK tiebreaker column not in `allowedColumns` → `QueryError` (or auto-included?)
- Invalid `SortAndSlice` → `QueryError`

### Edge cases
- Sort key matches `pkColumnName` → no duplicate tiebreaker
- Empty `allowedColumns` (only PK valid)
- Column name is a SQL reserved word (e.g. `order`, `group`) → must be quoted
- Column name with special characters

### Forbidden states
- Sort keys not in `allowedColumns` never reach SQL (injection prevention)

### Invariants
- Same as `prepareObjectTableQuery`: dialect equivalence, parameter correctness, idempotency, PK tiebreaker

---

## 5. `flattenQueryClausesToSql`

**Intent:** Flatten independent `PreparedQueryClauses` into a single SQL string + parameter array. Convenience for the common `SELECT * FROM table <flattened>` pattern.

**I/O:** `(result: PreparedQueryClauses, dialect)` → `{ sql: string, parameters: PreparedStatementArgument[] }`

**Contract:**
1. Prepend `WHERE` keyword to where_statement
2. Prepend `ORDER BY` keyword to order_by_statement
3. Prepend `LIMIT` to limit_statement
4. Prepend `OFFSET` to offset_statement
5. Renumber parameters for Pg dialect
6. Join with spaces

### Happy path
- All clauses present → full SQL fragment with correct keywords
- Only WHERE → `WHERE <clause>`
- Only ORDER BY → `ORDER BY <clause>`
- Only LIMIT → `LIMIT <value>`
- WHERE + ORDER BY + LIMIT + OFFSET → correct ordering of keywords

### Likely errors
- N/A — input is already validated by upstream builders

### Edge cases
- All clauses null → empty sql string and empty parameters
- Pg parameter renumbering: WHERE has `$1`, LIMIT renumbered to `$2`, OFFSET to `$3`
- SQLite: all `?` — no renumbering needed

### Forbidden states
- Clause order is always WHERE → ORDER BY → LIMIT → OFFSET (SQL standard)

### Invariants
- **Idempotency:** Same input → same output
- **Parameter count:** `parameters.length` equals total parameter count across all non-null clauses

---

## 6. `_buildOrderByClause` (internal)

**Intent:** Generate ORDER BY expression with NULLS LAST behaviour, dialect-aware.

**I/O:** `(sort, pathToSqlExpression, dialect)` → `string`

### Happy path
- Single ASC key → `expr ASC NULLS LAST` (Pg) / `expr IS NULL ASC, expr ASC` (SQLite)
- Single DESC key → `expr DESC NULLS LAST` (Pg) / `expr IS NULL ASC, expr DESC` (SQLite)
- Multi-key sort → comma-separated fragments

### Edge cases
- Empty sort array → empty string (or no-op)

### Invariants
- NULLS LAST is always present for both dialects
- Pg and SQLite produce semantically equivalent ordering

---

## 7. `_buildAfterPkWhereClause` (internal)

**Intent:** Generate cursor WHERE clause using subquery strategy. NULL-safe comparisons.

**I/O:** `(afterPk, sort, pathToSqlExpression, pkExpression, tableName, dialect)` → success with statement or error

### Happy path
- Single ASC sort key → correct `>` comparison with subquery
- Single DESC sort key → correct `<` comparison with subquery
- Multi-key sort → lexicographic OR chain
- PK tiebreaker in final OR branch (always `>`)

### Likely errors
- Empty sort → `{ success: false, errors }`

### Edge cases
- NULL-safe equality uses `IS NOT DISTINCT FROM` (Pg) / `IS` (SQLite)
- Table name with special characters → quoted
- Numeric `afterPk` value
- String `afterPk` value

### Invariants
- Cursor WHERE is consistent with ORDER BY: rows "after" the cursor per ORDER BY are exactly those matched by the WHERE

---

## 8. `_buildLimitClause` / `_buildOffsetClause` (internal)

**Intent:** Generate parameterised LIMIT/OFFSET fragments.

**I/O:** `(limit/offset, dialect)` → `{ sql, parameters }`

### Happy path
- Pg: `{ sql: '$1', parameters: [20] }`
- SQLite: `{ sql: '?', parameters: [20] }`

### Edge cases
- `limit: 0` → valid (returns zero rows)
- Large numbers

---

## 9. `quoteIdentifier` (internal)

**Intent:** SQL identifier quoting. Prevents reserved word / special char issues.

**I/O:** `string` → `string`

### Happy path
- `'users'` → `'"users"'`
- `'order'` (reserved word) → `'"order"'`

### Edge cases
- Embedded double quote: `'col"name'` → `'"col""name"'`
- Empty string
- Already-quoted identifier (should still wrap — no detection)

---

## Cross-Function / Integration Tests

### JS/SQL Equivalence
- For a given dataset and `SortAndSlice`, `sortAndSliceObjects` result matches the ordering that `prepareObjectTableQuery` SQL would produce (verified by running the SQL against a real/in-memory DB or by comparing ORDER BY semantics)
- Equivalence holds for case-sensitive string sorting (mixed case)
- **Property-based:** fast-check random data + random SortAndSlice → JS and SQL produce identical PK orderings

### End-to-End Pagination
- Sequential cursor pagination via `prepareObjectTableQuery` + `flattenQueryClausesToSql` covers all rows exactly once
- Sequential offset pagination covers all rows exactly once
- **Property-based:** fast-check random rows + random page sizes → cursor pagination completeness in SQL
- Stale cursor in SQL returns empty result set (subquery yields NULL, WHERE evaluates falsy)

### WHERE + Sort Composition
- Adding a WHERE filter to a sorted query does not corrupt pagination (items excluded by filter are simply absent, remaining items maintain order)
- Filter commutativity: `WHERE A AND B` same result as `WHERE B AND A`
- Filter commutativity holds when combined with cursor pagination
