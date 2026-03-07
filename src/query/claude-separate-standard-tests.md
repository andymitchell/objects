# Separate Standard Tests for Query

## Context

The query system (described in `./claude-query-plan.md`) has three executor functions that all produce the same logical result — an ordered, sliced subset of objects — but in different environments:

| Function | Environment | How it works |
|---|---|---|
| `sortAndSliceObjects` | JS runtime | Sorts/slices an in-memory array directly |
| `prepareObjectTableQuery` | SQL (Pg / SQLite) | Builds SQL clauses for a table with a JSON column holding each object |
| `prepareColumnTableQuery` | SQL (Pg / SQLite) | Builds SQL clauses for a relational table with typed columns |

The proposed tests in `./planning-testing/proposed-test-structure.md` were designed per-file, without considering:

1. **Duplication** — Many behavioral tests (sorting, pagination, limit, null handling) are identical across all three functions. They test the same logical contract but are written separately in each test file.
2. **Missing live-data validation for SQL builders** — The SQL functions return clause strings, not query results. Their current tests only inspect the generated SQL. But the real question is: *does executing those clauses against a real database produce the same ordered objects as the JS runtime?* This is testable — the test can spin up PgLite/SQLite in-memory, populate a table, execute the clauses, and compare results.

The **Standard Tests pattern** (see `../../standard-test-def.md`, proven in `../where-filter/standardTests.ts`) solves both problems: one shared test suite, many environment adapters.

## Reference

### Standard Tests Pattern

**One shared test suite, many environment adapters.**

1. **Define a uniform `execute` signature** — all environments implement it. Returns `T[] | undefined` (`undefined` = "not supported here").
2. **Write `standardTests(config)` — a function, not a test file.** Receives `test`, `expect`, and `execute`. Declares all behavioral tests against `execute`.
3. **One test file per environment.** Each implements `execute` (setup data → run operation → return result objects) then calls `standardTests()`.
4. **Return `undefined` for unsupported features.** The shared suite logs and skips — no false failures.

### Uniform execute signature

All three functions ultimately answer the same question: *given these objects and this SortAndSlice config, what ordered subset do you return?*

```ts
type Execute<T> = (
  items: T[],
  sortAndSlice: SortAndSlice,
  primaryKey: keyof T & string
) => Promise<T[] | undefined>;
```

- **Runtime adapter**: passes `items` directly to `sortAndSliceObjects`, returns the result array.
- **ObjectTable adapter** (one per dialect): creates an in-memory DB, creates a table with a JSON column, inserts each item as JSON, calls `prepareObjectTableQuery` to build clauses, executes the query, parses the JSON column back to objects, returns them.
- **ColumnTable adapter** (one per dialect): creates an in-memory DB, creates a table with typed columns matching `T`'s keys, inserts each item as a row, calls `prepareColumnTableQuery` to build clauses, executes the query, returns row objects.

All adapters return the same shape: an ordered array of `T` objects.

### What goes in standardTests vs per-file tests

**In `standardTests`** (behavioral / data-result tests — environment-agnostic):
- Sorting: single-key, multi-key, direction, null/undefined handling, PK tiebreaker, nested properties
- Limit: basic, exceeds length, zero
- Offset pagination: skip N, exceeds length, offset + limit
- Cursor pagination (`after_pk`): basic, with limit, last item, first item, stale/missing cursor
- Sequential pagination completeness (cursor and offset)
- Composition: sort before limit, sort before offset, empty SortAndSlice
- Immutability / idempotency invariants

**Per-file only** (implementation-specific, not in standardTests):
- SQL string inspection (ORDER BY shape, JSON path extraction, NULLS LAST syntax)
- Parameter renumbering / placeholder style ($N vs ?)
- Dialect parity (structural comparison of Pg vs SQLite output)
- Input validation (schema rejection, allowedColumns enforcement)
- `flattenQueryClauses` tests (SQL assembly)

### 5 adapter test files

Each file implements `execute`, then calls `standardTests()`. Per-file tests follow after.

| # | File | Adapter setup |
|---|---|---|
| 1 | `sortAndSliceObjects.test.ts` | Wraps `sortAndSliceObjects` directly |
| 2 | `prepareObjectTableQuery.sqlite.test.ts` | better-sqlite3 `:memory:`, JSON column |
| 3 | `prepareObjectTableQuery.pg.test.ts` | PgLite, JSONB column |
| 4 | `prepareColumnTableQuery.sqlite.test.ts` | better-sqlite3 `:memory:`, typed columns |
| 5 | `prepareColumnTableQuery.pg.test.ts` | PgLite, typed columns |

## Proposed Standard Test Skeleton

### File: `standardTests.ts`

```ts
type Execute<T extends Record<string, any>> = (
  items: T[],
  sortAndSlice: SortAndSlice,
  primaryKey: keyof T & string
) => Promise<T[] | undefined>;

type StandardTestConfig = {
  test: jest.It;
  expect: jest.Expect;
  execute: Execute<any>;
  implementationName?: string;
};

export function standardTests(config: StandardTestConfig) {
  const { test, expect, execute } = config;

  // --- Fixtures defined here: shared datasets with nulls, duplicates,
  //     nested props, mixed types. Zod schemas for each. ---

  describe('Sorting', () => {

    describe('Single Key', () => {
      it('sorts ascending by a numeric field', () => {
        // Given: items with numeric 'age' in random order
        // When: execute(items, { sort: [{ key: 'age', direction: 1 }] }, 'id')
        // Then: result ordered by age ascending
      });

      it('sorts descending by a string field', () => {
        // Given: items with string 'name'
        // When: sort direction: -1
        // Then: result ordered by name descending
      });
    });

    describe('Multi-Key', () => {
      it('uses secondary key to break ties on primary', () => {
        // Given: items where several share the same primary sort value
        // When: sort [category ASC, name ASC]
        // Then: within each category, sorted by name
      });

      it('respects independent direction per key', () => {
        // Given: items with category and date
        // When: sort [category ASC, date DESC]
        // Then: categories ascending, dates descending within each
      });
    });

    describe('Null / Undefined Values', () => {
      it('places null sort values after all non-null (ascending)', () => {
        // Given: items where some have null for the sort key
        // When: sort ascending
        // Then: non-null first (sorted), nulls last
      });

      it('places undefined sort values after all non-null (ascending)', () => {
        // Given: items where some lack the sort key entirely
        // When: sort ascending
        // Then: non-null first, undefined last
      });

      it('null-last applies regardless of sort direction', () => {
        // Given: items with nulls
        // When: sort descending
        // Then: non-null first (sorted desc), nulls last
      });
    });

    describe('PK Tiebreaker', () => {
      it('deterministic order when all sort values are identical', () => {
        // Given: items all with same sort value, different PKs
        // When: sort by that key
        // Then: ordered by PK ascending as tiebreaker
      });
    });

    describe('Nested Properties', () => {
      it('sorts by a dot-prop path into nested objects', () => {
        // Given: items with { sender: { name: string } }
        // When: sort by 'sender.name'
        // Then: sorted by the nested value
      });
    });
  });

  describe('Limit', () => {
    it('returns at most N items', () => {
      // Given: 10 items, limit: 3
      // When: execute
      // Then: 3 items
    });

    it('returns all when limit exceeds array length', () => {
      // Given: 3 items, limit: 100
      // When: execute
      // Then: 3 items
    });

    it('returns empty when limit is zero', () => {
      // Given: items, limit: 0
      // When: execute
      // Then: []
    });
  });

  describe('Offset Pagination', () => {
    it('skips the first N items', () => {
      // Given: 5 sorted items, offset: 2
      // When: execute
      // Then: last 3 items
    });

    it('returns empty when offset exceeds length', () => {
      // Given: 3 items, offset: 10
      // When: execute
      // Then: []
    });

    it('combines offset and limit correctly', () => {
      // Given: 10 sorted items, offset: 3, limit: 2
      // When: execute
      // Then: items at sorted positions 3 and 4
    });
  });

  describe('Cursor Pagination (after_pk)', () => {

    describe('Basic Cursor', () => {
      it('returns items after the cursor, excluding the cursor itself', () => {
        // Given: sorted [A, B, C, D, E], after_pk = B
        // When: execute
        // Then: [C, D, E]
      });

      it('returns items after cursor with limit', () => {
        // Given: sorted [A, B, C, D, E], after_pk = B, limit = 2
        // When: execute
        // Then: [C, D]
      });

      it('returns empty when cursor is last item', () => {
        // Given: sorted [A, B, C], after_pk = C
        // When: execute
        // Then: []
      });

      it('returns all except first when cursor is first item', () => {
        // Given: sorted [A, B, C], after_pk = A
        // When: execute
        // Then: [B, C]
      });
    });

    describe('Stale / Missing Cursor', () => {
      it('returns empty when after_pk matches no item', () => {
        // Given: items, after_pk = 'nonexistent'
        // When: execute
        // Then: []
      });
    });

    describe('Sequential Pagination Completeness', () => {
      it('paginating through entire dataset yields every item exactly once', () => {
        // Given: N items, page size M
        // When: repeatedly call with after_pk = last item of previous page
        // Then: union of all pages === full sorted dataset, no duplicates
      });

      it('completeness holds when items have duplicate sort values', () => {
        // Given: items with many duplicate sort values, page size < duplicate count
        // When: sequential cursor pagination
        // Then: all items appear exactly once
      });
    });
  });

  describe('Composition', () => {
    it('applies sort before limit', () => {
      // Given: unsorted items, sort ASC, limit 2
      // When: execute
      // Then: first 2 of sorted order, not first 2 of input order
    });

    it('applies sort before offset', () => {
      // Given: unsorted items, sort ASC, offset 2
      // When: execute
      // Then: items after position 2 in sorted order
    });

    it('returns all items unchanged when SortAndSlice is empty', () => {
      // Given: items, {}
      // When: execute
      // Then: all items present (order may vary)
    });
  });

  describe('Invariants', () => {
    it('calling twice with same input returns identical result', () => {
      // Given: items, sortAndSlice, pk
      // When: call twice
      // Then: results deep-equal
    });

    it('limit N result is a prefix of limit N+1 result', () => {
      // Property: result(limit=N) is a prefix of result(limit=N+1)
    });

    it('offset pages are complementary with limit', () => {
      // Property: result(offset=0, limit=N) ++ result(offset=N, limit=M)
      //           covers same items as result(limit=N+M)
    });
  });

  describe('Edge Cases', () => {
    it('handles empty input array', () => {
      // Given: [], any sortAndSlice
      // When: execute
      // Then: []
    });

    it('handles single-item array', () => {
      // Given: [item], sort
      // When: execute
      // Then: [item]
    });
  });
}
```

## Proposed Per-File Test Updates

After introducing `standardTests`, the per-file tests in `proposed-test-structure.md` should be trimmed to only implementation-specific concerns. Below is what **remains** per file (everything else moves to `standardTests`).

### `sortAndSliceObjects.test.ts`

```ts
describe('sortAndSliceObjects', () => {

  // --- Standard tests ---
  standardTests({ test, expect, execute, implementationName: 'runtime' });

  // --- Per-file only ---

  describe('Input Validation', () => {
    it('returns error for negative limit', () => { /* ... */ });
    it('returns error when after_pk used without sort', () => { /* ... */ });
    it('returns error when both offset and after_pk provided', () => { /* ... */ });
  });

  describe('Immutability', () => {
    it('does not mutate the input array', () => { /* ... */ });
    it('result items are referentially the same objects as input', () => { /* ... */ });
  });
});
```

### `prepareObjectTableQuery.sqlite.test.ts` / `prepareObjectTableQuery.pg.test.ts`

```ts
describe('prepareObjectTableQuery (sqlite|pg)', () => {

  // --- Standard tests ---
  standardTests({ test, expect, execute: matchInDb, implementationName: 'sqlite|pg-object' });

  // --- Per-file only (SQL output inspection) ---

  describe('Input Validation', () => {
    it('returns error for invalid SortAndSlice', () => {
      // Given: sortAndSlice with negative limit
      // When: prepareObjectTableQuery
      // Then: { success: false, errors }
    });

    it('returns error for sort key path not in schema', () => {
      // Given: sort key 'nonexistent.path', schema without that path
      // When: prepareObjectTableQuery
      // Then: { success: false, errors }
    });

    it('succeeds when no filter and no sortAndSlice provided', () => {
      // Given: only dialect and table
      // When: prepareObjectTableQuery
      // Then: { success: true, all clauses null }
    });
  });

  describe('ORDER BY Generation', () => {
    describe('JSON Path Extraction', () => {
      it('converts dot-prop sort key to JSON path expression', () => {
        // Given: sort key 'date', objectColumnName 'data'
        // When: prepareObjectTableQuery
        // Then: order_by_statement contains JSON path extraction (e.g. data->>'date')
      });
      it('handles nested dot-prop paths', () => {
        // Given: sort key 'address.city'
        // When: prepareObjectTableQuery
        // Then: order_by_statement contains nested JSON path
      });
    });
    describe('NULLS LAST', () => {
      it('Postgres ORDER BY includes NULLS LAST', () => {
        // Given: sort key, dialect 'pg'
        // Then: order_by_statement contains 'NULLS LAST'
      });
      it('SQLite ORDER BY simulates NULLS LAST with IS NULL trick', () => {
        // Given: sort key, dialect 'sqlite'
        // Then: order_by_statement contains 'IS NULL' expression
      });
    });
    describe('PK Tiebreaker', () => {
      it('appends PK as last sort key when not present', () => {
        // Given: sort: [{ key: 'date', direction: -1 }], PK = 'id'
        // Then: ORDER BY ends with PK expression ASC
      });
      it('does not duplicate PK when already last', () => {
        // Given: sort: [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }]
        // Then: ORDER BY has exactly 2 keys, not 3
      });
    });
  });

  describe('WHERE Composition', () => {
    describe('WhereFilterDefinition Input', () => {
      it('converts WhereFilterDefinition to parameterised WHERE clause', () => {
        // Given: filter { status: 'active' }
        // Then: where_statement contains parameterised clause matching the filter
      });
    });
    describe('PreparedWhereClauseStatement Input', () => {
      it('passes pre-built WHERE clause through unchanged', () => {
        // Given: pre-built { whereClauseStatement: '...', statementArguments: [...] }
        // Then: where_statement contains the pre-built clause
      });
    });
    describe('Additional WHERE Clauses', () => {
      it('merges additional WHERE clauses with AND', () => {
        // Given: filter + 2 additionalWhereClauses
        // Then: where_statement ANDs all three together
      });
    });
    describe('Cursor + Filter + Additional Combined', () => {
      it('composes filter WHERE, cursor WHERE, and additional clauses into single AND', () => {
        // Given: filter, after_pk, additionalWhereClauses
        // Then: where_statement contains all three joined with AND
      });
    });
  });

  describe('Cursor Pagination (after_pk)', () => {
    describe('Single Sort Key', () => {
      it('generates correct comparison for ASC sort', () => {
        // Given: sort ASC, after_pk
        // Then: cursor WHERE uses > comparison via subquery
      });
      it('generates correct comparison for DESC sort', () => {
        // Given: sort DESC, after_pk
        // Then: cursor WHERE uses < comparison via subquery
      });
    });
    describe('Multi-Key Lexicographic Comparison', () => {
      it('generates OR chain for multi-key sort', () => {
        // Given: sort [date DESC, name ASC], after_pk
        // Then: cursor WHERE contains OR chain with lexicographic tuple comparison
      });
    });
    describe('NULL-Safe Equality', () => {
      it('uses IS NOT DISTINCT FROM for Postgres', () => {
        // Given: dialect 'pg', multi-key sort with after_pk
        // Then: cursor WHERE uses IS NOT DISTINCT FROM for equality branches
      });
      it('uses IS for SQLite', () => {
        // Given: dialect 'sqlite', multi-key sort with after_pk
        // Then: cursor WHERE uses IS for equality branches
      });
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('generates parameterised LIMIT clause', () => {
      // Given: { limit: 20 }
      // Then: limit_statement has parameterised value
    });
    it('generates parameterised OFFSET clause', () => {
      // Given: { offset: 40 }
      // Then: offset_statement has parameterised value
    });
  });

  describe('Parameterisation Safety', () => {
    it('never embeds raw user values in SQL strings', () => {
      // Given: filter with user-provided string value, after_pk with string
      // When: prepareObjectTableQuery, flatten
      // Then: SQL string contains only placeholders, values are in parameters array
    });
    it('rejects sort key paths not present in the Zod schema', () => {
      // Given: sort key 'injection.attempt'
      // Then: error (path validation fails)
    });
  });

  describe('Dialect Parity (Postgres / SQLite)', () => {
    it('produces structurally equivalent clauses for both dialects', () => {
      // Given: same table, filter, sortAndSlice
      // When: prepareObjectTableQuery for 'pg' and 'sqlite'
      // Then: both succeed, both have same non-null clause slots populated
    });
    it('Postgres uses $N placeholders and SQLite uses ? placeholders', () => {
      // Given: same input
      // When: flatten both dialect results
      // Then: Pg sql contains $1, $2; SQLite sql contains ?
    });
  });

  describe('Invariants', () => {
    it('ORDER BY always ends with PK expression', () => {
      // Property: for any sort input, the last column in order_by_statement is the PK
    });
    it('same input produces identical output', () => {
      // Property: idempotency
    });
  });
});
```

### `prepareColumnTableQuery.sqlite.test.ts` / `prepareColumnTableQuery.pg.test.ts`

```ts
describe('prepareColumnTableQuery (sqlite|pg)', () => {

  // --- Standard tests ---
  standardTests({ test, expect, execute: matchInDb, implementationName: 'sqlite|pg-column' });

  // --- Per-file only ---

  describe('Input Validation', () => {
    describe('Sort Key Allowlist', () => {
      it('returns error when sort key is not in allowedColumns', () => {
        // Given: sort key 'secret_col', allowedColumns: ['name', 'date']
        // Then: { success: false, errors with column rejection message }
      });
      it('succeeds when all sort keys are in allowedColumns', () => {
        // Given: sort keys ['name', 'date'], allowedColumns includes both
        // Then: success
      });
      it('validates PK tiebreaker column is allowed', () => {
        // Given: pkColumnName not in allowedColumns (edge case)
        // When: prepareColumnTableQuery with sort that triggers tiebreaker
        // Then: error or auto-allowed (verify which)
      });
    });
    it('returns error for invalid SortAndSlice', () => {
      // Given: negative limit
      // Then: { success: false }
    });
  });

  describe('ORDER BY Generation', () => {
    describe('Column Names Direct', () => {
      it('uses column names directly without JSON path extraction', () => {
        // Given: sort key 'created_at'
        // Then: order_by_statement contains 'created_at' directly
      });
      it('handles multiple sort columns', () => {
        // Given: sort [status ASC, created_at DESC]
        // Then: ORDER BY has both columns with correct directions
      });
    });
    describe('NULLS LAST', () => {
      it('includes NULLS LAST for Postgres', () => {
        // Given: dialect 'pg'
        // Then: order_by_statement contains NULLS LAST
      });
      it('simulates NULLS LAST for SQLite', () => {
        // Given: dialect 'sqlite'
        // Then: order_by_statement contains IS NULL trick
      });
    });
    describe('PK Tiebreaker', () => {
      it('appends PK column as last ORDER BY when not already present', () => {
        // Given: sort by 'name' only, pkColumnName = 'id'
        // Then: ORDER BY ends with 'id' ASC
      });
      it('does not duplicate when PK is already last sort key', () => {
        // Given: sort: [{ key: 'name', direction: 1 }, { key: 'id', direction: 1 }]
        // Then: ORDER BY has 2 entries, not 3
      });
    });
    describe('Reserved Word / Special Char Quoting', () => {
      it('quotes column names that are SQL reserved words', () => {
        // Given: sort key 'order', allowedColumns includes 'order'
        // Then: ORDER BY contains quoted identifier
      });
      it('quotes column names with special characters', () => {
        // Given: sort key 'user-name'
        // Then: quoted in ORDER BY
      });
    });
  });

  describe('WHERE Composition', () => {
    it('composes pre-built WHERE clauses with AND', () => {
      // Given: two PreparedWhereClauseStatements
      // Then: where_statement ANDs them together
    });
    it('returns null WHERE when no clauses provided', () => {
      // Given: no whereClauses
      // Then: where_statement is null
    });
  });

  describe('Cursor Pagination (after_pk)', () => {
    it('generates cursor WHERE for single sort key', () => {
      // Given: sort ASC, after_pk
      // Then: cursor WHERE with subquery
    });
    it('generates lexicographic cursor WHERE for multi-key sort', () => {
      // Given: sort [status ASC, created_at DESC], after_pk
      // Then: OR chain for lexicographic comparison
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('generates parameterised LIMIT', () => {
      // Given: limit: 50
      // Then: limit_statement populated
    });
    it('generates parameterised OFFSET', () => {
      // Given: offset: 100
      // Then: offset_statement populated
    });
  });

  describe('Parameterisation Safety', () => {
    it('sort keys not in allowedColumns never reach generated SQL', () => {
      // Given: sort key not in allowedColumns
      // Then: fails before any SQL is generated
    });
  });

  describe('Dialect Parity (Postgres / SQLite)', () => {
    it('produces structurally equivalent output for both dialects', () => {
      // Given: same input
      // When: call for 'pg' and 'sqlite'
      // Then: same clause slots populated, dialect-appropriate placeholders
    });
  });

  describe('Invariants', () => {
    it('ORDER BY always ends with PK column', () => {
      // Property: for any valid sort, last ORDER BY entry is pkColumnName
    });
    it('same input produces identical output', () => {
      // Property: idempotency
    });
  });
});
```

### `schemas.test.ts` and `flattenQueryClauses.test.ts`

No changes — these are entirely implementation-specific (schema validation and SQL assembly). They don't test data results, so they stay as-is in `proposed-test-structure.md`.

### `query-integration.test.ts`

**Mostly replaced by standardTests.** The "JS / SQL Equivalence" and "End-to-End Pagination" sections are exactly what standardTests proves by running the same tests across all 5 adapters. Remove those sections. Keep only:

```ts
describe('Query Module Integration', () => {

  describe('WHERE + Sort Composition', () => {
    it('adding a WHERE filter preserves sort order of remaining items', () => { /* ... */ });
    it('cursor pagination through filtered results yields correct subset', () => { /* ... */ });
  });

  describe('Filter Commutativity', () => {
    it('swapping WHERE clause order produces identical results', () => { /* ... */ });
    it('commutativity holds with cursor pagination', () => { /* ... */ });
  });
});
```

## Deferred Implementation Phases

When ready to turn these skeletons into real code:

- [ ] **Phase 1**: Implement `standardTests.ts` — the shared suite with fixtures, `execute` type, and `expectOrAcknowledgeUnsupported` helper
- [ ] **Phase 2**: Implement the runtime adapter in `sortAndSliceObjects.test.ts` + its per-file tests. Run and fix. This validates the standard suite against the simplest environment.
- [ ] **Phase 3**: Implement the 4 SQL adapters (sqlite-object, pg-object, sqlite-column, pg-column) + their per-file tests. Run and fix.
- [ ] **Phase 4**: Implement remaining per-file tests (`schemas.test.ts`, `flattenQueryClauses.test.ts`, trimmed `query-integration.test.ts`). Run full suite.
