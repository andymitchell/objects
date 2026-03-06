# Query: Sort, Cursor Pagination & Limit

## Goal

Design a simple-but-flexible system for sorting a list of objects, with support for the most common pagination cases. 

## Context

We have `WhereFilterDefinition` — a Mongo-style predicate that tests whether a single JS object matches a filter (like a WHERE clause). It works across JS runtime (`matchJavascriptObject`), Postgres (`postgresWhereClauseBuilder`), and SQLite (`sqliteWhereClauseBuilder`).

We now need **ordering + cursor pagination + limits** on top of it. The goals:
- Stick close to Mongo-like terminology so an LLM can guess usage.
- Keep it as a **separate, composable concept** — filtering is a predicate on one object; ordering/pagination operate on collections.
- Work across JS runtime and SQL backends with a unified conceptual approach (although implementations may drift)

This query system will be the foundation for a higher-level Collection system (CRUD operated with get/write, where 'get' uses `WhereFilterDefinition` + whatever sorting/pagination we invent here; and writes use `WriteAction`). 
This is important to know, as it's the reason we want to keep it aligned with the language/options of other JS/TS object systems, especially TanStack DB. E.g. we might use TanStack DB as the front end interface, and then our system behind it as the provider. So we have to support the same offset/cursor pagination as TanStack does (TBD).

# Reference Material

## Knowing the ID/primary-key field of an object: use the DDL

ID is defined via `primary_key` in the DDL type (`ListRulesCore` in `write-actions/writeToItemsArray/types.ts`). The `$after_pk` field takes a primary key value directly — the executor resolves it against the DDL's `primary_key`.

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

## Previous research on cursor pagination

Summarised from `@~/git/breef/store/src-v2-rewrite/claude-store-rewrite.md` (lines 140-386) and `claude-store-rewrite-redux.md` (lines 3-86).

### Old system: two generations of pagination — context, not precedent

The old store had two generations of pagination (Gen 1: external pages with PK junction tables; Gen 2: `PageBounds` with value-based boundaries as a linked list). **Both solved a different problem than what we're building here.** They were designed to *sync/clone remote API pages* (e.g. Gmail) and track which pages had already been fetched. Gap prevention, boundary stitching, and page reuse logic were all about efficient incremental ingestion from an external source — not about querying a local store.

Once data is in the local store, we query it fresh. The old system's pain points (items falling between page boundaries, boundary drift on sort-field updates) are sync-layer concerns, not query-layer concerns. They do not argue against offset pagination for local queries.

**Item shifting under concurrent writes** (rows at positions 10–20 moving to 15–25 after inserts) affects both offset and cursor equally, and is **expected UX** — if new items arrive, the list view should reflect it.

See `@~/git/breef/store/src-v2-rewrite/claude-store-rewrite.md` (lines 140–386) and `claude-store-rewrite-redux.md` (lines 3–86) for full details on the old system.

### Decision: support offset pagination

Offset is trivial to implement (`OFFSET N` in SQL, `.slice(N)` in JS) and is the standard pagination primitive across all reference systems. **We will support offset.**

The question of whether to *also* support cursor pagination is separate and addressed in a later phase.

### TanStack DB alignment: why offset is required

TanStack DB's front-end query builder exposes `offset` directly:
```ts
query.from({ emails }).orderBy(e => e.date, 'desc').offset(20).limit(10)
```

The sync backend receives this via `LoadSubsetOptions` which carries both `offset?: number` and `cursor?: CursorExpressions`. If our store is the backend provider, we must handle `offset` when TanStack sends it. Without native offset support we'd have to either reject it (breaking compatibility) or translate offset→cursor (scan sorted results to find the item at position N, then use it as a cursor — O(N) and two passes, i.e. implementing offset anyway but worse).

### Old store's cursor design (for reference, not adopted)

The old store proposed cursor as: `{ order_by: keyof T, cursor?: { after: value }, limit: number }`, returning `{ items, item_pks, next_cursor }`. This was designed in the context of the sync layer. Whether cursor is also useful for the query layer is an open question — see Phase: Decide about supporting cursor pagination.

### TanStack DB cursor internals

- TanStack DB's `LoadSubsetOptions` provides `cursor?: CursorExpressions` with `whereFrom` (rows after cursor), `whereCurrent` (tie-breaking), and `lastKey`.
- Multi-column composite cursors: for `[col1 ASC, col2 DESC]` with values `[v1, v2]`, expression becomes `or(gt(col1, v1), and(eq(col1, v1), lt(col2, v2)))`.
- TanStack builds cursors internally in the subscription layer — the front-end API uses `offset`, not cursor. The backend *may* receive either.

### "More pages" detection

- **Peek-ahead-by-1:** request `pageSize + 1` items, detect `hasNextPage` from whether the extra item exists.
- No expensive `COUNT(*)` queries needed.
- Used by TanStack DB's `useLiveInfiniteQuery`.

### Trade-offs identified

- Cursor pagination is **stable** under concurrent inserts/deletes; offset is not.
- SQL engines optimize cursor queries well with indexes.
- Drop all old "page metadata" concepts — `ViewPageMeta`, page tracking tables, named pages.

## Examples of Other System order|sort/limit/offset

Full examples with code, types, and cross-system comparison: **[reference-other-systems.md](./reference-other-systems.md)**

### Other systems to evaluate

1. **TanStack DB** — TypeScript-first local-first reactive database. Highest priority for interop. Has `orderBy`, `limit`, `offset`, and cursor pagination via `loadSubsetOptions`. [Docs](https://tanstack.com/db/latest/docs/collections/query-collection) | [GitHub](https://github.com/TanStack/db)
2. **RxDB** — Mature reactive JS database using Mango/Mongo-style queries. Fluent API: `.find().sort().limit()`. Always appends primaryKey to indexes for deterministic sort. [Docs](https://rxdb.info/rx-query.html) | [GitHub](https://github.com/pubkey/rxdb)
3. **Triplit** — Full-stack syncing database (server + client). TypeScript-first. Fluent API with `.order()`, `.limit()`, `.after()` cursor. [Docs](https://www.triplit.dev/docs) | [GitHub](https://github.com/aspen-cloud/triplit)
4. **Dexie.js** — Most popular IndexedDB wrapper. Has `orderBy()`, `limit()`, `offset()`. Docs recommend cursor-based pagination over offset for performance. [Docs](https://dexie.org/) | [GitHub](https://github.com/dexie/Dexie.js)
5. **Drizzle ORM** — TypeScript SQL ORM. Documents both offset-based and cursor-based pagination with clear SQL generation. Useful as SQL-oriented reference. [Offset docs](https://orm.drizzle.team/docs/guides/limit-offset-pagination) | [Cursor docs](https://orm.drizzle.team/docs/guides/cursor-based-pagination)

# Challenges

## Cursor Pagination (`$after_pk`)

PK-based cursor (`$after_pk`) with non-sortable UUIDs cannot use `WHERE id > ?` in SQL. The executor must locate the row's position in the sorted result set. See Step 4 in Phase CursorDecision for the three SQL strategies identified. No other reference system uses PK-based cursors — they all use value-based cursors or skip offset entirely.

# Constraints / Hard Decisions

- **Opaque tokens are fundamentally not queries.** Opaque page tokens (Gmail `pageToken`, Stripe pagination tokens) are continuation state, not query semantics. They don't belong in the query/sort/pagination type system. Composable query libraries (`matchJavascriptObject`, `sqliteWhereClauseBuilder`) cannot interpret opaque tokens — this proves they belong elsewhere. If `ICollection` needs opaque token support, it's a custom parameter on `ICollection.get`, not part of the query definition.
- **Pagination modes are mutually exclusive at the type level.** `$offset` and `$after_pk` are a discriminated union — the consumer picks one. No precedence ordering, no surprises.

# Cursor Pagination Decision Making

## What cursor means in our system

**`$after_pk: <primary_key_value>`** — a PK-based cursor with exclusive semantics ("give me items after the one with this PK, not including it").

The executor: (1) sorts the result set per `$sort` or DDL `default_order_by`, (2) finds the row with that PK, (3) returns the next `$limit` rows after it. The caller doesn't need to know sort-key values — just the PK of the last item they saw.

**How this differs from other systems:** Most systems with cursor support use value-based cursors (Triplit's `.after([sortVal1, sortVal2])`, TanStack's internal `buildCursor` which generates `WHERE col > val`). Our `$after_pk` is simpler from the caller's perspective — pass a PK, get the next page — but harder to implement in SQL because non-sortable UUIDs can't use `WHERE id > ?`.

**Opaque page tokens are excluded.** Gmail's `pageToken` is server-generated, not derivable from any field on returned objects. Stripe's `starting_after` is semantically tied to Stripe's internal ordering. These are continuation state, not query semantics. A Gmail thin adaptor cannot translate `$after_pk` into a `pageToken` (the mapping doesn't exist). See "Constraints / Hard Decisions" above.

## Thin API adaptors and opaque tokens

A thin adaptor (e.g. Gmail → `ICollection`) is a real scenario. But it doesn't use these query primitives for pagination:

- **Gmail doesn't support sorting** — results come in Gmail's default order only. `$sort` would be unsupported (error-as-value).
- **Gmail's `pageToken` is opaque** — not derivable from thread IDs or any returned field. An adaptor cannot translate `$after_pk` to a `pageToken`.
- **Resolution:** Opaque page tokens are a custom parameter on `ICollection.get()`, outside the query type system. The adaptor returns error-as-value for unsupported query features (`$sort`, `$after_pk`, `$offset`). A specific error type (e.g. `unsupported_query_feature`) is needed in the error system.

This keeps the query definition clean and composable. `ICollection` can support opaque tokens without polluting the query types that libraries like `matchJavascriptObject` and `sqliteWhereClauseBuilder` consume.

## Practical need for `$after_pk`

API interop does not motivate `$after_pk` — opaque tokens are handled separately. TanStack interop doesn't either — TanStack uses value-based cursors that map to `WhereFilterDefinition`. The justification is purely **local query ergonomics**:


1. **Resumable position across sessions.** App stores "user was viewing item X." With `$after_pk`, pass the PK directly on resume. With offset, the position may have shifted due to inserts/deletes — the app must re-find X's current offset first.
2. **"Show items after X."** User clicks an item, wants what follows in the sorted list. `$after_pk` is one call. Offset requires first determining X's position (extra query or client-side scan).

3. **Caller naturally has a PK.** Every object carries its PK — the caller always has it. Offset requires extra bookkeeping (tracking position). Value-based cursors require extracting sort-field values from the boundary item (which fields? depends on the current sort — easy to get wrong). `$after_pk` matches what the caller naturally holds. This is an ergonomic invariant, not a scenario.
4. **Deep linking / shareable position.** A URL like `?after=item_pk_123` is stable — new inserts/deletes don't break it. Offset-based deep links drift as the data changes.
5. **Delete-resilience.** If the boundary item at offset N is deleted, offset N silently points to a different item. With `$after_pk`, deletion of the cursor item can be handled explicitly (error or graceful fallback) rather than silently showing wrong data.

### Weaker cases (noted, not decisive)

6. **Reactive/live query stability.** `$after_pk` anchors to a specific item as new data arrives, while offset shifts. But we've already said item shifting is "expected UX," so this only matters if we later want a stable-view mode.

**Gate:** Final inclusion depends on whether the SQL **maintenance cost** (not implementation cost) is acceptable — see Step 4.

## Cursor support in reference systems

| System | Cursor API | Type | Notes |
|---|---|---|---|
| TanStack DB | None (user-facing) | Internal value-based | Subscription layer builds `WHERE col > val`; backend receives `cursor` + `offset` |
| Triplit | `.after([v1, v2])` | Value-based | Only system with explicit user-facing cursor. One value per sort field. |
| RxDB | None | — | `skip`/`limit` only |
| Dexie.js | None | — | Docs recommend manual `where.aboveOrEqual(lastValue)` |
| Drizzle ORM | None | — | Documents manual `WHERE id > ?` pattern in a guide |

**Conclusion:** Cursor is a nice-to-have, not an industry expectation. 1 of 5 systems has an explicit cursor API (Triplit). None use PK-based cursors. Including `$after_pk` differentiates us (PK-based is more ergonomic than value-based), but there's no interop pressure requiring it.

## Final decision: support `$after_pk`

**Decision: Yes.** Include `$after_pk` in the query type system and implement across all backends.

**Rationale:**

| Factor | Assessment |
|---|---|
| Practical need | Real. "Caller naturally has a PK" is an ergonomic invariant — every object carries its PK, while offset/sort-key values require extra bookkeeping. Resumable positions, deep linking, and delete-resilience are concrete wins. |
| TanStack alignment | Neutral. TanStack uses value-based cursors internally, which map to `WhereFilterDefinition`, not `$after_pk`. But `$after_pk` doesn't conflict — it's orthogonal. |
| Maintenance cost | Low. 4/5 backends are trivial (~5 lines each). SQL is ~40 lines per dialect, leveraging the existing shared `whereClauseEngine.ts` pattern. Testing surface is small and reusable via `standardTests`. |
| Industry precedent | Weak — only Triplit has explicit cursor, and it's value-based. But PK-based is more ergonomic than value-based, differentiating us positively. |

The practical ergonomic wins justify inclusion given the low maintenance cost. `$after_pk` belongs in the type union as a mutex with `$offset`.

## Examples of implementation + maintenance discussion

### Mock implementations of `$after_pk`

**JS runtime (in-memory list):** ~5 lines. Trivial.
```ts
function applyAfterPk<T>(items: T[], afterPk: string, primaryKey: keyof T): T[] {
    const idx = items.findIndex(item => item[primaryKey] === afterPk);
    if (idx === -1) return []; // or throw — cursor item not found
    return items.slice(idx + 1);
}
// Full pipeline: filter → sort → applyAfterPk → take $limit
```

**Postgres (JSONB column):** Uses subquery to resolve PK → sort-key values, then builds a composite WHERE. Following the existing `PreparedWhereClauseResult` pattern from `whereClauseEngine.ts`:
```ts
// For sort: [{ date: 'desc' }, { id: 'asc' }], after_pk: 'abc-123'
// Generates:
//   WHERE (data->>'date' < (SELECT data->>'date' FROM t WHERE data->>'id' = $1)
//     OR (data->>'date' = (SELECT data->>'date' FROM t WHERE data->>'id' = $1)
//       AND data->>'id' > (SELECT data->>'id' FROM t WHERE data->>'id' = $1)))
//   ORDER BY data->>'date' DESC, data->>'id' ASC
//   LIMIT $2
// parameters: ['abc-123', 20]

function postgresAfterPkClause(
    afterPk: string,
    sort: SortDefinition,
    propertyMap: IPropertyMap,
    existingParams: PreparedStatementArgument[]
): { sql: string; parameters: PreparedStatementArgument[] } {
    // 1. Resolve each sort field's value via subquery
    // 2. Build composite OR/AND for tuple comparison
    // 3. Use concatSqlParameters to merge with existing WHERE
}
```
The subquery approach (strategy 1) avoids a second round-trip. Multi-column sort requires the standard tuple comparison pattern (`OR(gt(col1, v1), AND(eq(col1, v1), gt(col2, v2)))`), same as TanStack's `buildCursor`. This is ~30-50 lines of SQL generation.

**SQLite (JSON column):** Nearly identical to Postgres. The SQL dialect differences are minor (json_extract vs ->>) and already handled by the existing `sqliteWhereClauseBuilder` / `SqlitePropertyMapSchema` pattern. Same subquery strategy works. ~30-50 lines, largely shared with Postgres via `whereClauseEngine.ts` pattern.

**IndexedDB (raw):** IndexedDB has no SQL. Cursor must be done in JS after retrieving results. Same as JS runtime — sort in memory, find PK, slice.
```ts
// Open cursor on index (for sort), collect results, then applyAfterPk
const results = await getAllFromIndex(store, sortIndex, direction);
const afterIdx = results.findIndex(r => r[pk] === afterPk);
return results.slice(afterIdx + 1, afterIdx + 1 + limit);
```

**Dexie.js:** Wrapper around IndexedDB. Same approach — Dexie doesn't have native cursor-after-PK either. Use `.toArray()` then JS-level slicing.
```ts
const all = await table.orderBy(sortField).toArray();
const idx = all.findIndex(item => item[pk] === afterPk);
return all.slice(idx + 1, idx + 1 + limit);
```

### Maintenance burden assessment

| Backend | Implementation effort | Ongoing maintenance | Notes |
|---|---|---|---|
| JS runtime | Trivial (~5 lines) | Near zero | Just array operations |
| Postgres | Moderate (~40 lines) | Low | Subquery pattern is standard SQL. Tuple comparison for multi-sort is the only complexity. Shares engine with SQLite. |
| SQLite | Moderate (~40 lines) | Low | Nearly identical to Postgres via shared `whereClauseEngine`. Dialect differences already abstracted. |
| IndexedDB | Trivial | Near zero | Falls back to JS runtime after index retrieval |
| Dexie | Trivial | Near zero | Falls back to JS runtime after `.toArray()` |

**Key observations:**
1. **4 of 5 backends are trivial** — they all resolve to "sort, find PK, slice" in JS.
2. **SQL is the only real complexity**, and it's a one-time ~40-line function per dialect. The subquery pattern is standard and testable. Multi-column sort tuple comparison is the same pattern TanStack uses internally.
3. **Shared engine reduces duplication.** The existing `whereClauseEngine.ts` pattern (dialect-specific `IPropertyMap` + shared recursive builder) can be extended for ORDER BY + cursor clauses. Postgres and SQLite would share the tuple-comparison logic.
4. **Testing surface is small.** Core cases: single sort field, multi-sort, cursor item not found, cursor at end of results. ~8-10 test cases total, reusable across backends via a `standardTests` pattern (like existing `where-filter/standardTests.ts`).

### Other maintenance costs

- **DDL interaction:** `$after_pk` requires knowing the primary key field. Already available via DDL's `primary_key`. No new DDL changes needed.
- **Sort field validation:** `$after_pk` requires a deterministic sort. Runtime check: "if `$after_pk` is set but no `$sort` and no DDL `default_order_by`, return error." One check, shared across all backends.
- **Cursor item deleted:** Need a consistent error type (`cursor_item_not_found`) across all backends. Small addition to the error system.
- **No performance concern for the PK lookup:** It's a single indexed read. The subquery in SQL is optimized by the query planner.

### Verdict

The maintenance cost is **low**. SQL is the only non-trivial part, and it's a bounded, testable function that leverages existing patterns. The majority of backends (JS, IndexedDB, Dexie) are trivial. The shared engine pattern keeps duplication minimal.

# Rules for ICollection

- `get()` accepts `WhereFilterDefinition` + query options (`$sort`, `$limit`, and one of `$offset` | `$after_pk`)
- `$sort` is optional — falls back to DDL's `default_order_by`
- `$limit` is optional
- `$offset` and `$after_pk` are mutually exclusive (type-level union)
- `$after_pk` requires a deterministic sort (explicit `$sort` or DDL `default_order_by`) — runtime validated
- **Opaque page tokens are NOT part of query types** — they're a custom parameter on `ICollection.get()`, separate from the query definition
- Implementations return **error-as-value** for unsupported features (e.g. a Gmail adaptor receiving `$sort`). A specific error type (e.g. `unsupported_query_feature`) must be supported in the error system.
- Peek-ahead-by-1 for `hasNextPage` detection: request `$limit + 1` items, strip the extra before returning


# Plan


_Important: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

## [x] Phase: Find good examples of query/order|sort/limit/offset in prominent open source data systems

I'd suggest Tanstack DB, RxDB, Triplit, but find more like them. Ideally in Typescript, ideally running as object stores locally, typically used for cache layers. 
Before committing the answer, talk to me what you've chosen so I can vet them / expand them. 

Output to `Other systems to evaluate`

Update the next phase, `Phase: Extract examples of each system doing query/order|sort/limit/offset`, by creating sub steps (`### [ ] Step: X`) for each system, with a general instruction to run the steps in parallel, with instructions to: 
- Download the open source package
- Use the code and the online reference material to extract one or more examples of how they do each of order|sort/limit/offset. 
    - Pay special attention to how that combines for pagination.
    - If they support cursor based pagination, make that an explicit example too. It may need a bit more digging, e.g. TanStack DB supports cursor, but says it's left to the backend... but we still need to know how it's expressed in the front end. 
- Add instruction to add examples to `Examples of Other System order|sort/limit/offset`, for that system (as a subsection). 

Remember, the goal here is to provide reference material for our future phases to know how other systems work so we can stay aligned. It's just more context for Claude in later phases. 


## [x] Phase: Extract examples of each system doing query/order|sort/limit/offset
_Run all 5 steps in parallel using subagents. Each step downloads/reads the source and extracts concrete examples of sort, limit, offset, and pagination (especially cursor-based). Results go into subsections under `Examples of Other System order|sort/limit/offset`._

**Output:** [reference-other-systems.md](./reference-other-systems.md) — full code examples, TypeScript types, and cross-system comparison table for all 5 systems.

### [x] Step: TanStack DB
- Clone/download `https://github.com/TanStack/db`
- Read the query collection source and docs (`packages/db/src/`)
- Extract examples of: `orderBy`, `limit`, `offset`, cursor pagination (`loadSubsetOptions`, `cursor.whereFrom`, `cursor.whereCurrent`)
- Pay special attention to how cursor pagination is expressed in the front-end API vs delegated to the backend/sync layer
- Add findings as a `### TanStack DB` subsection under `Examples of Other System order|sort/limit/offset`

### [x] Step: RxDB
- Clone/download `https://github.com/pubkey/rxdb`
- Read query-related source (`src/rx-query*`, `src/plugins/query-builder/`)
- Extract examples of: `.sort()`, `.limit()`, `.skip()`, Mango query syntax for sorting/pagination
- Check if cursor-based pagination exists or if it's purely skip/limit
- Note how primaryKey is appended to indexes for deterministic ordering
- Add findings as a `### RxDB` subsection under `Examples of Other System order|sort/limit/offset`

### [x] Step: Triplit
- Clone/download `https://github.com/aspen-cloud/triplit`
- Read query builder source (`packages/client/src/` or `packages/db/src/`)
- Extract examples of: `.order()`, `.limit()`, `.after()` cursor pagination
- Pay special attention to how `.after()` works — what value it takes, how it interacts with sort order
- Add findings as a `### Triplit` subsection under `Examples of Other System order|sort/limit/offset`

### [x] Step: Dexie.js
- Clone/download `https://github.com/dexie/Dexie.js`
- Read collection/query source and docs
- Extract examples of: `orderBy()`, `limit()`, `offset()`, and the recommended cursor-based pagination pattern
- Document the performance tradeoff they describe (offset is O(N))
- Add findings as a `### Dexie.js` subsection under `Examples of Other System order|sort/limit/offset`

### [x] Step: Drizzle ORM
- Read the offset and cursor pagination guide source/docs from `https://orm.drizzle.team/docs/guides/limit-offset-pagination` and `https://orm.drizzle.team/docs/guides/cursor-based-pagination`
- Extract examples of: `orderBy()`, `limit()`, `offset()`, and cursor-based pagination SQL patterns
- Document how they generate SQL for both approaches
- Add findings as a `### Drizzle ORM` subsection under `Examples of Other System order|sort/limit/offset`


## [x] Phase UpdateRefs: Update the reference material

_Can run in parallel_

### [x] Step: Find the function to combine multiple WHERE clauses, each using numbered placeholders for security, and normalise them

I'm certain I've written this function. It's either in this library, or it's in @~/git/breef/utils/src/main/convert-placeholder-to-template-strings-array.

If found use it; otherwise write a simple example of how it will work. 

Output to a new section in `Reference Material`

### [x] Step: Bring back old research about cursor pagination

Look at @~/git/breef/store/src-v2-rewrite/*.md to look for 'cursor', then understand what was previously said about cursor pagination. Don't opine on it, just summarise the key points of the research (with links to more info in those files). 

Output to a new section in `Reference Material`

## [x] Phase CleanUp: clean up next phase

I want you to clarify what I've said in `Phase: Decide about cursor pagination`, sort any ambiguities, and rewrite that phase for clarity. 

You may choose to break it into sub steps (`### [ ] Step: X`) so an LLM can build context and have vital gates for me to check it. 

**Important:** What I'm looking for is a framework to make an informed decision about supporting cursor pagination. Currently my thinking is muddy. 

## [x] Phase: Decide about supporting cursor pagination

**Context:** Offset is already decided (supported). This phase determines whether to *also* support cursor-based pagination, where the caller says "give me items after the item with primary key X" rather than "give me items starting at position N".

### [x] Step 1: Clarify what "cursor" means in our system

**Resolved.** See "Cursor Pagination Decision Making" sections above:
- Cursor = `$after_pk: <primary_key_value>` — exclusive, PK-based
- Opaque page tokens (Gmail, Stripe) are NOT part of query types — they're a custom `ICollection.get()` parameter
- Thin API adaptors return error-as-value for unsupported query features

### [x] Step 2: Evaluate practical need for `$after_pk`

**Resolved.** API interop (Gmail, Stripe) does NOT motivate `$after_pk` — opaque tokens are handled separately on `ICollection.get()`.

`$after_pk` is justified as a **local query convenience** by two dominant use cases:
1. **Resumable position across sessions** — app stores "user was viewing item X", passes PK directly. Offset would require re-finding X's current position after inserts/deletes.
2. **"Show items after X"** — user clicks an item, wants what follows in sorted order. One call with `$after_pk` vs. extra query to determine offset.

**Decision:** Include `$after_pk` in the type union. JS implementation is trivial. **Final decision on supporting `$after_pk` depends on the maintenance cost (not implementation cost) of SQL support** — assessed in Step 4.

See "Practical need for `$after_pk`" under `Cursor Pagination Decision Making`.

### [x] Step 3: Survey cursor support in reference systems

**Pre-filled summary** (verify against reference-other-systems.md):
- **TanStack DB:** No front-end cursor API. Internal subscription layer builds cursors. Backend receives both `cursor` and `offset`.
- **Triplit:** `.after(values)` — value-based cursor, one value per sort field.
- **RxDB:** No cursor. `skip`/`limit` only.
- **Dexie.js:** No cursor API. Recommends manual `where.aboveOrEqual(lastValue)`.
- **Drizzle ORM:** No cursor primitive. Documents manual `WHERE id > ?` pattern.

**Task:** Confirm this summary is accurate, draw a conclusion about whether cursor is a common expectation or a nice-to-have, and output under `Cursor Pagination Decision Making`.

**TanStack interop note:** TanStack's cursor is **value-based** (`WHERE col > val` expressions), not PK-based. If TanStack sends us a `cursor` via `LoadSubsetOptions`, the adaptor must translate TanStack's expression tree into WHERE clauses — that's composable with `WhereFilterDefinition`, not with `$after_pk`. Our `$after_pk` does not help with TanStack cursor interop. TanStack offset (`offset`) maps directly to `$offset`.

**UUID sortability:** TanStack handles UUID PKs in tie-breaking via string comparison (`id > lastId`). UUIDs are sortable as strings — the order isn't *meaningful* (not time-ordered like ULIDs), but it's **deterministic**, which is all cursor tie-breaking needs. `WHERE uuid_col > 'some-uuid'` is valid SQL. The "non-sortable UUID" concern is overstated — UUIDs are sortable, just not in a useful order. Value-based cursors (like TanStack/Triplit) avoid the PK-lookup problem entirely because they pass sort-key values directly — no lookup needed. Our `$after_pk` requires an extra indexed PK lookup to resolve sort-key values, but that's O(1).

### [x] Step 3b: Justify `$after_pk`

**Context:** We've ruled out the original motivations for `$after_pk`:
- Gmail/Stripe API interop → handled by opaque tokens on `ICollection.get()`, not query types
- TanStack interop → TanStack uses value-based cursors, which map to `WhereFilterDefinition`, not `$after_pk`

So far the only justification is **local query ergonomics**: resumable position across sessions and "show items after X" (see Step 2). These are real but modest.

**Task:** Look for stronger cases where `$after_pk` provides value that offset and value-based cursors (via `WhereFilterDefinition`) cannot. Consider scenarios like:
- Collaborative/multiplayer: does `$after_pk` help when multiple users are viewing/modifying the same list?
- Reactive/live queries: does anchoring to a PK help when the underlying data is changing?
- Developer ergonomics at scale: is "pass the PK" significantly less error-prone than "track your offset" or "pass sort-key values"?
- Any case where the caller naturally has a PK but not the offset or sort-key values?

If no stronger case exists, that's a valid finding — it means `$after_pk` lives or dies on the Step 2 ergonomics + Step 4 maintenance cost calculation.

Discuss with me, then output under `Cursor Pagination Decision Making`.

### [x] Step 4: Assess implementation complexity of `$after_pk`

**JS runtime:** Straightforward. Pipeline: filter → sort → scan for PK → take `$limit` items after it.

**SQL:** Harder. Non-sortable UUIDs can't use `WHERE id > ?`. Three strategies identified:
1. **Subquery/CTE:** `WHERE (sort_cols) > (SELECT sort_cols FROM t WHERE pk = ?)`
2. **ROW_NUMBER window:** Clean but potentially slow on large tables
3. **Two-query:** Look up sort-key values first, then range filter. Simple SQL, two round-trips.

Task
* Assess implementation challenge for this... mock a Pg function to generate a Where Clause and Limit clause (excluding the 'WHERE' and 'LIMIT' directives) to see how hard it would be to make something like postgresWhereClauseBuilder for a potential ordering type 
* Assess the maintenance burden of supporting it. We'd have to support the after_pk for every system we build. Lightly show examples in TS of how we'd do it for IndexedDb, Dexie, an in-memory list (JS Runtime above), Sqlite. 
* Are there any other maintenance costs I've overlooked?

Output these to a new section under `Cursor Pagination Decision Making` with `Examples of implementation + maintenance discussion`


### [x] Step 5: Make the decision

Weigh:
- **Practical need:** Is `$after_pk` solving a real local-query problem, or is offset sufficient?
- **TanStack alignment:** TanStack's backend receives both cursor and offset — does supporting `$after_pk` help as a TanStack backend provider?
- **Complexity cost:** Summarise `Examples of implementation + maintenance discussion`

Hint: I'm leaning towards accepting it. 

Output: Decision (yes/no/deferred) with rationale, added to this document as final decision for `Cursor Pagination Decision Making`. 

## [x] Phase ArchitectOptions: Architect a flexible solution for SQL implementations. 

For reference, in where-filter (which this will always be used alongside in a query: filter + order + limit), there are 2 main types of executers: 
1. matchJavascriptObject: JS runtime filtering of array
2. Generate SQL `WHERE` clause. Returns numbered placeholders for values for safety. Converts WhereFilterDefinition to SQL. 

One of the benefits of this system is it doesn't dictate how it's used: the WHERE can be put into any query. 

In an ideal world, our solution for order+limit would be no conflicting: 
- For JS runtime, a composable function that accepts an already filtered list and sorts/limits it 
- Non-conflicting SQL clauses of just `ORDER BY` and `LIMIT`. 

But I think it's inevitable that to support `after_pk` will require it to also generate a `WHERE` clause.

I want the same composable/building-block mentality as where-filter: 
- a JS runtime ordering that can be composed in a pre/post-filter pipeline
- something that outputs the WHERE (and its numbered placeholders), ORDER BY, and LIMIT (+ any other clauses) as standalone pieces

But SQL will need additional helpers, to combine WHERE for the filtering clause and the after_pk clause. 
I'm not sure how to structure that. 
- It could be literally a low-level 'combine where clause' (which we already have in `rebaseSqlParameters`)
- It could invert that and be a `queryGenerator` function that accepts other parts of the query (e.g. other WHERE/ORDER BY/LIMIT) and constrains them to the WhereFilterDefinition and Ordering.

Some considerations: 
- What is your opinion of best practice? 
- Generate examples to get a feel for it (me included)
- What would work best with Drizzle which uses the `sql` builder? 


For reference, this is something similar (but NOT the same thing) I did with drizzle: 
```ts
export function getUserFilterAsPostgresSql<T extends Record<string, any> = Record<string, any>>(userFilter: WhereFilterDefinition<T> | undefined, propertySqlMap: IPropertyMap<T>, otherClauses?: PreparedWhereClauseStatement, rebase?: number, testing?: boolean): PreparedWhereClauseStatement {

    if( !userFilter && !testing ) throw new Error(`Cannot getUserFilterAsPostgresSql: ${PERMISSIONS_REQUIRED}`);


    let whereClauseStatement:string = '';
    let statementArguments:any[] = [];

    if( userFilter ) {
        const userClauses = WhereFilter.postgresWhereClauseBuilder(userFilter, propertySqlMap);
        whereClauseStatement = userClauses.whereClauseStatement;
        statementArguments = userClauses.statementArguments;
    }


    if (otherClauses && otherClauses.whereClauseStatement) {
        const appendable = PostgresHelpers.appendSqlParameters(statementArguments, { sql: otherClauses.whereClauseStatement, parameters: otherClauses.statementArguments });
        whereClauseStatement = whereClauseStatement? `(${whereClauseStatement}) AND (${appendable.sql})` : appendable.sql;
        statementArguments = [...statementArguments, ...appendable.parameters];
    }
    if (typeof rebase === 'number') {
        whereClauseStatement = PostgresHelpers.rebaseSqlParameters(whereClauseStatement, rebase);
    }
    return {whereClauseStatement, statementArguments};
}
```
I'm really not advocating this as a solution.

Output different approaches to the architecture, with examples and pros and cons, to a new top level section `Architectural Options`

**Output:** [architectural-options.md](./architectural-options.md) -- four approaches (A: Primitives Only, B: Bundle, C: Full Query, D: Hybrid) with code examples, Drizzle usage, comparison table. **Recommendation: Option D (Hybrid)** -- exposes both primitive clause builders and a convenience bundle function.


## [ ] Phase: Decide conceptual structure / naming of types

This directory/plan is currently called 'Query' (encapsulating that it retrieves and orders a collection).

But there are constraints... 
- The collection interface (ICollection) will have a `get` function, something like: `get(filter: WhereFilterDefinition, order:, limit: )`. We should consider that order & limit may be more convenient to bundle into one super type. 
- We will want this to be composable. The 'where-filter' outputs functions to filter a list in JS, or a `WHERE` clause for SQL. It doesn't define how that's used (e.g. it will be used by a high level collection doing something like `get` , but may also be used in a write by reading relevant objects to update first, etc.). We want that same flexibility. So we're not quite making a dominant query system, we're making up parts of the query -> the means to sort a list (function in JS; 'ORDER BY' clause in SQL); to limit (function in JS, 'LIMIT' in SQL), and maybe an offset/cursor (which would be part of WHERE in SQL). 

**That composability is the key determinant for a decision, especially in SQL:**
- The WhereFilterDefinition outputs the 'WHERE' part of the clause
- The pagination parts of the query might need to control WHERE too, outputting more WHERE clauses

This may have to be an open discussion in chat. Talk to me about it, after trying to make the best suggestion you can. 

Ultimately you'd output to a new section in the document.





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
