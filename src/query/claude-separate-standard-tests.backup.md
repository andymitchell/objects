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

## Plan

### Phase 1: Design the standard test contract

- [ ] Define the `Execute` type signature and `StandardTestConfig` type
- [ ] Define the shared test data fixtures (objects with varying types, nulls, duplicates, nested props) and Zod schemas for them
- [ ] List the exact `describe`/`test` blocks that will go in `standardTests`, pulled from `proposed-test-structure.md` — only the behavioral/data-result tests identified above
- [ ] Write this as a skeleton in a new file `./planning-testing/standard-tests-skeleton.md`

*Output: a concrete spec for the standardTests function — types, fixtures, and test list. This makes Phase 2 mechanical.*

### Phase 2: Implement `standardTests.ts`

- [ ] Create `src/query/standardTests.ts` with the `standardTests(config)` function
- [ ] Implement all shared behavioral tests using the `execute` adapter
- [ ] Add `expectOrAcknowledgeUnsupported` helper (as in where-filter) for features some environments may not support
- [ ] Verify it compiles (no adapter needed yet — just the shared suite)

*Output: the shared test suite, ready to be called by adapters.*

### Phase 3: Implement the runtime adapter

- [ ] In `sortAndSliceObjects.test.ts`, implement the `execute` adapter wrapping `sortAndSliceObjects`
- [ ] Call `standardTests()` from within the existing `describe` block
- [ ] Run tests, fix any failures — this validates the standard tests against the simplest environment
- [ ] Identify any runtime-only tests that remain (e.g. immutability of input array, referential identity of output items) and keep those per-file

*Output: green standard tests for JS runtime. Proves the shared suite works before tackling SQL.*

### Phase 4: Implement SQL adapters

- [ ] **SQLite ObjectTable adapter** (`prepareObjectTableQuery.sqlite.test.ts`): in-memory better-sqlite3, JSON column, insert → build clauses → execute → parse → return objects
- [ ] **Pg ObjectTable adapter** (`prepareObjectTableQuery.pg.test.ts`): PgLite, JSONB column, same pattern
- [ ] **SQLite ColumnTable adapter** (`prepareColumnTableQuery.sqlite.test.ts`): in-memory better-sqlite3, typed columns, insert → build clauses → execute → return row objects
- [ ] **Pg ColumnTable adapter** (`prepareColumnTableQuery.pg.test.ts`): PgLite, typed columns, same pattern
- [ ] Each calls `standardTests()` and returns `undefined` for unsupported features
- [ ] Run all 5 adapter test files, fix failures

*Output: all 5 adapters green. Cross-environment behavioral equivalence is proven.*

### Phase 5: Prune duplicated per-file tests

- [ ] Review each per-file test in `proposed-test-structure.md`
- [ ] Remove tests that are now fully covered by `standardTests` (likely most of `sortAndSliceObjects.test.ts`'s sorting/pagination tests)
- [ ] Keep per-file tests that inspect implementation details (SQL output, parameter shapes, validation errors, dialect specifics)
- [ ] Update `proposed-test-structure.md` to reflect the final split
