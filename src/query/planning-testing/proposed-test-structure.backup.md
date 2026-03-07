# Proposed Test Structure

Hierarchy of `describe` blocks with skeleton `it` blocks (empty, with Given/When/Then comments).

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

---

## File: `sortAndSliceObjects.test.ts`

```ts
describe('sortAndSliceObjects', () => {

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
  });

  describe('Sorting', () => {

    describe('Single Key', () => {
      it('sorts items in ascending order by a numeric field', () => {
        // Given: items with numeric 'age' values in random order
        // When: sortAndSliceObjects(items, { sort: [{ key: 'age', direction: 1 }] }, 'id')
        // Then: items ordered by age ascending
      });

      it('sorts items in descending order by a string field', () => {
        // Given: items with string 'name' values
        // When: sort direction: -1
        // Then: items ordered by name descending (lexicographic)
      });
    });

    describe('Multi-Key', () => {
      it('uses secondary sort key to break ties on primary key', () => {
        // Given: items where several share the same primary sort value
        // When: sort by [category ASC, name ASC]
        // Then: within each category, items are sorted by name
      });

      it('respects independent direction per sort key', () => {
        // Given: items with category and date
        // When: sort by [category ASC, date DESC]
        // Then: categories ascending, within each category dates descending
      });
    });

    describe('Null / Undefined Values', () => {
      it('places items with null sort values after all non-null items', () => {
        // Given: items where some have null for the sort key
        // When: sort ascending
        // Then: non-null items first (sorted), null items last
      });

      it('places items with undefined sort values after all non-null items', () => {
        // Given: items where some lack the sort key entirely
        // When: sort ascending
        // Then: non-null items first, undefined items last
      });

      it('null-last behaviour applies regardless of sort direction', () => {
        // Given: items with nulls
        // When: sort descending
        // Then: non-null items first (sorted desc), null items last
      });
    });

    describe('PK Tiebreaker', () => {
      it('produces deterministic order when all sort values are identical', () => {
        // Given: items all with same sort value, different PKs
        // When: sort by that key
        // Then: items ordered by PK ascending as tiebreaker
      });

      it('does not add duplicate tiebreaker when PK is already last sort key', () => {
        // Given: sort: [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }]
        // When: sortAndSliceObjects
        // Then: result identical to when PK tiebreaker would be auto-appended
        // (Verified by comparing with sort that omits the explicit PK entry)
      });
    });

    describe('Nested Properties', () => {
      it('sorts by a dot-prop path into nested objects', () => {
        // Given: items with nested structure { sender: { name: string } }
        // When: sort by 'sender.name'
        // Then: items sorted by the nested value
      });
    });
  });

  describe('Cursor Pagination (after_pk)', () => {

    describe('Basic Cursor', () => {
      it('returns items after the cursor item, excluding the cursor itself', () => {
        // Given: sorted items [A, B, C, D, E], after_pk = B's PK
        // When: sortAndSliceObjects
        // Then: [C, D, E]
      });

      it('returns items after cursor with limit applied', () => {
        // Given: sorted items [A, B, C, D, E], after_pk = B, limit = 2
        // When: sortAndSliceObjects
        // Then: [C, D]
      });

      it('returns empty when cursor points to last item', () => {
        // Given: sorted items [A, B, C], after_pk = C's PK
        // When: sortAndSliceObjects
        // Then: []
      });

      it('returns all items except first when cursor points to first item', () => {
        // Given: sorted items [A, B, C], after_pk = A's PK
        // When: sortAndSliceObjects
        // Then: [B, C]
      });
    });

    describe('Sequential Pagination Completeness', () => {
      it('paginating through entire dataset yields every item exactly once', () => {
        // Given: N items, page size M
        // When: repeatedly call with after_pk = last item of previous page
        // Then: union of all pages equals full sorted dataset, no duplicates
      });

      it('completeness holds when items have duplicate sort values', () => {
        // Given: items with many duplicate sort values, page size smaller than duplicates
        // When: sequential cursor pagination
        // Then: all items appear exactly once across pages
      });

      it('[property-based] completeness holds for random data with nulls and duplicates', () => {
        // Given: fast-check generated array of objects with random values (including nulls, duplicates), random page size 1..N
        // When: sequential cursor pagination via sortAndSliceObjects
        // Then: concatenated pages equal full sorted result, no duplicates, no gaps
      });
    });

    describe('Stale / Missing Cursor', () => {
      it('returns empty array when after_pk matches no item', () => {
        // Given: items, after_pk = 'nonexistent'
        // When: sortAndSliceObjects
        // Then: { success: true, items: [] }
      });
    });
  });

  describe('Offset Pagination', () => {
    it('skips the first N items', () => {
      // Given: 5 sorted items, offset: 2
      // When: sortAndSliceObjects
      // Then: last 3 items
    });

    it('returns empty when offset exceeds array length', () => {
      // Given: 3 items, offset: 10
      // When: sortAndSliceObjects
      // Then: []
    });

    it('combines offset and limit correctly', () => {
      // Given: 10 sorted items, offset: 3, limit: 2
      // When: sortAndSliceObjects
      // Then: items at positions 3 and 4
    });
  });

  describe('Limit', () => {
    it('returns at most N items', () => {
      // Given: 10 items, limit: 3
      // When: sortAndSliceObjects
      // Then: 3 items
    });

    it('returns all items when limit exceeds array length', () => {
      // Given: 3 items, limit: 100
      // When: sortAndSliceObjects
      // Then: 3 items
    });

    it('returns empty array when limit is zero', () => {
      // Given: items, limit: 0
      // When: sortAndSliceObjects
      // Then: []
    });
  });

  describe('Composition (sort + limit + offset / cursor)', () => {
    it('applies sort before limit', () => {
      // Given: unsorted items, sort ASC, limit 2
      // When: sortAndSliceObjects
      // Then: first 2 items of sorted order (not first 2 of input order)
    });

    it('applies sort before offset', () => {
      // Given: unsorted items, sort ASC, offset 2
      // When: sortAndSliceObjects
      // Then: items after position 2 in sorted order
    });

    it('returns all items unchanged when SortAndSlice is empty', () => {
      // Given: items, {}
      // When: sortAndSliceObjects
      // Then: items in original order, all present
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

  describe('Invariants', () => {
    it('calling twice with same input returns identical result', () => {
      // Given: items, sortAndSlice, pk
      // When: call twice
      // Then: results deep-equal
    });

    it('limit N result is a prefix of limit N+1 result', () => {
      // Property: for any N, result(limit=N).items is a prefix of result(limit=N+1).items
    });

    it('offset pages are complementary with limit', () => {
      // Property: result(offset=0, limit=N) ++ result(offset=N, limit=M)
      //           covers same items as result(limit=N+M)
    });
  });

  describe('Edge Cases', () => {
    it('handles empty input array', () => {
      // Given: [], any sortAndSlice
      // When: sortAndSliceObjects
      // Then: { success: true, items: [] }
    });

    it('handles single-item array', () => {
      // Given: [item], sort
      // When: sortAndSliceObjects
      // Then: [item]
    });
  });
});
```

---

## File: `prepareObjectTableQuery.test.ts`

```ts
describe('prepareObjectTableQuery', () => {

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

---

## File: `prepareColumnTableQuery.test.ts`

```ts
describe('prepareColumnTableQuery', () => {

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

```ts
describe('Query Module Integration', () => {

  describe('JS / SQL Equivalence', () => {
    it('sortAndSliceObjects and prepareObjectTableQuery produce the same item order for the same data', () => {
      // Given: a dataset, a SortAndSlice config
      // When: sort in-memory via sortAndSliceObjects, and build SQL via prepareObjectTableQuery + execute against SQLite in-memory DB
      // Then: both produce items in identical order
    });

    it('equivalence holds with null values in sort keys', () => {
      // Given: dataset with nulls in sort columns
      // When: compare JS and SQL ordering
      // Then: identical order (nulls last in both)
    });

    it('equivalence holds with multi-key sort and cursor pagination', () => {
      // Given: dataset, multi-key sort, after_pk cursor
      // When: compare JS result with SQL result
      // Then: same items in same order
    });

    it('equivalence holds for case-sensitive string sorting', () => {
      // Given: dataset with mixed-case strings (e.g. 'apple', 'Banana', 'cherry')
      // When: compare JS and SQL ordering
      // Then: identical order (JS uses < operator, SQLite default collation matches)
    });

    it('[property-based] JS and SQL produce identical ordering for random data', () => {
      // Given: fast-check generated dataset with random strings, numbers, nulls; random SortAndSlice
      // When: sort in-memory and via SQL
      // Then: PK orderings match
    });
  });

  describe('End-to-End Pagination', () => {

    describe('Cursor Pagination Covers All Rows', () => {
      it('sequential cursor pages via prepareObjectTableQuery cover every row exactly once', () => {
        // Given: N rows in SQLite table, page size M
        // When: paginate via after_pk, flattening each page's SQL and executing
        // Then: union of all pages === full dataset, no duplicates, no gaps
      });

      it('cursor pagination is stable when sort values have duplicates', () => {
        // Given: rows with many duplicate sort values
        // When: sequential cursor pagination
        // Then: all rows appear exactly once
      });

      it('[property-based] cursor pagination completeness for random data in SQL', () => {
        // Given: fast-check generated rows inserted into SQLite, random page size
        // When: sequential cursor pagination via prepareObjectTableQuery + flatten + execute
        // Then: concatenated pages equal full sorted result
      });
    });

    describe('Stale Cursor in SQL', () => {
      it('stale cursor returns empty result set when subquery yields no rows', () => {
        // Given: rows in SQLite table, after_pk = 'nonexistent-pk'
        // When: prepareObjectTableQuery + flatten + execute against SQLite
        // Then: empty result set (subquery NULL causes WHERE to be falsy)
      });
    });

    describe('Offset Pagination Covers All Rows', () => {
      it('sequential offset pages cover every row exactly once', () => {
        // Given: N rows, page size M
        // When: paginate via offset (0, M, 2M, ...)
        // Then: union === full dataset
      });
    });
  });

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
