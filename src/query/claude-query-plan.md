# Query: Sort, Cursor Pagination & Limit

## Goal

Design a simple-but-flexible system for sorting a list of objects, with support for the most common pagination cases. 

## Context

We have `WhereFilterDefinition` — a Mongo-style predicate that tests whether a single JS object matches a filter (like a WHERE clause). It works across JS runtime (`matchJavascriptObject`), Postgres (`prepareWhereClauseForPg`), and SQLite (`prepareWhereClauseForSqlite`).

We now need **ordering + cursor pagination + limits** on top of it. The goals:
- Stick close to Mongo-like terminology so an LLM can guess usage.
- Keep it as a **separate, composable concept** 
- Work across JS runtime and SQL backends with a unified conceptual approach (although implementations may drift), similar to @../where-filter/sql
- Make it useful for the higher-level Collection's get function, which will look something like this: `get(filter:WhereFilterDefinition, sortAndSlice: SortingAndSlicingType)`
    - We want to keep our system interoperable with major JS object stores (especially TanStack DB) because ICollection will be a provider to them, so their requests must be translatable to our collection store. 





# Reference Material

## Knowing the ID/primary-key field of an object: use the DDL

ID is defined via `primary_key` in the DDL type (`ListRulesCore` in `write-actions/writeToItemsArray/types.ts`). The `after_pk` field takes a primary key value directly — the executor resolves it against the DDL's `primary_key`.

Note: the DDL currently has `order_by: ListOrdering<T>` which specifies a default sort. This will likely become `default_order_by` and use `SortDefinition` (or a compatible shape) from this new `query/` module. When a `QueryDefinition` omits `$sort`, the executor falls back to the DDL's `default_order_by`.

## Combining SQL WHERE clauses with numbered placeholders

The utility functions for safely combining multiple parameterized SQL fragments (each using `$1`, `$2`, etc.) already exist in the utils package:

**Location:** `@~/git/breef/utils/src/main/db/postgres/rebaseSqlParameters.ts`
**Exports:** `@~/git/breef/utils/src/main/db/postgres/index.ts`
**Tests:** `@~/git/breef/utils/src/main/db/postgres/rebaseSqlParameters.test.ts`

### `rebaseSqlParameters(sql: string, rebase: number): string`
Shifts all `$N` parameter indexes in a SQL string by a given offset, maintaining relative gaps.
```ts
rebaseSqlParameters('age > $1 and name = $2', 2)  // 'age > $2 and name = $3'
```

### `appendSqlParameters(existingParameters: any[], appending: { sql: string, parameters: any[] })`
Appends a parameterized SQL fragment to existing parameters, rebasing placeholders automatically.
```ts
appendSqlParameters(['a', 'b'], { sql: 'age > $1', parameters: [5] })
// { sql: 'age > $3', parameters: [5], complete_parameters: ['a', 'b', 5] }
```

### `concatSqlParameters(fragments: {sql: string, parameters: any[]}[], join = ' AND ')`
Combines multiple parameterized SQL fragments, renumbering all placeholders for safe concatenation.
```ts
concatSqlParameters([
  { sql: '(age > $1 OR age > $2)', parameters: [5, 10] },
  { sql: '(name = $1 OR name = $2)', parameters: ['Bob', 'Alice'] }
], ' AND ')
// { sql: '(age > $1 OR age > $2) AND (name = $3 OR name = $4)', parameters: [5, 10, 'Bob', 'Alice'] }
```

**Relevance:** When the query system composes a WHERE clause (from `WhereFilterDefinition`) with additional pagination WHERE clauses (e.g. cursor conditions), these functions handle safe placeholder renumbering.


## Other Systems to Align With

1. **TanStack DB** — TypeScript-first local-first reactive database. Highest priority for interop. Has `orderBy`, `limit`, `offset`, and cursor pagination via `loadSubsetOptions`. [Docs](https://tanstack.com/db/latest/docs/collections/query-collection) | [GitHub](https://github.com/TanStack/db)
2. **RxDB** — Mature reactive JS database using Mango/Mongo-style queries. Fluent API: `.find().sort().limit()`. Always appends primaryKey to indexes for deterministic sort. [Docs](https://rxdb.info/rx-query.html) | [GitHub](https://github.com/pubkey/rxdb)
3. **Triplit** — Full-stack syncing database (server + client). TypeScript-first. Fluent API with `.order()`, `.limit()`, `.after()` cursor. [Docs](https://www.triplit.dev/docs) | [GitHub](https://github.com/aspen-cloud/triplit)
4. **Dexie.js** — Most popular IndexedDB wrapper. Has `orderBy()`, `limit()`, `offset()`. Docs recommend cursor-based pagination over offset for performance. [Docs](https://dexie.org/) | [GitHub](https://github.com/dexie/Dexie.js)
5. **Drizzle ORM** — TypeScript SQL ORM. Documents both offset-based and cursor-based pagination with clear SQL generation. Useful as SQL-oriented reference. [Offset docs](https://orm.drizzle.team/docs/guides/limit-offset-pagination) | [Cursor docs](https://orm.drizzle.team/docs/guides/cursor-based-pagination)

### TanStack DB alignment: why offset is required

TanStack DB's front-end query builder exposes `offset` directly:
```ts
query.from({ emails }).orderBy(e => e.date, 'desc').offset(20).limit(10)
```

The sync backend receives this via `LoadSubsetOptions` which carries both `offset?: number` and `cursor?: CursorExpressions`. If our store is the backend provider, we must handle `offset` when TanStack sends it. Without native offset support we'd have to either reject it (breaking compatibility) or translate offset→cursor (scan sorted results to find the item at position N, then use it as a cursor — O(N) and two passes, i.e. implementing offset anyway but worse).

### TanStack DB cursor internals

- TanStack DB's `LoadSubsetOptions` provides `cursor?: CursorExpressions` with `whereFrom` (rows after cursor), `whereCurrent` (tie-breaking), and `lastKey`.
- Multi-column composite cursors: for `[col1 ASC, col2 DESC]` with values `[v1, v2]`, expression becomes `or(gt(col1, v1), and(eq(col1, v1), lt(col2, v2)))`.
- TanStack builds cursors internally in the subscription layer — the front-end API uses `offset`, not cursor. The backend *may* receive either.

# Decision: Support Cursor Pagination (as well as Offset)

## What cursor means in our system

**`after_pk: <primary_key_value>`** — a PK-based cursor with exclusive semantics ("give me items after the one with this PK, not including it").

The executor: (1) sorts the result set per `$sort` or DDL `default_order_by`, (2) finds the row with that PK, (3) returns the next `$limit` rows after it. The caller doesn't need to know sort-key values — just the PK of the last item they saw.

**How this differs from other systems:** Most systems with cursor support use value-based cursors (Triplit's `.after([sortVal1, sortVal2])`, TanStack's internal `buildCursor` which generates `WHERE col > val`). Our `after_pk` is simpler from the caller's perspective — pass a PK, get the next page — but harder to implement in SQL because non-sortable UUIDs can't use `WHERE id > ?`.

**Opaque page tokens are excluded.** Gmail's `pageToken` is server-generated, not derivable from any field on returned objects. Stripe's `starting_after` is semantically tied to Stripe's internal ordering. These are continuation state, not query semantics. A Gmail thin adaptor cannot translate `after_pk` into a `pageToken` (the mapping doesn't exist). See "Constraints / Hard Decisions" above.

## Practical need for Cursor Pagination (`after_pk`)

API interop does not motivate `after_pk` — opaque tokens are handled separately. TanStack interop doesn't either — TanStack uses value-based cursors that map to `WhereFilterDefinition`. The justification is purely **local query ergonomics**:


1. **Resumable position across sessions.** App stores "user was viewing item X." With `after_pk`, pass the PK directly on resume. With offset, the position may have shifted due to inserts/deletes — the app must re-find X's current offset first.
2. **"Show items after X."** User clicks an item, wants what follows in the sorted list. `after_pk` is one call. Offset requires first determining X's position (extra query or client-side scan).

3. **Caller naturally has a PK.** Every object carries its PK — the caller always has it. Offset requires extra bookkeeping (tracking position). Value-based cursors require extracting sort-field values from the boundary item (which fields? depends on the current sort — easy to get wrong). `after_pk` matches what the caller naturally holds. This is an ergonomic invariant, not a scenario.
4. **Deep linking / shareable position.** A URL like `?after=item_pk_123` is stable — new inserts/deletes don't break it. Offset-based deep links drift as the data changes.
5. **Delete-resilience.** If the boundary item at offset N is deleted, offset N silently points to a different item. With `after_pk`, deletion of the cursor item can be handled explicitly (error or graceful fallback) rather than silently showing wrong data.


## Rationale for supporting Cursor Pagination 

| Factor | Assessment |
|---|---|
| Practical need | Real. "Caller naturally has a PK" is an ergonomic invariant — every object carries its PK, while offset/sort-key values require extra bookkeeping. Resumable positions, deep linking, and delete-resilience are concrete wins. |
| TanStack alignment | Neutral. TanStack uses value-based cursors internally, which map to `WhereFilterDefinition`, not `after_pk`. But `after_pk` doesn't conflict — it's orthogonal. |
| Maintenance cost | Low. 4/5 backends are trivial (~5 lines each). SQL is ~40 lines per dialect, leveraging the existing shared `whereClauseEngine.ts` pattern. Testing surface is small and reusable via `standardTests`. |
| Industry precedent | Weak — only Triplit has explicit cursor, and it's value-based. But PK-based is more ergonomic than value-based, differentiating us positively. |


# Early Concept of System

See @./implementation_concept.md. It will have these major thing: 
- SortAndSlice type
- PreparedQueryStatement and PreparedSortAndSliceStatement types
     - PreparedSortAndSliceStatement and PreparedQueryResult
- prepareObjectsTableQuery - works on our commonly used concept of a table with a json column for objects of a schema type
- prepareTableSortAndSlice - works on relational table 

## Implementation of `after_pk`

### JS Runtime 

Pipeline: filter -> sort -> scan for `$after` primary key -> take `$limit` items after it.

- First page: omit `$after`, get first `$limit` items.
- Next page: set `$after` to last item's primary key from previous page.
- If `$after` ID not found in results, return empty (safe default — stale cursor).

### SQL

one of:

1. **Subquery / CTE approach**: `WHERE (sort_cols) > (SELECT sort_cols FROM t WHERE pk = ?)` — works for single sort key, gets complex with multi-key sorts (tuple comparison).
2. **ROW_NUMBER window function**: `WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY ...) AS rn FROM t WHERE ...) SELECT * FROM ranked WHERE rn > (SELECT rn FROM ranked WHERE pk = ?)` — clean but may be slow on large tables.
3. **Caller resolves cursor**: The executor looks up the `$after` row's sort-key values first, then uses them as a range filter. Two queries but simple SQL.


# Plan


_Important: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

## [ ] Phase 1

Plan the implementation at quite a high level. 

Use this file, and @./implementation_concept.md as inspiration (you can also look at how @../where-filter does it with types and JS runtime in root, then sql and its dialects in sub folders).

Stay high level enough that each function should be defined at this stage as bullet points of the algorithm/flow it'll use

Extra bits to remember: 
- Use the naming I used in @./implementation_concept.md.
- Write JSDocs that emphasise the concept of what it's doing for all functions and types 
- Write a INTENT that conscisely expresses what this ./query part of the library is doing 

Start by clarifying with me anything you find ambiguous, or challenging me. 

Output to a new file called "impl-plan.md"


# Deferred Plan

If we decide to proceed with Cursor pagination on logic alone, we need to: 
* Look at the complexity of implementation, especially in SQL 
    * Write perf tests in Pglite against the 3 approaches identified earlier 
* Decide if that complexity is still worth supporting, or if there are alternatives

How close to stick or diverge from Mongo (order by array; dot-prop paths). 
Look at how minimal the instructions to an LLM can be on how to use it, referencing Mongo-but-different. 

Bring in open questions from other doc. 

## [ ] Update DDL to change `order_by` to be default only

This will likely become `default_order_by` and use `SortDefinition` (or a compatible shape) from this new `query/` module. It will only be used when the query definition is 

When a `QueryDefinition` omits `$sort`, the executor falls back to the DDL's `default_order_by`.


# Deferred: ICollection Decisions

## Thin API adaptors and opaque tokens

A thin adaptor (e.g. Gmail → `ICollection`) is a real scenario. But it doesn't use these query primitives for pagination:

- **Gmail doesn't support sorting** — results come in Gmail's default order only. `$sort` would be unsupported (error-as-value).
- **Gmail's `pageToken` is opaque** — not derivable from thread IDs or any returned field. An adaptor cannot translate `after_pk` to a `pageToken`.
- **Resolution:** Opaque page tokens are a custom parameter on `ICollection.get()`, outside the query type system. The adaptor returns error-as-value for unsupported query features (`$sort`, `after_pk`, `$offset`). A specific error type (e.g. `unsupported_query_feature`) is needed in the error system.

This keeps the query definition clean and composable. `ICollection` can support opaque tokens without polluting the query types that libraries like `matchJavascriptObject` and `sqliteWhereClauseBuilder` consume.

## Rules for ICollection

- `get()` accepts `WhereFilterDefinition` + query options (`$sort`, `$limit`, and one of `$offset` | `after_pk`)
- `$sort` is optional — falls back to DDL's `default_order_by`
- `$limit` is optional
- `$offset` and `after_pk` are mutually exclusive (type-level union)
- `after_pk` requires a deterministic sort (explicit `$sort` or DDL `default_order_by`) — runtime validated
- **Opaque page tokens are NOT part of query types** — they're a custom parameter on `ICollection.get()`, separate from the query definition
- Implementations return **error-as-value** for unsupported features (e.g. a Gmail adaptor receiving `$sort`). A specific error type (e.g. `unsupported_query_feature`) must be supported in the error system.
- Peek-ahead-by-1 for `hasNextPage` detection: request `$limit + 1` items, strip the extra before returning
