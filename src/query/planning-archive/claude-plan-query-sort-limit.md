# Query: Sort, Cursor Pagination & Limit

## Intro

We have `WhereFilterDefinition` — a Mongo-style predicate that tests whether a single JS object matches a filter (like a WHERE clause). It works across JS runtime (`matchJavascriptObject`), Postgres (`postgresWhereClauseBuilder`), and SQLite (`sqliteWhereClauseBuilder`).

We now need **ordering + cursor pagination + limits** on top of it. The goals:
- Stick to Mongo-like terminology so an LLM can guess usage.
- Keep it as a **separate, composable concept** — filtering is a predicate on one object; ordering/pagination operate on collections.
- Support cursor pagination with **non-sortable UUIDs** as IDs.
- Work across JS runtime and SQL backends with a unified `QueryDefinition` type, even though the execution strategy differs per backend.

Key design tension: should filter + sort + cursor be one combined operation, or a composable pipeline? This doc proposes separation and includes TODOs to benchmark the decision.

## Type Shape

### SortDefinition

```ts
type SortDirection = 1 | -1;

/** Ordered list of sort keys. Mongo style. */
type SortDefinition<T extends Record<string, any>> = Array<{
  key: DotPropPaths<T>;
  direction: SortDirection;
}>;
```

**Examples — ours vs Mongo:**

```ts
// Ours: sort by created_at descending, then name ascending
const sort: SortDefinition<User> = [
  { key: 'created_at', direction: -1 },
  { key: 'name', direction: 1 }
];

// Mongo equivalent:
db.users.find().sort({ created_at: -1, name: 1 });
```

```ts
// Ours: sort by nested field
const sort: SortDefinition<User> = [
  { key: 'address.city', direction: 1 }
];

// Mongo equivalent:
db.users.find().sort({ 'address.city': 1 });
```

**Divergence from Mongo — Record key ordering problem:**

Mongo uses a plain object `{ field: 1, field2: -1 }` for sort. JS `Record` key order is insertion-order in practice but **not spec-guaranteed for integer-like keys** (e.g. `{ 2: 1, 1: -1 }` reorders to `{ 1: -1, 2: 1 }`). Since our dot-prop paths can include numeric array indices, a Record-based sort could silently reorder sort priority.

**Solution:** Use an **array of `{ key, direction }` tuples** instead of a Record. This guarantees ordering, is unambiguous, and still reads naturally. It diverges from Mongo's syntax but is safer. Mongo drivers internally treat sort as ordered — we're just making that explicit in the type.

**Other Mongo divergences to watch:**

- Mongo allows sort on fields not in the query/projection. We should too — `SortDefinition` keys are independent of `$filter` keys.
- Mongo's `$natural` sort (insertion order) — not applicable to us. No need to support.
- Mongo allows `{ $meta: "textScore" }` as a sort value — not applicable. Our `SortDirection` is strictly `1 | -1`.

### CursorDefinition

```ts
/**
 * Cursor pagination for non-sortable IDs.
 * $after: the primary key value of the last item seen (start after this item in the sorted results).
 * $limit: max items to return.
 */
type CursorDefinition = {
  $after?: string;   // primary key value to seek past (omit for first page)
  $limit: number;
};
```

### QueryDefinition

```ts
/**
 * Full query: filter + sort + paginate. All fields optional except
 * cursor.$limit when paginating.
 */
type QueryDefinition<T extends Record<string, any>> = {
  $filter?: WhereFilterDefinition<T>;
  $sort?: SortDefinition<T>;
  $cursor?: CursorDefinition;
};
```

### Cursor mechanic

Pipeline: filter -> sort -> scan for `$after` primary key -> take `$limit` items after it.

- First page: omit `$after`, get first `$limit` items.
- Next page: set `$after` to last item's primary key from previous page.
- If `$after` ID not found in results, return empty (safe default — stale cursor).

This is intentionally simple. No `$before` / backward pagination initially.

### How the executor knows the primary key

The executor already knows which field is the ID via `primary_key` in the DDL type (`ListRulesCore` in `write-actions/writeToItemsArray/types.ts`). The `CursorDefinition` does not need to specify the ID field — the executor resolves `$after` against the DDL's `primary_key`.

Note: the DDL currently has `order_by: ListOrdering<T>` which specifies a default sort. This will likely become `default_order_by` and use `SortDefinition` (or a compatible shape) from this new `query/` module. When a `QueryDefinition` omits `$sort`, the executor falls back to the DDL's `default_order_by`.

## Architecture: Separate Sibling Module

```
src/
  where-filter/              # existing - predicate/filtering only (unchanged)
  query/                     # new sibling
    types.ts                 # SortDefinition, CursorDefinition, QueryDefinition
    sortJavascriptObjects.ts # sort an array by SortDefinition
    queryJavascriptObjects.ts # full pipeline: filter -> sort -> cursor -> limit
    index.ts                 # public API
```

`query/` imports from `where-filter/`. `where-filter/` never imports from `query/`.

### JS runtime

```ts
function queryJavascriptObjects<T>(
  objects: T[],
  query: QueryDefinition<T>,
  primaryKey: keyof T
): T[] {
  let result = objects;

  // 1. Filter
  if (query.$filter) {
    result = filterJavascriptObjects(result, query.$filter);
  }

  // 2. Sort
  if (query.$sort) {
    result = sortJavascriptObjects(result, query.$sort);
  }

  // 3. Cursor + Limit
  if (query.$cursor) {
    const { $after, $limit } = query.$cursor;
    if ($after) {
      const idx = result.findIndex(item => item[primaryKey] === $after);
      result = idx === -1 ? [] : result.slice(idx + 1);
    }
    result = result.slice(0, $limit);
  }

  return result;
}
```

### SQL (Postgres / SQLite)

Sort and cursor map to different SQL fragments:

- `$filter` -> `WHERE ...` (existing builders)
- `$sort` -> `ORDER BY ...` (new builder, uses same property map)
- `$cursor.$limit` -> `LIMIT ?`

**The cursor problem in SQL:**

`$cursor.$after` with non-sortable UUIDs cannot use a simple `WHERE id > ?`. The SQL backend must find the row with the given primary key in the sorted result set and return rows after it. Strategies:

1. **Subquery / CTE approach**: `WHERE (sort_cols) > (SELECT sort_cols FROM t WHERE pk = ?)` — works for single sort key, gets complex with multi-key sorts (tuple comparison).
2. **ROW_NUMBER window function**: `WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY ...) AS rn FROM t WHERE ...) SELECT * FROM ranked WHERE rn > (SELECT rn FROM ranked WHERE pk = ?)` — clean but may be slow on large tables.
3. **Caller resolves cursor**: The executor looks up the `$after` row's sort-key values first, then uses them as a range filter. Two queries but simple SQL.

**Composability concern:** We currently have a WHERE clause builder and would ideally add just an ORDER BY clause builder. But cursor pagination likely needs to inject conditions into the WHERE clause too (strategy 1 or 3 above), meaning we need to **combine** the filter WHERE and cursor WHERE. Options:
- The query SQL builder wraps the existing where-clause builder, appending cursor conditions to its output.
- Or the query builder produces the full SQL string (SELECT ... WHERE ... ORDER BY ... LIMIT), owning composition.

The key question: **how do we keep the `QueryDefinition` concept in sync between JS and SQL backends?** The JS runtime uses a simple pipeline. SQL must translate the same `QueryDefinition` into a single query. The type is the contract — each backend implements it differently, but the caller shouldn't need to know which backend runs it.

## Performance: Combined vs. Separate JS Filter+Sort

Filter-then-sort is theoretically fine:
- Filter is O(n). Sort is O(m log m) where m <= n (filtered subset).
- Sorting fewer items after filtering is better than interleaving.
- Cache-friendly: two sequential passes over shrinking data.

The cursor scan (findIndex) is O(m) on the sorted array — negligible.

One potential optimisation: if `$cursor.$limit` is set but `$cursor.$after` is absent (first page), a partial sort (selection of top-K) beats a full sort. But Array.sort is native C++ in V8, so the threshold where a JS partial-sort wins may be high.

### TODO: JS Performance benchmark

Generate a TypeScript performance test (Vitest bench or standalone script) that measures:

1. **Separate pipeline** (filter -> sort -> cursor-scan -> slice) vs. **combined single-pass** (filter+insert-into-sorted-buffer with early termination at limit) across:
   - Small arrays (100 items)
   - Medium arrays (10,000 items)
   - Large arrays (1,000,000 items)
   - Varying filter selectivity (10%, 50%, 90% pass)
   - Varying limit sizes (10, 100, 1000)
2. Measure wall-clock time (performance.now) with warmup runs.
3. Report whether combined approach has meaningful gains at any scale.

This will validate the "keep separate" decision with real numbers before committing to the architecture.

### TODO: SQL Cursor Strategy benchmark

Generate a TypeScript performance test using **PgLite** (already used in the lib) that:

1. Creates a table with a UUID primary key and several sortable columns (timestamp, string, numeric).
2. Populates it heavily (100k+ rows).
3. Benchmarks the three cursor strategies against the same `QueryDefinition`:
   - **Tuple comparison subquery**: `WHERE (sort_cols) > (SELECT sort_cols ...)`
   - **ROW_NUMBER CTE**: window function approach
   - **Two-query resolve**: look up cursor row's sort values first, then range filter
4. Tests with varying:
   - Number of sort keys (1, 2, 3)
   - Cursor position (near start, middle, near end of result set)
   - Filter selectivity (narrow vs broad WHERE clause)
5. Measures query time and reports which strategy wins at each scale.

The benchmark should also consider **composability of the generated SQL**. Each strategy should note:
- How much of the SQL it generates (total clause size).
- Whether the cursor conditions can be cleanly appended to an existing WHERE clause from the where-clause builder, or whether they require wrapping / restructuring.
- Whether the approach works identically for Postgres and SQLite, or needs dialect-specific handling.

The goal is to answer: can we keep a simple `ORDER BY` builder alongside the existing `WHERE` builder, or does cursor pagination force us into a combined query builder? And does the answer differ between JS and SQL?

## Open Questions

- [ ] Should `SortDefinition` support dot-prop paths through arrays (spreading)? Mongo does not — it picks the min/max element value. We may want to match that behaviour or disallow it.
- [ ] Return type for paginated results — just `T[]` or a wrapper with `hasMore` / `nextCursor`?
- [ ] How does `default_order_by` in the DDL interact with `$sort`? Proposal: `$sort` overrides entirely when present; `default_order_by` is only used when `$sort` is omitted.
