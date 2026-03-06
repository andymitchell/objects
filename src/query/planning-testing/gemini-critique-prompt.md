# Critique Request: Test Suite for Query Module

You are reviewing a proposed test suite for a not-yet-implemented TypeScript module. Your job is to find gaps, redundancies, misaligned tests, and missed risks. Be critical and specific.

---

## What the Module Does

The `query/` module in `@andyrmitchell/objects` provides **sorting, cursor pagination, offset pagination, and limits** across JS runtime and SQL backends (Postgres, SQLite) with a unified config type (`SortAndSlice`). It follows Mongo-style conventions (1 = ASC, -1 = DESC).

Consumers combine a `WhereFilterDefinition` (WHERE clause) with a `SortAndSlice` (ORDER BY + LIMIT + OFFSET + cursor) to produce a complete query.

### Two SQL Table Modes

- **ObjectTable**: A relational table with 1 JSON column storing objects matching a Zod schema. Sort keys are dot-prop paths resolved via JSON path extraction (`data->>'field'` in Pg, `json_extract(data, '$.field')` in SQLite).
- **ColumnTable**: A traditional relational table. Sort keys map directly to column names validated against an `allowedColumns` whitelist.

### Core Types

```ts
type SqlDialect = 'pg' | 'sqlite';
type SortDefinition<T> = Array<{ key: DotPropPaths<T>; direction: 1 | -1 }>;
type PrimaryKeyValue = string | number;

type SortAndSlice<T> = {
  sort?: SortDefinition<T>;   // Sort keys with direction
  limit?: number;              // Max items
  offset?: number;             // Skip N items (offset pagination)
  after_pk?: PrimaryKeyValue;  // Cursor pagination (return items after this PK)
};
// Constraint: offset and after_pk are mutually exclusive
// Constraint: after_pk requires non-empty sort

type PreparedQueryStatement = {
  where_statement: PreparedWhereClauseStatement | null;
  order_by_statement: string | null;
  limit_statement: PreparedWhereClauseStatement | null;
  offset_statement: PreparedWhereClauseStatement | null;
};

type QueryError = { type: string; message: string };
type PreparedQueryResult =
  | ({ success: true } & PreparedQueryStatement)
  | { success: false; errors: QueryError[] };
```

### Public Functions

1. **`SortAndSliceSchema`** (Zod schema) — Runtime validation of `SortAndSlice`. Source of truth for shape constraints. Enforces: direction is 1|-1, limit/offset are non-negative integers, offset/after_pk mutual exclusion, after_pk requires non-empty sort.

2. **`sortAndSliceObjects(items, sortAndSlice, primaryKey)`** — JS runtime sort + paginate an array. Contract: validates via schema, appends PK tiebreaker, copies input (immutable), sorts (numbers numerically, strings lexicographically, nulls/undefined last), applies after_pk cursor (stale cursor = empty []), applies offset, applies limit. Returns `{ success: true, items } | { success: false, errors }`.

3. **`prepareObjectTableQuery(dialect, table, filter?, sortAndSlice?, additionalWhereClauses?)`** — SQL builder for JSON-column tables. Validates sort keys against Zod schema, converts dot-prop paths to JSON path expressions, builds parameterised WHERE (from filter + cursor + additional clauses ANDed), ORDER BY (with NULLS LAST), LIMIT/OFFSET. Cursor uses subquery strategy with NULL-safe comparisons (`IS NOT DISTINCT FROM` for Pg, `IS` for SQLite).

4. **`prepareColumnTableQuery(dialect, table, sortAndSlice, whereClauses?)`** — SQL builder for relational tables. Sort keys validated against `allowedColumns` whitelist. Column names used directly (no JSON extraction). Otherwise same clause structure.

5. **`flattenQueryClausesToSql(result, dialect)`** — Flattens `PreparedQueryStatement` into single SQL string + parameter array. Prepends keywords (WHERE, ORDER BY, LIMIT, OFFSET), renumbers Pg `$N` parameters across clauses, concatenates SQLite `?` params.

### Internal Functions (tested via public API, but worth understanding)

- `_buildOrderByClause` — Generates ORDER BY with NULLS LAST (Pg native, SQLite simulated via `IS NULL` trick)
- `_buildAfterPkWhereClause` — Cursor WHERE via subquery, multi-key lexicographic OR chain, NULL-safe equality
- `_buildLimitClause` / `_buildOffsetClause` — Parameterised LIMIT/OFFSET fragments
- `quoteIdentifier` — SQL identifier quoting for reserved words / special chars

### Key Invariants

- **Pagination consistency**: Sequential cursor or offset pagination through stable data yields every item exactly once.
- **Sorting stability**: PK tiebreaker ensures deterministic order when sort keys have duplicates.
- **JS/SQL equivalence**: `sortAndSliceObjects` and SQL builders produce identical ordering for same data and config.
- **Filter commutativity**: WHERE clause composition order doesn't affect results.
- **Null consistency**: Nulls sort last in both JS and SQL.
- **Parameterisation safety**: No raw user values in SQL strings; sort keys validated before reaching SQL.

---

## Stakeholders

1. **Store (`breef/store`)** — Primary consumer. Uses `SortAndSlice` for paginated views across in-memory and SQL backends. Expects JS/SQL ordering equivalence, stable cursor pagination, clean composition with `WhereFilterDefinition`, errors as values.

2. **Direct SQL consumers** — Use `prepareObjectTableQuery`/`prepareColumnTableQuery` + `flattenQueryClausesToSql`. Expect parameterised SQL, correct parameter numbering, sort key validation, dialect parity.

3. **In-memory JS consumers** — Use `sortAndSliceObjects`. Expect same `SortAndSlice` type as SQL, nulls last, immutability, stale cursor returns empty, deterministic multi-key sort.

4. **`where-filter/` module** — Composable peer. `query/` depends on it (for WHERE building), not vice versa. Shared SQL utilities in `utils/sql/`.

---

## The Proposed Test Suite

6 test files, ~103 test cases total.

### File 1: `schemas.test.ts` (14 tests)

```ts
describe('SortAndSliceSchema', () => {

  describe('Valid Inputs', () => {
    it('accepts an empty object with all fields omitted', () => {
      // Given: {}
      // When: safeParse
      // Then: success with all fields undefined
    });

    it('accepts sort-only configuration', () => {
      // Given: { sort: [{ key: 'date', direction: -1 }] }
      // When: safeParse
      // Then: success
    });

    it('accepts sort with limit', () => {
      // Given: { sort: [...], limit: 20 }
      // When: safeParse
      // Then: success
    });

    it('accepts sort with limit and offset', () => {
      // Given: { sort: [...], limit: 20, offset: 40 }
      // When: safeParse
      // Then: success
    });

    it('accepts sort with limit and string after_pk', () => {
      // Given: { sort: [...], limit: 20, after_pk: 'abc' }
      // When: safeParse
      // Then: success
    });

    it('accepts sort with limit and numeric after_pk', () => {
      // Given: { sort: [...], limit: 20, after_pk: 42 }
      // When: safeParse
      // Then: success
    });

    it('accepts an empty sort array', () => {
      // Given: { sort: [] }
      // When: safeParse
      // Then: success (no sort keys is valid, just means no ordering)
    });

    it('accepts limit of zero', () => {
      // Given: { limit: 0 }
      // When: safeParse
      // Then: success
    });

    it('accepts offset of zero', () => {
      // Given: { offset: 0 }
      // When: safeParse
      // Then: success
    });
  });

  describe('Rejected Inputs', () => {
    it('rejects direction values other than 1 or -1', () => {
      // Given: { sort: [{ key: 'x', direction: 0 }] }
      // When: safeParse
      // Then: failure
    });

    it('rejects negative limit', () => {
      // Given: { limit: -1 }
      // When: safeParse
      // Then: failure
    });

    it('rejects non-integer limit', () => {
      // Given: { limit: 1.5 }
      // When: safeParse
      // Then: failure
    });

    it('rejects negative offset', () => {
      // Given: { offset: -1 }
      // When: safeParse
      // Then: failure
    });

    it('rejects boolean after_pk', () => {
      // Given: { sort: [...], after_pk: true }
      // When: safeParse
      // Then: failure
    });

    it('rejects null after_pk', () => {
      // Given: { sort: [...], after_pk: null }
      // When: safeParse
      // Then: failure
    });
  });

  describe('Mutual Exclusion (offset / after_pk)', () => {
    it('rejects when both offset and after_pk are present', () => {
      // Given: { sort: [...], offset: 10, after_pk: 'abc' }
      // When: safeParse
      // Then: failure with 'mutually exclusive' message
    });

    it('rejects after_pk with empty sort array', () => {
      // Given: { sort: [], after_pk: 'abc' }
      // When: safeParse
      // Then: failure with 'requires non-empty sort' message
    });

    it('rejects after_pk with no sort field', () => {
      // Given: { after_pk: 'abc' }
      // When: safeParse
      // Then: failure
    });
  });

  describe('Type Alignment', () => {
    it('inferred schema type is assignable to manual SortAndSlice type', () => {
      // Compile-time: expectTypeOf<z.infer<typeof SortAndSliceSchema>>().toMatchTypeOf<SortAndSlice<any>>()
    });

    it('manual SortAndSlice type is assignable to inferred schema type', () => {
      // Compile-time: expectTypeOf<SortAndSlice<any>>().toMatchTypeOf<z.infer<typeof SortAndSliceSchema>>()
    });
  });

  describe('Invariants', () => {
    it('parsing a valid output again produces the same result', () => {
      // Given: a valid SortAndSlice object
      // When: parse it, then parse the result again
      // Then: both outputs are deep-equal
    });
  });
});
```

### File 2: `sortAndSliceObjects.test.ts` (30 tests)

```ts
describe('sortAndSliceObjects', () => {

  describe('Input Validation', () => {
    it('returns error for negative limit', () => {});
    it('returns error when after_pk is used without sort', () => {});
    it('returns error when both offset and after_pk are provided', () => {});
  });

  describe('Sorting', () => {
    describe('Single Key', () => {
      it('sorts items in ascending order by a numeric field', () => {});
      it('sorts items in descending order by a string field', () => {});
    });

    describe('Multi-Key', () => {
      it('uses secondary sort key to break ties on primary key', () => {});
      it('respects independent direction per sort key', () => {});
    });

    describe('Null / Undefined Values', () => {
      it('places items with null sort values after all non-null items', () => {});
      it('places items with undefined sort values after all non-null items', () => {});
      it('null-last behaviour applies regardless of sort direction', () => {});
    });

    describe('PK Tiebreaker', () => {
      it('produces deterministic order when all sort values are identical', () => {});
      it('does not add duplicate tiebreaker when PK is already last sort key', () => {});
    });

    describe('Nested Properties', () => {
      it('sorts by a dot-prop path into nested objects', () => {});
    });
  });

  describe('Cursor Pagination (after_pk)', () => {
    describe('Basic Cursor', () => {
      it('returns items after the cursor item, excluding the cursor itself', () => {});
      it('returns items after cursor with limit applied', () => {});
      it('returns empty when cursor points to last item', () => {});
      it('returns all items except first when cursor points to first item', () => {});
    });

    describe('Sequential Pagination Completeness', () => {
      it('paginating through entire dataset yields every item exactly once', () => {});
      it('completeness holds when items have duplicate sort values', () => {});
    });

    describe('Stale / Missing Cursor', () => {
      it('returns empty array when after_pk matches no item', () => {});
    });
  });

  describe('Offset Pagination', () => {
    it('skips the first N items', () => {});
    it('returns empty when offset exceeds array length', () => {});
    it('combines offset and limit correctly', () => {});
  });

  describe('Limit', () => {
    it('returns at most N items', () => {});
    it('returns all items when limit exceeds array length', () => {});
    it('returns empty array when limit is zero', () => {});
  });

  describe('Composition (sort + limit + offset / cursor)', () => {
    it('applies sort before limit', () => {});
    it('applies sort before offset', () => {});
    it('returns all items unchanged when SortAndSlice is empty', () => {});
  });

  describe('Immutability', () => {
    it('does not mutate the input array', () => {});
    it('result items are referentially the same objects as input items', () => {});
  });

  describe('Invariants', () => {
    it('calling twice with same input returns identical result', () => {});
    it('limit N result is a prefix of limit N+1 result', () => {});
    it('offset pages are complementary with limit', () => {});
  });

  describe('Edge Cases', () => {
    it('handles empty input array', () => {});
    it('handles single-item array', () => {});
  });
});
```

### File 3: `prepareObjectTableQuery.test.ts` (22 tests)

```ts
describe('prepareObjectTableQuery', () => {

  describe('Input Validation', () => {
    it('returns error for invalid SortAndSlice', () => {});
    it('returns error for sort key path not in schema', () => {});
    it('succeeds when no filter and no sortAndSlice provided', () => {});
  });

  describe('ORDER BY Generation', () => {
    describe('JSON Path Extraction', () => {
      it('converts dot-prop sort key to JSON path expression', () => {});
      it('handles nested dot-prop paths', () => {});
    });

    describe('NULLS LAST', () => {
      it('Postgres ORDER BY includes NULLS LAST', () => {});
      it('SQLite ORDER BY simulates NULLS LAST with IS NULL trick', () => {});
    });

    describe('PK Tiebreaker', () => {
      it('appends PK as last sort key when not already present', () => {});
      it('does not duplicate PK when it is already the last sort key', () => {});
    });
  });

  describe('WHERE Composition', () => {
    describe('WhereFilterDefinition Input', () => {
      it('converts WhereFilterDefinition to parameterised WHERE clause', () => {});
    });

    describe('PreparedWhereClauseStatement Input', () => {
      it('passes pre-built WHERE clause through unchanged', () => {});
    });

    describe('Additional WHERE Clauses', () => {
      it('merges additional WHERE clauses with AND', () => {});
    });

    describe('Cursor + Filter + Additional Combined', () => {
      it('composes filter WHERE, cursor WHERE, and additional clauses into single AND', () => {});
    });
  });

  describe('Cursor Pagination (after_pk)', () => {
    describe('Single Sort Key', () => {
      it('generates correct comparison for ASC sort', () => {});
      it('generates correct comparison for DESC sort', () => {});
    });

    describe('Multi-Key Lexicographic Comparison', () => {
      it('generates OR chain for multi-key sort', () => {});
    });

    describe('NULL-Safe Equality', () => {
      it('uses IS NOT DISTINCT FROM for Postgres', () => {});
      it('uses IS for SQLite', () => {});
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('generates parameterised LIMIT clause', () => {});
    it('generates parameterised OFFSET clause', () => {});
  });

  describe('Parameterisation Safety', () => {
    it('never embeds raw user values in SQL strings', () => {});
    it('rejects sort key paths not present in the Zod schema', () => {});
  });

  describe('Dialect Parity (Postgres / SQLite)', () => {
    it('produces structurally equivalent clauses for both dialects', () => {});
    it('Postgres uses $N placeholders and SQLite uses ? placeholders', () => {});
  });

  describe('Invariants', () => {
    it('ORDER BY always ends with PK expression', () => {});
    it('same input produces identical output', () => {});
  });
});
```

### File 4: `prepareColumnTableQuery.test.ts` (18 tests)

```ts
describe('prepareColumnTableQuery', () => {

  describe('Input Validation', () => {
    describe('Sort Key Allowlist', () => {
      it('returns error when sort key is not in allowedColumns', () => {});
      it('succeeds when all sort keys are in allowedColumns', () => {});
      it('validates PK tiebreaker column is allowed', () => {});
    });
    it('returns error for invalid SortAndSlice', () => {});
  });

  describe('ORDER BY Generation', () => {
    describe('Column Names Direct', () => {
      it('uses column names directly without JSON path extraction', () => {});
      it('handles multiple sort columns', () => {});
    });

    describe('NULLS LAST', () => {
      it('includes NULLS LAST for Postgres', () => {});
      it('simulates NULLS LAST for SQLite', () => {});
    });

    describe('PK Tiebreaker', () => {
      it('appends PK column as last ORDER BY when not already present', () => {});
      it('does not duplicate when PK is already last sort key', () => {});
    });

    describe('Reserved Word / Special Char Quoting', () => {
      it('quotes column names that are SQL reserved words', () => {});
      it('quotes column names with special characters', () => {});
    });
  });

  describe('WHERE Composition', () => {
    it('composes pre-built WHERE clauses with AND', () => {});
    it('returns null WHERE when no clauses provided', () => {});
  });

  describe('Cursor Pagination (after_pk)', () => {
    it('generates cursor WHERE for single sort key', () => {});
    it('generates lexicographic cursor WHERE for multi-key sort', () => {});
  });

  describe('LIMIT / OFFSET', () => {
    it('generates parameterised LIMIT', () => {});
    it('generates parameterised OFFSET', () => {});
  });

  describe('Parameterisation Safety', () => {
    it('sort keys not in allowedColumns never reach generated SQL', () => {});
  });

  describe('Dialect Parity (Postgres / SQLite)', () => {
    it('produces structurally equivalent output for both dialects', () => {});
  });

  describe('Invariants', () => {
    it('ORDER BY always ends with PK column', () => {});
    it('same input produces identical output', () => {});
  });
});
```

### File 5: `flattenQueryClauses.test.ts` (11 tests)

```ts
describe('flattenQueryClausesToSql', () => {

  describe('Clause Assembly', () => {
    describe('Keyword Ordering (WHERE -> ORDER BY -> LIMIT -> OFFSET)', () => {
      it('assembles all clauses in correct SQL keyword order', () => {});
    });

    describe('Selective Clauses (only non-null included)', () => {
      it('includes only WHERE when other clauses are null', () => {});
      it('includes only ORDER BY when other clauses are null', () => {});
      it('includes only LIMIT when other clauses are null', () => {});
      it('includes ORDER BY and LIMIT without WHERE', () => {});
    });
  });

  describe('Parameter Renumbering', () => {
    describe('Postgres $N Rebasing', () => {
      it('renumbers parameters sequentially across clauses', () => {});
      it('handles WHERE with multiple params followed by LIMIT and OFFSET', () => {});
    });

    describe('SQLite ? Pass-Through', () => {
      it('preserves ? placeholders without renumbering', () => {});
    });
  });

  describe('Empty Input', () => {
    it('returns empty sql and empty parameters when all clauses are null', () => {});
  });

  describe('Invariants', () => {
    it('parameter count matches total across all non-null clauses', () => {});
    it('same input produces identical output', () => {});
  });
});
```

### File 6: `query-integration.test.ts` (8 tests)

```ts
describe('Query Module Integration', () => {

  describe('JS / SQL Equivalence', () => {
    it('sortAndSliceObjects and prepareObjectTableQuery produce the same item order for the same data', () => {});
    it('equivalence holds with null values in sort keys', () => {});
    it('equivalence holds with multi-key sort and cursor pagination', () => {});
  });

  describe('End-to-End Pagination', () => {
    describe('Cursor Pagination Covers All Rows', () => {
      it('sequential cursor pages via prepareObjectTableQuery cover every row exactly once', () => {});
      it('cursor pagination is stable when sort values have duplicates', () => {});
    });

    describe('Offset Pagination Covers All Rows', () => {
      it('sequential offset pages cover every row exactly once', () => {});
    });
  });

  describe('WHERE + Sort Composition', () => {
    describe('Filter Does Not Corrupt Pagination', () => {
      it('adding a WHERE filter preserves sort order of remaining items', () => {});
      it('cursor pagination through filtered results yields correct subset', () => {});
    });

    describe('Filter Commutativity', () => {
      it('swapping order of additional WHERE clauses produces identical results', () => {});
    });
  });
});
```

---

## Your Task

Critically review this test suite. Specifically:

1. **Coverage gaps**: Are there behaviors, edge cases, or failure modes described in the module spec that have no corresponding test? Pay special attention to:
   - Boundary conditions (off-by-one in pagination, empty collections, max values)
   - Error composition (multiple simultaneous validation failures)
   - Cross-cutting concerns (what happens when features interact in unexpected ways)

2. **Redundancy**: Are any tests duplicating the same assertion under different names? Would consolidation improve clarity without losing coverage?

3. **Test-implementation coupling**: Do any tests appear to test implementation details rather than observable behavior? Would a refactor that preserves behavior break them?

4. **Missing negative tests**: Are there invalid states or misuse patterns that aren't tested?

5. **Invariant coverage**: Are the stated invariants (pagination completeness, JS/SQL equivalence, null consistency, etc.) adequately tested? Are there invariants that should be tested but aren't mentioned?

6. **Integration test gaps**: The integration tests require running SQL against a real SQLite database. Are there cross-function interactions that the integration tests miss?

7. **Risk prioritisation**: Given that cursor pagination correctness (no gaps, no duplicates) is the highest-risk area, is the coverage proportional to the risk?

8. **Metamorphic / property-based opportunities**: Are there tests that would be stronger as property-based tests rather than hardcoded examples?

Be specific. Reference test names and suggest concrete additions or removals.
