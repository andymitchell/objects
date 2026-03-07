# Proposed Test Structure

Hierarchy of `describe` blocks with skeleton `it` blocks (empty, with Given/When/Then comments).

**Standard Tests pattern**: behavioral/data-result tests shared across all environments live in `standardTests.ts`. Each environment test file implements an `execute` adapter and calls `standardTests()`. Per-file tests cover implementation-specific concerns (SQL string output, input validation, dialect differences). See `../claude-separate-standard-tests.md` for full rationale.

---

## File: `standardTests.ts`

Shared behavioral tests run by all 5 adapter test files. Not a test file itself — a function that declares tests when called.

```ts
type Execute<T extends Record<string, any>> = (
  items: T[],
  sortAndSlice: SortAndSlice<T>,
  primaryKey: keyof T & string
) => Promise<T[] | undefined>;

// Vitest provides `it` and `expect` globally; no wrapper types needed.
// If explicit typing is required, import { TestAPI, ExpectStatic } from 'vitest'.
type StandardTestConfig = {
  it: TestAPI;        // from vitest
  expect: ExpectStatic; // from vitest
  execute: Execute<any>;
  implementationName?: string;
};

export function standardTests(config: StandardTestConfig) {
  const { it, expect, execute } = config;

  // --- Fixtures defined here: shared datasets with nulls, duplicates,
  //     nested props, mixed types. Zod schemas for each. ---
  //
  // --- Default sort: all non-sort-specific tests (limit, offset, cursor,
  //     invariants, edge cases) use a default sort by PK ascending to
  //     guarantee deterministic results across all adapters.
  //     Sort-specific tests override with their own keys. ---
  //
  // --- Skip mechanism: `execute` may return `undefined` for a given test
  //     to signal "not supported by this adapter" (e.g. column-table
  //     adapters cannot sort by nested dot-prop paths). The test should
  //     check for `undefined` and skip (e.g. `if (!result) return;`). ---

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
        // SKIP: column-table adapters return undefined (dot-prop paths
        //       are out of scope for relational column mapping).
      });
    });
  });

  // NOTE: All limit/offset/cursor tests below use default sort (PK ASC)
  // for deterministic results across all adapters (SQL has no guaranteed
  // row order without ORDER BY).

  describe('Limit', () => {
    it('returns at most N items', () => {
      // Given: 10 items, sort by PK ASC (default), limit: 3
      // When: execute
      // Then: 3 items, first 3 in PK order
    });

    it('returns all when limit exceeds array length', () => {
      // Given: 3 items, sort by PK ASC (default), limit: 100
      // When: execute
      // Then: 3 items
    });

    it('returns empty when limit is zero', () => {
      // Given: items, sort by PK ASC (default), limit: 0
      // When: execute
      // Then: []
    });
  });

  describe('Offset Pagination', () => {
    it('skips the first N items', () => {
      // Given: 5 items, sort by PK ASC (default), offset: 2
      // When: execute
      // Then: last 3 items in PK order
    });

    it('returns empty when offset exceeds length', () => {
      // Given: 3 items, sort by PK ASC (default), offset: 10
      // When: execute
      // Then: []
    });

    it('combines offset and limit correctly', () => {
      // Given: 10 items, sort by PK ASC (default), offset: 3, limit: 2
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

    it('returns at most N items when only limit is set (no sort)', () => {
      // Given: 10 items, limit: 3, no sort keys
      // When: execute(items, { limit: 3 }, 'id')
      // Then: 3 items returned (order may vary)
    });
  });

  describe('Invariants', () => {
    it('calling twice with same input returns identical result', () => {
      // Given: items, sortAndSlice (with default PK ASC sort), pk
      // When: call twice
      // Then: results deep-equal
    });

    it('limit N result is a prefix of limit N+1 result', () => {
      // Given: sort by PK ASC (default) — deterministic order required
      // Property: result(limit=N) is a prefix of result(limit=N+1)
    });

    it('offset pages are complementary with limit', () => {
      // Given: sort by PK ASC (default) — deterministic order required
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

---

## File: `schemas.test.ts`

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

    it('rejects non-integer offset', () => {
      // Given: { offset: 2.5 }
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

    it('rejects or strips unrecognized properties', () => {
      // Given: { limit: 10, foo: 'bar' }
      // When: safeParse
      // Then: success, but output does not contain 'foo' (strict or strip mode)
    });

    it('returns multiple errors when several fields are invalid simultaneously', () => {
      // Given: { limit: -1, offset: -1 }
      // When: safeParse
      // Then: failure with errors for both limit and offset
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
    // NOTE: z.infer<typeof SortAndSliceSchema> is WIDER than SortAndSlice<any>
    // because the schema allows both offset AND after_pk simultaneously,
    // while the manual type uses a discriminated union to prevent this.
    // Direct assignability (z.infer → SortAndSlice) would fail.
    // Instead, verify flat shape equivalence for the base fields.

    it('inferred schema base fields match manual SortAndSlice base fields', () => {
      // Compile-time: verify that the flat/shared fields (sort, limit)
      // of z.infer<typeof SortAndSliceSchema> match those of SortAndSlice<any>.
      // Do NOT assert full assignability — the discriminated union
      // (offset vs after_pk) gap is acknowledged and tested separately.
    });

    it('manual SortAndSlice type is assignable to inferred schema type', () => {
      // Compile-time: expectTypeOf<SortAndSlice<any>>().toMatchTypeOf<z.infer<typeof SortAndSliceSchema>>()
      // This direction works because the manual type is narrower.
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

---

## File: `sortAndSliceObjects.test.ts`

Behavioral tests delegated to `standardTests`. Per-file tests cover input validation and JS-specific immutability guarantees.

```ts
describe('sortAndSliceObjects', () => {

  // --- Standard tests (behavioral / data-result) ---
  standardTests({ it, expect, execute, implementationName: 'runtime' });

  // --- Per-file only ---

  describe('Input Validation', () => {
    it('returns error for negative limit', () => {
      // Given: items, { limit: -1 }, pk
      // When: sortAndSliceObjects
      // Then: { success: false, errors: [...] }
    });

    it('returns error when after_pk is used without sort', () => {
      // Given: items, { after_pk: 'x' }, pk
      // When: sortAndSliceObjects
      // Then: { success: false }
    });

    it('returns error when both offset and after_pk are provided', () => {
      // Given: items, { sort: [...], offset: 5, after_pk: 'x' }, pk
      // When: sortAndSliceObjects
      // Then: { success: false }
    });

    it('returns error for non-integer limit', () => {
      // Given: items, { limit: 1.5 }, pk
      // When: sortAndSliceObjects
      // Then: { success: false, errors: [...] }
    });

    it('returns error for invalid direction', () => {
      // Given: items, { sort: [{ key: 'name', direction: 2 }] }, pk
      // When: sortAndSliceObjects
      // Then: { success: false, errors: [...] }
    });
  });

  describe('Immutability', () => {
    it('does not mutate the input array', () => {
      // Given: items array, snapshot of original
      // When: sortAndSliceObjects with sort
      // Then: original array is deep-equal to snapshot
    });

    it('result items are referentially the same objects as input items', () => {
      // Given: items array
      // When: sortAndSliceObjects
      // Then: each result item === corresponding input item (same reference)
    });
  });
});
```

---

## File: `prepareObjectTableQuery.sqlite.test.ts` / `prepareObjectTableQuery.pg.test.ts`

Behavioral tests delegated to `standardTests` (adapter creates in-memory DB, inserts objects as JSON, executes built clauses, returns parsed objects). Per-file tests inspect the generated SQL strings and clause structure.

```ts
describe('prepareObjectTableQuery (sqlite|pg)', () => {

  // --- Standard tests (behavioral / data-result) ---
  standardTests({ it, expect, execute: matchInDb, implementationName: 'sqlite|pg-object' });

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
      // IMPL NOTE: prepareObjectTableQuery must validate sort key paths
      // upfront against the Zod schema (via convertSchemaToDotPropPathTree)
      // BEFORE passing to pathToSqlExpression. Returns QueryError, never throws.
      // Defense-in-depth: pathToSqlExpression calls are also wrapped in
      // try/catch to convert any unexpected throw to QueryError.
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
        // When: prepareObjectTableQuery for Pg
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
        // When: prepareObjectTableQuery
        // Then: order_by_statement contains 'NULLS LAST'
      });

      it('SQLite ORDER BY simulates NULLS LAST with IS NULL trick', () => {
        // Given: sort key, dialect 'sqlite'
        // When: prepareObjectTableQuery
        // Then: order_by_statement contains 'IS NULL' expression
      });
    });

    describe('PK Tiebreaker', () => {
      it('appends PK as last sort key when not already present', () => {
        // Given: sort: [{ key: 'date', direction: -1 }], PK = 'id'
        // When: prepareObjectTableQuery
        // Then: ORDER BY ends with PK expression ASC
      });

      it('does not duplicate PK when it is already the last sort key', () => {
        // Given: sort: [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }]
        // When: prepareObjectTableQuery
        // Then: ORDER BY has exactly 2 keys, not 3
      });
    });
  });

  describe('WHERE Composition', () => {

    describe('WhereFilterDefinition Input', () => {
      it('converts WhereFilterDefinition to parameterised WHERE clause', () => {
        // Given: filter { status: 'active' }
        // When: prepareObjectTableQuery
        // Then: where_statement contains parameterised clause matching the filter
      });
    });

    describe('PreparedWhereClauseStatement Input', () => {
      it('passes pre-built WHERE clause through unchanged', () => {
        // Given: pre-built { whereClauseStatement: '...', statementArguments: [...] }
        // When: prepareObjectTableQuery
        // Then: where_statement contains the pre-built clause
      });
    });

    describe('Additional WHERE Clauses', () => {
      it('merges additional WHERE clauses with AND', () => {
        // Given: filter + 2 additionalWhereClauses
        // When: prepareObjectTableQuery
        // Then: where_statement ANDs all three together
      });
    });

    describe('Cursor + Filter + Additional Combined', () => {
      it('composes filter WHERE, cursor WHERE, and additional clauses into single AND', () => {
        // Given: filter, after_pk, additionalWhereClauses
        // When: prepareObjectTableQuery
        // Then: where_statement contains all three joined with AND
      });
    });
  });

  describe('Cursor Pagination (after_pk)', () => {

    describe('Single Sort Key', () => {
      it('generates correct comparison for ASC sort', () => {
        // Given: sort ASC, after_pk
        // When: prepareObjectTableQuery
        // Then: cursor WHERE uses > comparison via subquery
      });

      it('generates correct comparison for DESC sort', () => {
        // Given: sort DESC, after_pk
        // When: prepareObjectTableQuery
        // Then: cursor WHERE uses < comparison via subquery
      });
    });

    describe('Multi-Key Lexicographic Comparison', () => {
      it('generates OR chain for multi-key sort', () => {
        // Given: sort [date DESC, name ASC], after_pk
        // When: prepareObjectTableQuery
        // Then: cursor WHERE contains OR chain with lexicographic tuple comparison
      });
    });

    describe('NULL-Safe Equality', () => {
      it('uses IS NOT DISTINCT FROM for Postgres', () => {
        // Given: dialect 'pg', multi-key sort with after_pk
        // When: prepareObjectTableQuery
        // Then: cursor WHERE uses IS NOT DISTINCT FROM for equality branches
      });

      it('uses IS for SQLite', () => {
        // Given: dialect 'sqlite', multi-key sort with after_pk
        // When: prepareObjectTableQuery
        // Then: cursor WHERE uses IS for equality branches
      });
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('generates parameterised LIMIT clause', () => {
      // Given: { limit: 20 }
      // When: prepareObjectTableQuery
      // Then: limit_statement has parameterised value
    });

    it('generates parameterised OFFSET clause', () => {
      // Given: { offset: 40 }
      // When: prepareObjectTableQuery
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
      // When: prepareObjectTableQuery
      // Then: { success: false } — upfront path validation rejects before
      //       any SQL is generated. Defense-in-depth try/catch around
      //       pathToSqlExpression ensures errors-as-values even if
      //       validation is bypassed.
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

---

## File: `prepareColumnTableQuery.sqlite.test.ts` / `prepareColumnTableQuery.pg.test.ts`

Behavioral tests delegated to `standardTests` (adapter creates in-memory DB with typed columns, inserts items as rows, executes built clauses, returns row objects). Per-file tests inspect generated SQL strings and column-specific concerns.

```ts
describe('prepareColumnTableQuery (sqlite|pg)', () => {

  // --- Standard tests (behavioral / data-result) ---
  // NOTE: prepareColumnTableQuery requires sortAndSlice (not optional,
  // unlike prepareObjectTableQuery). The Execute adapter always passes
  // the value — `{}` is valid (all fields optional in SortAndSlice schema).
  standardTests({ it, expect, execute: matchInDb, implementationName: 'sqlite|pg-column' });

  // --- Per-file only ---

  describe('Input Validation', () => {

    describe('Sort Key Allowlist', () => {
      it('returns error when sort key is not in allowedColumns', () => {
        // Given: sort key 'secret_col', allowedColumns: ['name', 'date']
        // When: prepareColumnTableQuery
        // Then: { success: false, errors with column rejection message }
      });

      it('succeeds when all sort keys are in allowedColumns', () => {
        // Given: sort keys ['name', 'date'], allowedColumns includes both
        // When: prepareColumnTableQuery
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
      // When: prepareColumnTableQuery
      // Then: { success: false }
    });

    it('returns error for negative limit', () => {
      // Given: { limit: -1 }
      // When: prepareColumnTableQuery
      // Then: { success: false }
    });
  });

  describe('ORDER BY Generation', () => {

    describe('Column Names Direct', () => {
      it('uses column names directly without JSON path extraction', () => {
        // Given: sort key 'created_at'
        // When: prepareColumnTableQuery
        // Then: order_by_statement contains 'created_at' directly
      });

      it('handles multiple sort columns', () => {
        // Given: sort [status ASC, created_at DESC]
        // When: prepareColumnTableQuery
        // Then: ORDER BY has both columns with correct directions
      });
    });

    describe('NULLS LAST', () => {
      it('includes NULLS LAST for Postgres', () => {
        // Given: dialect 'pg'
        // When: prepareColumnTableQuery
        // Then: order_by_statement contains NULLS LAST
      });

      it('simulates NULLS LAST for SQLite', () => {
        // Given: dialect 'sqlite'
        // When: prepareColumnTableQuery
        // Then: order_by_statement contains IS NULL trick
      });
    });

    describe('PK Tiebreaker', () => {
      it('appends PK column as last ORDER BY when not already present', () => {
        // Given: sort by 'name' only, pkColumnName = 'id'
        // When: prepareColumnTableQuery
        // Then: ORDER BY ends with 'id' ASC
      });

      it('does not duplicate when PK is already last sort key', () => {
        // Given: sort: [{ key: 'name', direction: 1 }, { key: 'id', direction: 1 }]
        // When: prepareColumnTableQuery
        // Then: ORDER BY has 2 entries, not 3
      });
    });

    describe('Reserved Word / Special Char Quoting', () => {
      it('quotes column names that are SQL reserved words', () => {
        // Given: sort key 'order', allowedColumns includes 'order'
        // When: prepareColumnTableQuery
        // Then: ORDER BY contains quoted identifier
      });

      it('quotes column names with special characters', () => {
        // Given: sort key 'user-name'
        // When: prepareColumnTableQuery
        // Then: quoted in ORDER BY
      });
    });
  });

  describe('WHERE Composition', () => {
    it('composes pre-built WHERE clauses with AND', () => {
      // Given: two PreparedWhereClauseStatements
      // When: prepareColumnTableQuery
      // Then: where_statement ANDs them together
    });

    it('returns null WHERE when no clauses provided', () => {
      // Given: no whereClauses
      // When: prepareColumnTableQuery
      // Then: where_statement is null
    });
  });

  describe('Cursor Pagination (after_pk)', () => {
    it('generates cursor WHERE for single sort key', () => {
      // Given: sort ASC, after_pk
      // When: prepareColumnTableQuery
      // Then: cursor WHERE with subquery
    });

    it('generates lexicographic cursor WHERE for multi-key sort', () => {
      // Given: sort [status ASC, created_at DESC], after_pk
      // When: prepareColumnTableQuery
      // Then: OR chain for lexicographic comparison
    });
  });

  describe('LIMIT / OFFSET', () => {
    it('generates parameterised LIMIT', () => {
      // Given: limit: 50
      // When: prepareColumnTableQuery
      // Then: limit_statement populated
    });

    it('generates parameterised OFFSET', () => {
      // Given: offset: 100
      // When: prepareColumnTableQuery
      // Then: offset_statement populated
    });
  });

  describe('Parameterisation Safety', () => {
    it('sort keys not in allowedColumns never reach generated SQL', () => {
      // Given: sort key not in allowedColumns
      // When: prepareColumnTableQuery
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

---

## File: `sql/internals/quoteIdentifier.test.ts`

```ts
describe('quoteIdentifier', () => {
  it('wraps a simple identifier in double quotes', () => {
    // Given: 'name'
    // When: quoteIdentifier('name')
    // Then: '"name"'
  });

  it('handles reserved words', () => {
    // Given: 'order'
    // When: quoteIdentifier('order')
    // Then: '"order"'
  });

  it('handles special characters', () => {
    // Given: 'user-name'
    // When: quoteIdentifier('user-name')
    // Then: '"user-name"'
  });

  it('escapes embedded double quotes by doubling them', () => {
    // Given: 'col"name'
    // When: quoteIdentifier('col"name')
    // Then: '"col""name"'
  });

  it('handles empty string', () => {
    // Given: ''
    // When: quoteIdentifier('')
    // Then: '""'
  });
});
```

---

## File: `sql/internals/buildOrderByClause.test.ts`

```ts
describe('buildOrderByClause', () => {

  describe('Postgres', () => {
    it('generates ASC/DESC with NULLS LAST', () => {
      // Given: dialect 'pg', sort key ASC
      // When: buildOrderByClause
      // Then: contains 'ASC NULLS LAST'
    });

    it('joins multiple keys with commas', () => {
      // Given: dialect 'pg', two sort keys
      // When: buildOrderByClause
      // Then: comma-separated ORDER BY entries
    });

    it('uses pathToSqlExpression for JSON column access', () => {
      // Given: dialect 'pg', objectColumnName 'data', sort key 'sender.name'
      // When: buildOrderByClause
      // Then: ORDER BY uses JSON path extraction expression
    });
  });

  describe('SQLite', () => {
    it('simulates NULLS LAST via IS NULL', () => {
      // Given: dialect 'sqlite', sort key ASC
      // When: buildOrderByClause
      // Then: contains IS NULL simulation for NULLS LAST
    });

    it('joins multiple keys with IS NULL pairs', () => {
      // Given: dialect 'sqlite', two sort keys
      // When: buildOrderByClause
      // Then: each key has an IS NULL companion entry
    });

    it('uses pathToSqlExpression for JSON column access', () => {
      // Given: dialect 'sqlite', objectColumnName 'data', sort key 'sender.name'
      // When: buildOrderByClause
      // Then: ORDER BY uses JSON path extraction expression
    });
  });
});
```

---

## File: `sql/internals/buildLimitOffset.test.ts`

```ts
describe('buildLimitOffset', () => {

  describe('_buildLimitClause', () => {
    it('Postgres uses $1 placeholder', () => {
      // Given: dialect 'pg', limit 10
      // When: _buildLimitClause
      // Then: statement contains '$1', args [10]
    });

    it('SQLite uses ? placeholder', () => {
      // Given: dialect 'sqlite', limit 10
      // When: _buildLimitClause
      // Then: statement contains '?', args [10]
    });

    it('handles zero limit', () => {
      // Given: limit 0
      // When: _buildLimitClause
      // Then: statement with 0 as parameter value
    });
  });

  describe('_buildOffsetClause', () => {
    it('Postgres uses $1 placeholder', () => {
      // Given: dialect 'pg', offset 20
      // When: _buildOffsetClause
      // Then: statement contains '$1', args [20]
    });

    it('SQLite uses ? placeholder', () => {
      // Given: dialect 'sqlite', offset 20
      // When: _buildOffsetClause
      // Then: statement contains '?', args [20]
    });

    it('handles zero offset', () => {
      // Given: offset 0
      // When: _buildOffsetClause
      // Then: statement with 0 as parameter value
    });
  });
});
```

---

## File: `sql/internals/buildAfterPkWhere.test.ts`

```ts
describe('buildAfterPkWhere', () => {

  describe('Defense in Depth', () => {
    it('returns error when sort is empty', () => {
      // Given: empty sort array, after_pk set
      // When: buildAfterPkWhere
      // Then: error result
    });
  });

  describe('Postgres', () => {
    it('generates correct comparison for single key DESC', () => {
      // Given: dialect 'pg', sort [date DESC], after_pk
      // When: buildAfterPkWhere
      // Then: WHERE uses < comparison via subquery
    });

    it('generates correct comparison for single key ASC', () => {
      // Given: dialect 'pg', sort [name ASC], after_pk
      // When: buildAfterPkWhere
      // Then: WHERE uses > comparison via subquery
    });

    it('uses IS NOT DISTINCT FROM for NULL-safe equality', () => {
      // Given: dialect 'pg', multi-key sort with after_pk
      // When: buildAfterPkWhere
      // Then: equality branches use IS NOT DISTINCT FROM
    });

    it('wraps NULL-aware comparison around direction operator', () => {
      // Given: dialect 'pg', sort key with potential NULLs
      // When: buildAfterPkWhere
      // Then: comparison accounts for NULL ordering
    });
  });

  describe('SQLite', () => {
    it('uses IS for NULL-safe equality', () => {
      // Given: dialect 'sqlite', multi-key sort with after_pk
      // When: buildAfterPkWhere
      // Then: equality branches use IS
    });

    it('uses ? placeholders', () => {
      // Given: dialect 'sqlite', sort with after_pk
      // When: buildAfterPkWhere
      // Then: all placeholders are ?
    });
  });

  describe('JSON Column Expressions', () => {
    it('uses pathToSqlExpression for JSON column access', () => {
      // Given: objectColumnName 'data', sort key 'sender.name'
      // When: buildAfterPkWhere
      // Then: WHERE clause uses JSON path extraction
    });
  });

  describe('Table Name Quoting', () => {
    it('quotes table names with special characters', () => {
      // Given: tableName 'my-table'
      // When: buildAfterPkWhere
      // Then: table name is quoted in subquery
    });
  });

  describe('Multi-Key Sort', () => {
    it('generates OR chain for mixed ASC/DESC directions', () => {
      // Given: sort [category ASC, date DESC, name ASC], after_pk
      // When: buildAfterPkWhere
      // Then: OR chain with lexicographic tuple comparison
    });
  });
});
```

---

## File: `flattenQueryClauses.test.ts`

```ts
describe('flattenQueryClausesToSql', () => {

  describe('Clause Assembly', () => {

    describe('Keyword Ordering (WHERE -> ORDER BY -> LIMIT -> OFFSET)', () => {
      it('assembles all clauses in correct SQL keyword order', () => {
        // Given: all four clauses populated
        // When: flattenQueryClausesToSql
        // Then: sql has WHERE before ORDER BY before LIMIT before OFFSET
      });
    });

    describe('Selective Clauses (only non-null included)', () => {
      it('includes only WHERE when other clauses are null', () => {
        // Given: where_statement set, others null
        // When: flattenQueryClausesToSql
        // Then: sql is 'WHERE <clause>'
      });

      it('includes only ORDER BY when other clauses are null', () => {
        // Given: order_by_statement set, others null
        // When: flattenQueryClausesToSql
        // Then: sql is 'ORDER BY <clause>'
      });

      it('includes only LIMIT when other clauses are null', () => {
        // Given: limit_statement set, others null
        // When: flattenQueryClausesToSql
        // Then: sql is 'LIMIT <value>'
      });

      it('includes ORDER BY and LIMIT without WHERE', () => {
        // Given: order_by + limit set, where + offset null
        // When: flattenQueryClausesToSql
        // Then: sql is 'ORDER BY <clause> LIMIT <value>'
      });
    });
  });

  describe('Parameter Renumbering', () => {

    describe('Postgres $N Rebasing', () => {
      it('renumbers parameters sequentially across clauses', () => {
        // Given: WHERE has $1, LIMIT would be $1 standalone
        // When: flattenQueryClausesToSql for 'pg'
        // Then: WHERE stays $1, LIMIT becomes $2
      });

      it('handles WHERE with multiple params followed by LIMIT and OFFSET', () => {
        // Given: WHERE has $1 $2, LIMIT $1, OFFSET $1
        // When: flatten for 'pg'
        // Then: WHERE $1 $2, LIMIT $3, OFFSET $4
      });
    });

    describe('SQLite ? Pass-Through', () => {
      it('preserves ? placeholders without renumbering', () => {
        // Given: WHERE with ?, LIMIT with ?
        // When: flattenQueryClausesToSql for 'sqlite'
        // Then: sql contains ? placeholders, parameters concatenated in order
      });
    });
  });

  describe('Empty Input', () => {
    it('returns empty sql and empty parameters when all clauses are null', () => {
      // Given: all nulls
      // When: flattenQueryClausesToSql
      // Then: { sql: '', parameters: [] }
    });
  });

  describe('Invariants', () => {
    it('parameter count matches total across all non-null clauses', () => {
      // Property: parameters.length === sum of all clause statement_arguments lengths
    });

    it('same input produces identical output', () => {
      // Property: idempotency
    });
  });
});
```

---

## File: `query-integration.test.ts`

Most equivalence and end-to-end pagination tests are now proven by running the same `standardTests` across all 5 adapters. This file retains only tests that require composing WHERE filters with sort/pagination — something the standard tests don't cover because `execute` doesn't accept a WHERE filter.

```ts
describe('Query Module Integration', () => {

  describe('WHERE + Sort Composition', () => {

    describe('Filter Does Not Corrupt Pagination', () => {
      it('adding a WHERE filter preserves sort order of remaining items', () => {
        // Given: sorted dataset, a filter that excludes some items
        // When: query with filter + sort
        // Then: result is the sorted subset (filter applied, order maintained)
      });

      it('cursor pagination through filtered results yields correct subset', () => {
        // Given: dataset, filter, cursor pagination
        // When: paginate through filtered query
        // Then: all matching items appear exactly once in correct order
      });
    });

    describe('Filter Commutativity', () => {
      it('swapping order of additional WHERE clauses produces identical results', () => {
        // Given: two WHERE clauses A, B
        // When: prepareObjectTableQuery with [A, B] vs [B, A]
        // Then: flattened SQL is semantically equivalent (same params, same result when executed)
      });

      it('commutativity holds when combined with cursor pagination', () => {
        // Given: two WHERE clauses A, B + sort + after_pk cursor
        // When: prepareObjectTableQuery with [A, B] vs [B, A], both with same cursor
        // Then: executing both queries against SQLite produces identical result sets
      });
    });
  });
});
```
