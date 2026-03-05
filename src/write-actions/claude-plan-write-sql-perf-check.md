# Goal

Assess exactly how much a performance gain it would be to transform a WriteAction into a pure SQL statement vs doing Read Modify Write (RMW).

# Relevant Files

@./types.ts
@./applyWritesToItems/types.ts
@./applyWritesToItems/applyWritesToItems.ts
@../where-filter/types.ts
@../where-filter/postgresWhereClauseBuilder.ts


# Context


A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts). It's based on MongoDb.

A `WriteAction` is a definition to create/update/delete/upsert a javascript object.

In @../where-filter/postgresWhereClauseBuilder.ts you'll see it can convert a `WhereFilterDefinition` to a WHERE SQL query.

In theory it's a short-step to converting a `WriteAction` to an `UPDATE`/`INSERT`/`DELETE` SQL statement, using the generated `WHERE` query - it just has to figure out `SET`. 

But, there are relatively few places where it can be purely transformed - there's a lot of complexity buried in WriteActions / WriteStrategy and writeToItemsArray. So the app would often by falling back to RMW even if this optimisation was possible. 

So the question becomes... is it worth the considerably extra complexity of dual paths? To judge this we'll use Pglite to do both paths at high velocity. 

# How Write Actions Currently Work

## WriteAction Envelope

A `WriteAction<T>` wraps a mutation intent:
```
{ type: 'write', ts: number, uuid: string, payload: WriteActionPayload<T> }
```

## CRUD Payload Types
_These are just the core ones_

### `create`
- `{ type: 'create', data: T }`
- Provides the full object. PK must be present and unique among existing items.
- Duplicate-create recovery strategies: `'never'` (fail), `'if-identical'` (skip if equivalent), `'always-update'` (convert to update).

### `update`
- `{ type: 'update', data: Partial<T>, where: WhereFilterDefinition<T>, method?: 'merge' | 'assign' }`
- `data` is partial and **excludes object-array properties** (those must use `array_scope`). Setting a key to `undefined` deletes it.
- `where` selects which existing items to update (matched via `matchJavascriptObject`).
- `method`: `'merge'` (default, deep merge via lodash `mergeWith`, but arrays are wholesale replaced) or `'assign'` (shallow `Object.assign`).
- PK cannot be changed by an update.

### `delete`
- `{ type: 'delete', where: WhereFilterDefinition<T> }`
- Removes every item matching `where`.


## DDL (Data Definition Layer)

`DDL<T>` describes the shape and rules of an object store:

```ts
{
  version: number,
  permissions: DDLPermissions<T>,
  lists: {
    '.': ListRules<T>,                // root-level list rules
    [scope: string]: ListRules<...>,  // one entry per nested object-array path
  }
}
```

### ListRules per scope
- `primary_key`: which field uniquely identifies items (used for dedup, referencing, hashing).
- `order_by`: `{ key, direction? }` — sort guidance for store implementations.
- `write_strategy`: `'lww'` (last-writer-wins, default) or `{ type: 'custom', strategy }`.
- `growset`: optional `{ delete_key }` — tombstone-based deletion (not yet implemented).
- `pre_triggers`: hooks to run before committing (not yet implemented).



## applyWritesToItems — Execution Flow

1. **Input**: `WriteAction[]`, existing `items: T[]`, Zod schema, DDL, optional `IUser`, options (`atomic`, `mutate`, `attempt_recover_duplicate_create`).
2. Actions are processed **sequentially** (order matters).
3. For each action:
   - **create**: check PK uniqueness → check permissions → run write strategy's `create_handler` → validate schema → push to items.
   - **update/delete/array_scope**: iterate all items, `matchJavascriptObject(item, where)` → check permissions → apply mutation → validate schema → commit change.
4. **Failure handling**: on first failure, all subsequent actions are marked `blocked_by_action_uuid`. If `atomic`, all changes roll back (via `MutatedItemsRollback` or Immer clone strategy).
5. **Output**: `ApplyWritesToItemsResponse<T>` — either `{ status: 'ok', changes, successful_actions }` or `{ status: 'error', changes, successful_actions, failed_actions }`. The `changes` object contains `insert/update/remove_keys/final_items/changed`.

## Key Observations for SQL Transpilation

| Aspect | JS Behaviour | SQL Difficulty |
|--------|-------------|----------------|
| **create** | Push new object | `INSERT INTO ... VALUES (jsonb)` — straightforward |
| **update (merge)** | Deep merge with lodash `mergeWith` (arrays wholesale replaced, undefined = delete key) | `jsonb_set` / `json_set` chains, one per key. Key deletion needs `jsonb - 'key'` (pg) or `json_remove` (sqlite). Nested merge is recursive. |
| **update (assign)** | Shallow `Object.assign` | Top-level `jsonb_set` / `json_set` per key. Simpler than merge. |
| **delete** | Splice from array | `DELETE FROM ... WHERE ...` — straightforward (where clause already solved) |
| **array_scope** | Recursive into nested array | **Hard**: requires locating a nested JSON array element by index/match, then applying CRUD within it. Postgres `jsonb_set` can target paths but needs index. SQLite `json_set` is more limited. |
| **Schema validation** | Zod `.parse()` post-mutation | Cannot replicate in SQL. Would need to validate after the fact or trust the input. |
| **Permissions** | `checkPermission()` reads owner field from item | Could be a WHERE sub-condition, but ownership transfer logic is JS-heavy. |
| **Atomic rollback** | Clone/rollback in JS | SQL transactions handle this natively — actually easier. |
| **Sequential ordering** | Actions applied in order, later ones see earlier results | Multiple statements in a single transaction — natural fit. |


## Return type of applyWritesToItems
_To be filled in_

## List of general important tests from applyWritesToItems.test.ts
_To be filled in_

# Decision: Is it possible, is it worth?

## Feasibility: is it possible

**create, delete**: Fully feasible. Map 1:1 to INSERT/DELETE with the existing WHERE clause builder.

**update (assign)**: Fully feasible. Flat `json_set`/`jsonb_set` per top-level key. Key deletion via `json_remove` (sqlite) / `#-` (pg).

**update (merge)**: Feasible but moderately complex. Must flatten `data` to dot-prop leaf paths and chain `jsonb_set`/`json_set` per leaf. The existing TreeNodeMap machinery can validate paths. Key deletion (undefined values) adds a parallel chain of `json_remove`/`#-`. Behaviour parity with lodash `mergeWith` (arrays replaced wholesale, nested objects merged key-by-key) is achievable because `jsonb_set` targets a specific path without affecting siblings.


**Features that CANNOT be replicated in SQL**:
- Zod schema validation (post-mutation). Must be done pre-flight in JS or skipped.
- Custom write strategies (JS callbacks). Only LWW is supportable.
- `attempt_recover_duplicate_create: 'if-identical'` (requires reading and comparing the full object with future writes applied). The `'always-update'` mode maps to UPSERT.
- Detailed error reporting (`WriteCommonError` with schema issues, affected items, blocked-by chains). SQL gives success/failure per statement, not per-item granularity.
- Pre-triggers (JS callbacks).

**WHERE filter compatibility**: The where-filter system already uses error-as-value (`PreparedWhereClauseResult`) to signal when a dialect can't handle an operator (e.g. `$regex` on SQLite). Write-action SQL generation reuses `buildWhereClause` for update/delete WHERE conditions, so unsupported operators are caught at SQL-generation time — not at execution time. The write-action system propagates these errors as `{ success: false, errors: [{ whereClauseErrors }] }`, giving callers a typed signal to fall back to the JS path. This is a strength: the existing where-filter capability-gap infrastructure means write-action SQL generation gets dialect awareness "for free".

**Verdict**: create/update/delete are feasible. Single-level array_scope is feasible but complex. Nested array_scope is at the boundary of practicality. Full behavioural parity with `applyWritesToItems` is **not possible** due to schema validation and custom strategies.

## Performance gain over 'query to read objects > update in JS context > write back to the DB'

Current flow: `SELECT matching rows > transfer to JS > applyWritesToItems > UPDATE each changed row back`
SQL flow: `Single UPDATE/INSERT/DELETE statement`

| Scenario | Estimated speedup | Why |
|----------|------------------|-----|
| create (1 row) | ~same | Both are 1 INSERT. No read needed either way. |
| delete (N rows) | **2-3x** | Eliminates the read round-trip entirely. Single DELETE vs SELECT+filter+DELETE-each. |
| update (1 row) | **~2x** | Eliminates read round-trip + data transfer. |
| update (100 rows) | **3-10x** | Single UPDATE vs read-100+process+write-100. The big win is eliminating per-row writes. |
| array_scope (1 level) | **1.5-2x** | Eliminates data transfer but the SQL array reconstruction adds DB-side work. |
| array_scope (nested) | **~1x or worse** | The SQL complexity may equal or exceed the overhead saved. |

**Where it matters most**: tables with many rows where the WHERE matches many of them. The current approach must transfer all matched rows to JS and write each one back. Pure SQL avoids all that data movement.

**Where it matters least**: single-row operations on small tables. The overhead is already low and the SQL approach adds query complexity.

**Realistic overall assessment**: For the common case (update/delete on a moderate number of rows), expect **2-5x improvement**. For create and single-row operations, minimal gain. For array_scope, marginal.

## Likely maintenance burdens

**High risk items:**
1. **Triple implementation sync**: JS (`applyWritesToItems`) + Postgres SQL + SQLite SQL must produce identical results. Any behavioural drift is a subtle, hard-to-detect bug. Every future WriteAction feature needs 3 implementations.
2. **array_scope SQL fragility**: The reconstructed-array SQL is complex, hard to read, and hard to debug. A change to array_scope semantics in JS requires rewriting nested subquery logic in both dialects.
3. **No schema validation in SQL**: The SQL path would allow invalid data to be written. Either pre-validate in JS (negating some performance gain), accept the risk, or read-back and validate post-write (complex, slow).
4. **Testing burden**: Must verify SQL output matches JS output for every combination of payload type x data shape x edge case. This is a large, ongoing test matrix.

**Medium risk items:**
5. **Merge semantics fidelity**: Lodash `mergeWith` has specific edge-case behaviour (prototype handling, circular refs, etc.) that is hard to replicate exactly in `jsonb_set` chains. Subtle mismatches are likely.
6. **Permission checking**: Simple ownership can be a WHERE sub-condition, but `transferring_to_path` logic would need separate handling.
7. **Dialect divergence**: Postgres JSONB and SQLite JSON have different capabilities and gotchas. Maintaining two parallel implementations that behave identically is ongoing work.

**Low risk items:**
8. WHERE clause is already solved -- high reuse, low maintenance. The error-as-value pattern (`PreparedWhereClauseResult`) means dialect capability gaps are handled gracefully — the write-action system inherits this for free without needing its own operator-support detection logic.
9. Path conversion utilities already exist -- reusable.


# Research for Testing
## PGlite Setup

**Already in project**: `@andyrmitchell/pg-testable` (devDependency) wraps PGlite. Existing usage in `src/where-filter/postgresWhereClauseBuilder.test.ts`:
```ts
import { DbMultipleTestsRunner } from "@andyrmitchell/pg-testable";
let runner: DbMultipleTestsRunner;
beforeAll(async () => { runner = new DbMultipleTestsRunner({ type: 'pglite' }); });
afterAll(async () => { await runner.dispose(); });
```

**Direct PGlite usage** (for perf test we want direct control):
```ts
import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create('memory://'); // fully in-memory, no disk
```

**Key APIs**: `db.exec(sql)` for DDL/multi-statement, `db.query(sql, params)` for parameterised, `db.transaction(async tx => {...})`.

**JSONB fully supported**: PGlite runs real Postgres (WASM). All JSONB operators (`->`, `->>`, `@>`, `?`, `#>`), `jsonb_set`, key removal via `#-` operator, etc. all work.

**Gotcha**: Always cast JSONB params with `$1::jsonb` or pass `JSON.stringify(obj)` to avoid `jsonb @> json` operator mismatch.

**Teardown**: `TRUNCATE table RESTART IDENTITY` between iterations (fast, doesn't scan rows). `db.close()` in `afterAll`.

**WASM startup**: ~200-500ms first time. Use `beforeAll`, not `beforeEach`.

## Fair Performance Testing

### Database Caching

PGlite is entirely in-memory — no disk I/O variance. But Postgres's **prepared statement cache** still applies: after ~5 executions of the same SQL text, planner switches from custom to generic plan.

**Mitigation**: Run 50 warmup iterations before measurement so both paths use their steady-state plan type throughout measurement.

### JS Runtime Warmup

V8/Bun JIT compiles functions through multiple tiers. Hot functions get optimised after ~1000 calls.

**Mitigation**: 50 warmup iterations (each internally doing multiple calls) is sufficient to hit optimising compiler tier for both paths.

### Measurement Strategy

**Use interleaved (alternating) execution**, alternating which path goes first each iteration, to neutralise time-dependent drift (GC pressure, thermal throttling):
```
for i in 0..N:
  if i%2==0: measure(A), reseed, measure(B)
  else:      measure(B), reseed, measure(A)
```

**Critical**: Re-seed to identical state before each path. Without this, Path B sees Path A's mutations.

**Iteration count**: 200 minimum for development benchmarks.

**GC handling**: Force `gc()` between iterations (run with `--expose-gc`). Use median (not mean) as primary metric — robust against GC spikes.

### Timer & Statistics

**Timer**: `performance.now()` is sufficient (microsecond resolution; operations take milliseconds through WASM boundary).

**Statistics**: Report median, p75, p95, trimmed mean (remove top/bottom 5%), stddev. **Median is the primary comparison metric.**

```ts
function analyzeResults(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * 0.05);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  const mean = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
  const variance = trimmed.reduce((s, v) => s + (v - mean) ** 2, 0) / trimmed.length;
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    mean: +mean.toFixed(3),
    stddev: +Math.sqrt(variance).toFixed(3),
    count: trimmed.length,
  };
}
```

### Key Insight for Our Case

The dominant cost in PGlite is likely the **WASM boundary crossing**, not SQL execution. Path B (RMW) has 1 SELECT + N writes = N+1 crossings. Path A (single SQL) has 1 crossing. Gap should widen with row count.

**Vary row counts**: Benchmark at 1, 10, 100, 500 affected rows.

**Path B variants**: Test both per-row writes (N round-trips) and batched writes (1 multi-row statement) to understand the full picture.

**Use realistic data shapes**: Match real Zod schemas (15+ fields, nested JSON), not toy 3-column tables.

# Implementation Plan

## File: `src/write-actions/writeActionSqlPerf.bench.ts`

Single benchmark file. Not a Vitest test — a standalone script run via `npx tsx src/write-actions/writeActionSqlPerf.bench.ts`.

---

## 1. Test Data Shape

Use a realistic object with nested properties (matches real-world usage):

```ts
const TestItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.enum(['active', 'inactive', 'pending']),
  score: z.number(),
  metadata: z.object({
    created_at: z.string(),
    updated_at: z.string(),
    tags: z.array(z.string()),
    settings: z.object({
      theme: z.string(),
      notifications: z.boolean(),
      language: z.string(),
    }),
  }),
});
type TestItem = z.infer<typeof TestItemSchema>;
```

DDL:
```ts
const ddl: DDL<TestItem> = {
  version: 1,
  permissions: {},
  lists: {
    '.': {
      primary_key: 'id',
      order_by: { key: 'name' },
    },
  },
};
```

## 2. Database Setup

Per benchmark scenario, create a fresh PGlite instance:
```ts
const db = await PGlite.create('memory://');
```

Table schema:
```sql
CREATE TABLE items (
  pk TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
CREATE INDEX idx_items_status ON items ((data->>'status'));
CREATE INDEX idx_items_score ON items ((data->>'score'));
```

`pk` mirrors the `id` field from the JSONB for fast PK lookups. The GIN index on the whole `data` column is intentionally omitted — in practice most queries use specific path indexes.

Seed function (deterministic, unique per row):
```ts
function generateItem(i: number): TestItem {
  return {
    id: `item-${i}`,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    status: (['active', 'inactive', 'pending'] as const)[i % 3],
    score: (i * 7) % 100,
    metadata: {
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-06-15T12:00:00Z',
      tags: [`tag-${i % 5}`, `tag-${(i * 3) % 8}`],
      settings: { theme: i % 2 === 0 ? 'dark' : 'light', notifications: i % 3 !== 0, language: 'en' },
    },
  };
}
```

Bulk insert via single multi-row `INSERT`:
```ts
async function seedData(db: PGlite, count: number) {
  const values = Array.from({ length: count }, (_, i) => {
    const item = generateItem(i);
    return `('${item.id}', '${JSON.stringify(item).replace(/'/g, "''")}'::jsonb)`;
  });
  await db.exec(`INSERT INTO items (pk, data) VALUES ${values.join(',')}`);
}
```

## 3. Benchmark Scenarios

Three scenarios, each tested at row counts **[10, 100, 500, 1000]**:

### Scenario A: CREATE (insert 1 new row)

**WriteAction**:
```ts
{ type: 'write', ts: Date.now(), uuid: crypto.randomUUID(),
  payload: { type: 'create', data: generateItem(rowCount + iterationIndex) } }
```
(Use `iterationIndex` to avoid PK collisions across iterations without truncating.)

**Path 1 — Direct SQL**:
```sql
INSERT INTO items (pk, data) VALUES ($1, $2::jsonb)
```

**Path 2 — RMW**:
1. `INSERT INTO items (pk, data) VALUES ($1, $2::jsonb)` — rely on DB UNIQUE constraint for PK uniqueness (no full table scan)
2. Handle constraint violation error as the duplicate-create signal

_Note: No `writeToItemsArray` needed for CREATE — both paths are essentially the same INSERT. This scenario mainly measures baseline overhead._

### Scenario B: UPDATE (update N rows matching a WHERE)

**WriteAction**:
```ts
{ type: 'write', ts: Date.now(), uuid: crypto.randomUUID(),
  payload: { type: 'update', method: 'merge',
    data: { score: 99, metadata: { updated_at: '2025-01-01T00:00:00Z' } },
    where: { status: 'active' } } }
```
This matches ~1/3 of rows (every `i % 3 === 0`).

**Path 1 — Direct SQL**:
Build WHERE clause using `postgresWhereClauseBuilder`. Then:
```sql
UPDATE items
SET data = jsonb_set(
  jsonb_set(data, '{score}', '99'::jsonb),
  '{metadata,updated_at}', '"2025-01-01T00:00:00Z"'::jsonb
)
WHERE <where_clause>
```
The `jsonb_set` chain is built by flattening `data` to dot-prop leaf paths. Each leaf becomes one `jsonb_set(prev, '{path,segments}', $N::jsonb)`.

**Path 2 — RMW**:
1. `SELECT pk, data FROM items WHERE <where_clause>` (SQL pre-filter, matches real system)
2. Parse rows into `TestItem[]`
3. Apply JS deep merge (simplified — no Zod validation, see §3a)
4. Batch write-back via single `UPDATE items SET data = v.data::jsonb FROM (VALUES ($1, $2), ...) AS v(pk, data) WHERE items.pk = v.pk`

### Scenario C: DELETE (delete N rows matching a WHERE)

**WriteAction**:
```ts
{ type: 'write', ts: Date.now(), uuid: crypto.randomUUID(),
  payload: { type: 'delete', where: { status: 'inactive' } } }
```

**Path 1 — Direct SQL**:
```sql
DELETE FROM items WHERE <where_clause>
```

**Path 2 — RMW**:
1. `SELECT pk FROM items WHERE <where_clause>`
2. Batch delete via single `DELETE FROM items WHERE pk = ANY($1)` (array of matched PKs)

## 3a. Fairness: Simplified JS Merge (No Zod)

Per Gemini critique: `writeToItemsArray` includes Zod validation which the SQL path doesn't do. To make an apples-to-apples comparison, the RMW path uses a **simplified JS merge function** instead of `writeToItemsArray`:

```ts
function applyMergeInJs(items: TestItem[], updateData: Partial<TestItem>): TestItem[] {
  // Deep merge matching lodash mergeWith semantics: objects merged key-by-key, arrays replaced wholesale
  return items.map(item => deepMerge(structuredClone(item), updateData));
}
```

This isolates what we're actually testing: **data transfer + JS mutation overhead** vs **single SQL statement**.

## 4. WHERE Clause Construction

Shared between both paths. Uses existing infrastructure:

```ts
import { PropertyMapSchema } from '../where-filter/postgresWhereClauseBuilder.ts';

const propertyMap = new PropertyMapSchema(TestItemSchema, 'data');
const clause = postgresWhereClauseBuilder(writeAction.payload.where, propertyMap);
if (!clause.success) throw new Error('WHERE clause build failed');
// clause.where_clause_statement, clause.statement_arguments
```

## 5. SQL Generation for Path 1 (Direct SQL)

### `buildInsertSql(item: TestItem)`
Returns `{ sql: 'INSERT INTO items (pk, data) VALUES ($1, $2::jsonb)', params: [item.id, JSON.stringify(item)] }`.

### `buildUpdateSql(payload: WritePayloadUpdate<TestItem>, whereClause: PreparedWhereClauseResult)`
1. Flatten `payload.data` to leaf paths using a recursive function (e.g. `{ score: 99, metadata: { updated_at: 'x' } }` → `[{path: '{score}', value: 99}, {path: '{metadata,updated_at}', value: '"x"'}]`).
2. Chain `jsonb_set` calls: start with `data`, wrap each leaf.
3. Combine with WHERE clause arguments (offset param indices).

Returns `{ sql: 'UPDATE items SET data = jsonb_set(jsonb_set(data, ...), ...) WHERE ...', params: [...] }`.

### `buildDeleteSql(whereClause: PreparedWhereClauseResult)`
Returns `{ sql: 'DELETE FROM items WHERE ...', params: [...] }`.

## 6. Benchmark Runner

```ts
const WARMUP = 200;
const ITERATIONS = 200;
const ROW_COUNTS = [10, 100, 500, 1000];
const SCENARIOS = ['create', 'update', 'delete'] as const;

for (const scenario of SCENARIOS) {
  for (const rowCount of ROW_COUNTS) {
    const db = await PGlite.create('memory://');
    await db.exec(TABLE_DDL);
    await seedData(db, rowCount); // Seed once — use SAVEPOINT/ROLLBACK to reset

    // Create a savepoint after seeding for instant reset
    await db.exec('BEGIN');
    await db.exec('SAVEPOINT bench_reset');

    // Warmup (200 iterations for V8 JIT to fully optimize both paths)
    for (let i = 0; i < WARMUP; i++) {
      await runDirectSql(db, scenario, rowCount, i);
      await db.exec('ROLLBACK TO SAVEPOINT bench_reset');
      await runRmw(db, scenario, rowCount, i);
      await db.exec('ROLLBACK TO SAVEPOINT bench_reset');
    }

    // Measure (interleaved)
    const results = { directSql: [] as number[], rmw: [] as number[] };
    for (let i = 0; i < ITERATIONS; i++) {
      if (typeof globalThis.gc === 'function') globalThis.gc();

      if (i % 2 === 0) {
        results.directSql.push(await measure(() => runDirectSql(db, scenario, rowCount, WARMUP + i)));
        await db.exec('ROLLBACK TO SAVEPOINT bench_reset');
        results.rmw.push(await measure(() => runRmw(db, scenario, rowCount, WARMUP + i)));
        await db.exec('ROLLBACK TO SAVEPOINT bench_reset');
      } else {
        results.rmw.push(await measure(() => runRmw(db, scenario, rowCount, WARMUP + i)));
        await db.exec('ROLLBACK TO SAVEPOINT bench_reset');
        results.directSql.push(await measure(() => runDirectSql(db, scenario, rowCount, WARMUP + i)));
        await db.exec('ROLLBACK TO SAVEPOINT bench_reset');
      }
    }

    await db.exec('ROLLBACK'); // Clean up the transaction

    const statsA = analyzeResults(results.directSql);
    const statsB = analyzeResults(results.rmw);
    const ratio = statsB.median / statsA.median;

    console.log(`\n=== ${scenario.toUpperCase()} | ${rowCount} rows ===`);
    console.log(`Direct SQL: median=${statsA.median.toFixed(3)}ms  p95=${statsA.p95.toFixed(3)}ms`);
    console.log(`RMW:        median=${statsB.median.toFixed(3)}ms  p95=${statsB.p95.toFixed(3)}ms`);
    console.log(`Ratio:      Direct SQL is ${ratio.toFixed(2)}x faster`);

    await db.close();
  }
}
```

## 7. Fairness Guarantees

| Concern | Mitigation |
|---------|-----------|
| Query plan caching | 200 warmup iterations push well past generic-plan threshold |
| JIT warmup | 200 warmup iterations ensure V8 fully optimizes both paths (including polymorphic lodash `mergeWith`) |
| Ordering bias | Interleave, alternating which goes first |
| Data state drift | `SAVEPOINT` + `ROLLBACK TO SAVEPOINT` for instant, zero-cost state reset (no GC pressure from re-seeding) |
| GC interference | Force `gc()` between iterations; use median |
| WASM startup | One `PGlite.create()` per scenario+rowCount; warmup absorbs it |
| Caching via identical queries | CREATE uses unique PKs per iteration; UPDATE/DELETE always hit real data (rolled back) |
| Zod validation asymmetry | RMW path uses simplified JS merge without Zod, matching the SQL path's lack of validation (§3a) |
| Per-row write overhead | RMW batches writes into single multi-row statements (`UPDATE ... FROM VALUES`, `DELETE ... WHERE pk = ANY(...)`) to avoid proving "1 query > N queries" |

## 8. Output Format

Console table summarising all results:

```
╔══════════╦══════════╦═══════════════════╦═══════════════════╦═══════╗
║ Scenario ║ Rows     ║ Direct SQL (med)  ║ RMW (med)         ║ Ratio ║
╠══════════╬══════════╬═══════════════════╬═══════════════════╬═══════╣
║ CREATE   ║ 10       ║ 0.123ms           ║ 0.456ms           ║ 3.71x ║
║ CREATE   ║ 100      ║ ...               ║ ...               ║ ...   ║
║ ...      ║ ...      ║ ...               ║ ...               ║ ...   ║
╚══════════╩══════════╩═══════════════════╩═══════════════════╩═══════╝
```

## 9. Correctness Validation (pre-benchmark)

Before timing, run one iteration of each scenario and assert that both paths produce the same final DB state:
```ts
// Run Path 1, SELECT * FROM items → set1, ROLLBACK TO SAVEPOINT
// Run Path 2, SELECT * FROM items → set2, ROLLBACK TO SAVEPOINT
// Assert set1 deep-equals set2 (ignoring order)
```

If they differ, the benchmark is invalid — the SQL generation doesn't match the JS merge semantics.

## 10. Dependencies

- `@electric-sql/pglite` — direct dependency (add as devDependency if not present)
- Existing: `writeToItemsArray`, `postgresWhereClauseBuilder`, `PropertyMapSchema` from this package
- No new production dependencies

# Implementation Plan Critique from Gemini




Here is a concise critique of your implementation plan, focusing on fairness, realism, and blind spots that could skew your decision. 

### 1. Flaws in Benchmark Fairness & Methodology

**A. Zod Validation Asymmetry**
*   **Issue:** The RMW path runs `Zod` validation and deep-merging via `writeToItemsArray`. The Direct SQL path implies just executing `INSERT/UPDATE`, completely skipping validation of the mutation payload. Zod is notoriously CPU-heavy; skipping it for SQL will falsely inflate the SQL performance gains, making a 5x speedup look easy when it's just apples-to-oranges.
*   **Fix:** Ensure the Direct SQL path includes the cost of Zod-validating the `WritePayload` parameters before executing the SQL.
* **Alt Fix**: Change `writeToItemsArray` pathway to match the SQL one, by creating a copied-but-simplified `writeToItemsArray2` function that would be a fairer comparison with the pure JS. What I really want to test isn't the two pathways, it's direct sql vs RMW. 

**B. Transaction / Network Overhead Skew**
*   **Issue:** For an UPDATE affecting ~330 rows, Direct SQL uses *one* bulk statement. RMW issues *330 separate `UPDATE` statements*. Even in memory, the parsing and IPC overhead of 330 queries will dominate the time, proving only that "1 query is faster than 330 queries" rather than measuring JS vs Postgres mutation efficiency.
*   **Fix:** Wrap the RMW per-row updates/deletes in a single `BEGIN; ... COMMIT;` transaction block. Better yet, if your real system supports it, batch the RMW writes using a single `UPDATE ... FROM (VALUES ...)` statement.

**C. Reset Methodology (TRUNCATE + Re-seed)**
*   **Issue:** TRUNCATE and re-seeding up to 1,000 rows 400 times (200 per path) will generate massive GC pressure, muddying the CPU profiles, and make the benchmark take forever. 
*   **Fix:** Use transaction rollbacks for state reset. Run `BEGIN;`, execute the benchmark iteration, then `ROLLBACK;`. This is perfectly isolated, instant, and guarantees identical state without re-insertion overhead.

### 2. Is the RMW Path Realistic?

**A. CREATE Full Table Scans**
*   **Issue:** The plan says RMW for CREATE does a `SELECT data FROM items (full table — need PK uniqueness check)`. Loading the entire table into JS memory on every single INSERT is an unscalable anti-pattern. If your current system *actually* does this, benchmarking at 1,000 rows is too small to show how catastrophic this is.
*   **Fix:** If the real system currently does a full fetch, increase the max row count in your scenarios to `10,000` or `50,000` to expose the true cost. If the real system actually relies on Postgres `UNIQUE` constraint errors to catch PK violations instead of full JS arrays, fix the RMW benchmark to reflect that.

**B. UPDATE Pre-filtering SQL vs JS Linear Scans**
*   **Issue:** You state RMW will `SELECT pk, data WHERE <where>`. However, your context says `writeToItemsArray` does a "linear scan all items, matchJavascriptObject...". If you use SQL to pre-filter before passing to JS, `writeToItemsArray` is iterating over an already-filtered list.
*   **Fix:** Ensure the benchmark accurately mirrors reality. If the current real-world app pre-filters via SQL before handing off to JS, the benchmark is fine. If the real-world app fetches a larger dataset and relies on `matchJavascriptObject` to do the filtering, the benchmark *must* omit the SQL `WHERE` clause in the RMW fetch step to capture the JS CPU cost.

### 3. Anything that would invalidate the results

*   **JIT Bias:** Running 50 warmup iterations might not be enough for V8 to optimize the heavily polymorphic `lodash.mergeWith` or `matchJavascriptObject` functions in the RMW path. **Fix:** Increase warmup to at least 200 iterations for both paths before starting the timer.
*   **Postgres Query Cache:** Interleaving runs is good, but `pglite` will cache the query plans for the Direct SQL path. If your app dynamically generates wildly varying SQL shapes in production, the benchmark will artificially favor Direct SQL. **Fix:** Ensure the parameter bindings (`$1, $2`) are used correctly so you're measuring execution time, not parsing/planning time.

# Plan

_Important: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Do some preparatory research:
- See how Pglite cna be used in testing, as it's what we'll be doing (with an in-memory set up). 
- Look into how to create a fair performance test with a database, and separately with a JS Runtime. E.g. a database will cache repeated queries, so over time they increase performance. We want to avoid that as the nature of the test is to compare two different techniques. 

Output the research to `Research for Testing`


# [x] Phase 2

Plan how to run the test.

You'll need to create SQL equivelants for Write Actions to Create, Update, Delete. 
You'll need to make sure they are constructed in a way that doesn't cache easily so they remain a fair test. 

In all cases you'll need to set up each test anew: e.g. create a fresh table with a JSONB column, populate it with (probably many) objects so it has real world pressure, then run the tests to see how fast they execute. 
You are allowed to using realistic indexes on the JSONB column. 

The goal (see `Goal`) is test the performance (time) of two different paths: 
1. Run Write Actions as direct SQL to INSERT, UPDATE, DELETE (converting those Write Actions)
2. Run the *same* Write Actions as we do now, in a `Read > Modify > Write` mechanism (convert the WhereFilterDefinition in the Write Action to Postgres using the converter function, read in all matching objects from the DB JSON column, modify them in memory using `writeToItemsArray`, then write back the changed items to the DB). 

Make sure you really do run a fair and high-stress test mimicking real world databases (although you don't need to have competing connections - that's too hard). 

Output the test to `Implementation Plan`


# [x] Phase 3a

Pass plan to Gemini for feedback. Output me the current implementation plan, and additional context it needs (e.g. relevant types, spirit of library... anything the plan references that another LLM would need to know), and a request to conscisely critique that you can act on. 

# [x] Phase 3b

Gemini responded as seen in the `Implementation Plan Critique from Gemini` section. Changes incorporated:

1. **SAVEPOINT/ROLLBACK reset** (was TRUNCATE+re-seed) — instant, no GC pressure
2. **Batched RMW writes** — `UPDATE FROM VALUES` and `DELETE WHERE pk = ANY(...)` instead of per-row statements
3. **Warmup 50→200** — ensures V8 JIT fully optimizes polymorphic paths
4. **Simplified JS merge (§3a)** — RMW skips Zod validation for fair comparison with SQL path
5. **CREATE RMW uses DB UNIQUE constraint** — no full table scan, just INSERT and handle error
6. **Confirmed SQL pre-filtering** for UPDATE/DELETE RMW path matches real system


# [x] Phase 4

Implemented as `src/write-actions/writeActionSqlPerf.bench.ts`. Run via `npx tsx src/write-actions/writeActionSqlPerf.bench.ts`.

**Note**: Changed WHERE filters from `status` (ZodEnum) to `score` (ZodNumber) because `postgresWhereClauseBuilder`'s casting map doesn't support ZodEnum. Uses `score < 34` for UPDATE (~1/3 rows) and `score >= 67` for DELETE (~1/3 rows).

## Results

| Scenario | Rows | Direct SQL (med) | RMW (med) | Ratio |
|----------|------|-------------------|-----------|-------|
| CREATE   | 10-1000 | ~0.06ms        | ~0.06ms   | 1.00x |
| UPDATE   | 10   | 0.262ms           | 0.421ms   | 1.61x |
| UPDATE   | 100  | 1.176ms           | 1.622ms   | 1.38x |
| UPDATE   | 500  | 6.297ms           | 8.334ms   | 1.32x |
| UPDATE   | 1000 | 12.205ms          | 16.288ms  | 1.33x |
| DELETE   | 10   | 0.110ms           | 0.112ms   | 1.02x |
| DELETE   | 100  | 0.152ms           | 0.264ms   | 1.74x |
| DELETE   | 500  | 0.334ms           | 0.673ms   | 2.02x |
| DELETE   | 1000 | 0.563ms           | 1.191ms   | 2.12x |

### Key Findings

- **CREATE**: No difference (both are a single INSERT — as predicted).
- **UPDATE**: Direct SQL is **1.3-1.6x faster**. The gain is consistent but modest — well below the estimated 3-10x. The RMW path uses batched writes (`UPDATE FROM VALUES`), so the difference is purely the data-transfer + JS merge overhead.
- **DELETE**: Direct SQL is **1.7-2.1x faster** at scale. The gap widens with row count as expected (eliminating the read round-trip matters more with more rows).
- **Overall**: The gains are real but moderate (1.3-2.1x), not the 2-5x estimated earlier. This is because the RMW path was fairly optimized (batched writes, SQL pre-filtering, no Zod overhead). The maintenance burden of triple implementation sync likely outweighs these gains for most use cases.

## Results with Per-Row Write Comparison

Added a third path: RMW with per-row writes (individual UPDATE/DELETE per matched row) to show the impact of batching.

| Scenario | Rows | Direct SQL (med) | RMW Batched (med) | RMW Per-Row (med) | vs Batched | vs Per-Row |
|----------|------|------------------|--------------------|--------------------|------------|------------|
| CREATE   | all  | ~0.05ms          | ~0.05ms            | ~0.05ms            | 1.00x      | 1.00x      |
| UPDATE   | 10   | 0.292ms          | 0.425ms            | 0.598ms            | 1.46x      | 2.05x      |
| UPDATE   | 100  | 1.712ms          | 2.188ms            | 3.886ms            | 1.28x      | 2.27x      |
| UPDATE   | 500  | 7.391ms          | 9.417ms            | 17.994ms           | 1.27x      | 2.43x      |
| UPDATE   | 1000 | 15.977ms         | 19.624ms           | 37.999ms           | 1.23x      | 2.38x      |
| DELETE   | 10   | 0.101ms          | 0.101ms            | 0.101ms            | 1.00x      | 1.00x      |
| DELETE   | 100  | 0.180ms          | 0.289ms            | 1.663ms            | 1.60x      | 9.22x      |
| DELETE   | 500  | 0.454ms          | 0.735ms            | 8.422ms            | 1.62x      | 18.56x     |
| DELETE   | 1000 | 0.712ms          | 1.301ms            | 16.834ms           | 1.83x      | 23.63x     |

## Results with Simulated Network Latency

The above tests use PGlite in-process (WASM boundary ~0ms). Real Postgres has network round-trip latency: ~0.5ms localhost, ~2ms same-region cloud. Each `db.query()` call pays this cost. Per-row writes pay it N times.

### 0.5ms latency (localhost Postgres)

| Scenario | Rows | Direct SQL (med) | RMW Batched (med) | RMW Per-Row (med) | vs Batched | vs Per-Row |
|----------|------|------------------|--------------------|--------------------|------------|------------|
| UPDATE   | 10   | 1.605ms          | 3.027ms            | 7.921ms            | 1.89x      | 4.93x      |
| UPDATE   | 100  | 2.405ms          | 4.014ms            | 45.133ms           | 1.67x      | 18.77x     |
| UPDATE   | 500  | 5.968ms          | 9.191ms            | 218.963ms          | 1.54x      | 36.69x     |
| UPDATE   | 1000 | 10.830ms         | 15.860ms           | 438.730ms          | 1.46x      | 40.51x     |
| DELETE   | 100  | 1.648ms          | 3.171ms            | 49.334ms           | 1.92x      | 29.93x     |
| DELETE   | 500  | 1.871ms          | 3.638ms            | 240.341ms          | 1.94x      | 128.45x    |
| DELETE   | 1000 | 2.149ms          | 4.231ms            | 480.985ms          | 1.97x      | 223.81x    |

### 2ms latency (same-region cloud DB)

| Scenario | Rows | Direct SQL (med) | RMW Batched (med) | RMW Per-Row (med) | vs Batched | vs Per-Row |
|----------|------|------------------|--------------------|--------------------|------------|------------|
| UPDATE   | 10   | 3.058ms          | 5.896ms            | 16.657ms           | 1.93x      | 5.45x      |
| UPDATE   | 100  | 3.993ms          | 7.075ms            | 96.757ms           | 1.77x      | 24.23x     |
| UPDATE   | 500  | 8.020ms          | 12.464ms           | 478.059ms          | 1.55x      | 59.61x     |
| UPDATE   | 1000 | 13.537ms         | 19.726ms           | 950.506ms          | 1.46x      | 70.22x     |
| DELETE   | 100  | 2.972ms          | 5.741ms            | 94.609ms           | 1.93x      | 31.84x     |
| DELETE   | 500  | 3.238ms          | 6.361ms            | 462.523ms          | 1.96x      | 142.83x    |
| DELETE   | 1000 | 3.493ms          | 6.782ms            | 916.533ms          | 1.94x      | 262.40x    |

# Conclusions

## Summary of Lessons

1. **Batching dominates performance, not SQL-vs-JS.** The difference between direct SQL and a well-batched RMW path is modest (1.2-2x). The difference between batched and per-row RMW is enormous and grows with latency — up to **262x** for DELETE at 1000 rows with 2ms latency. Investing in batching the write-back gives most of the possible performance gain without the complexity of direct SQL transpilation.

2. **Per-row writes are catastrophically slow at scale, and network latency makes it far worse.** Each individual `UPDATE`/`DELETE` is a separate round-trip. The penalty scales as `N × latency`:
   - No latency (WASM): per-row DELETE 1000 rows = 23.6x slower than direct SQL
   - 0.5ms latency (localhost): per-row DELETE 1000 rows = **223.8x** slower (481ms vs 2.1ms)
   - 2ms latency (cloud): per-row DELETE 1000 rows = **262.4x** slower (917ms vs 3.5ms)
   - Per-row UPDATE 1000 rows at 2ms = **70.2x** slower (951ms vs 13.5ms — nearly 1 second for a single write action)

3. **Network latency amplifies the batching advantage but barely affects the direct-SQL-vs-batched gap.** With 2ms latency, batched RMW is still only ~1.5-2x slower than direct SQL (same as no-latency). Batching already reduces the crossing count to 2 (read + write), so adding per-crossing latency only adds ~4ms total. Per-row adds `N × 2ms`.

4. **CREATE is irrelevant to this decision.** Single-row INSERT is the same regardless of approach. No optimisation possible or needed.

5. **UPDATE shows the most consistent (but modest) gain for direct SQL.** At all row counts and latencies, direct SQL is ~1.2-1.9x faster than batched RMW. The gap comes from eliminating the read round-trip and JS merge overhead. But the gap doesn't widen much with scale — both paths are dominated by the same UPDATE execution cost.

6. **DELETE scales better for direct SQL.** The ratio stabilises at ~1.9x vs batched RMW across latencies and row counts. This is because the RMW path must read PKs before deleting (2 crossings), while direct SQL is always 1 crossing.

7. **Direct SQL transpilation is not worth the complexity.** A 1.5-2x improvement doesn't justify maintaining three parallel implementations (JS, Postgres SQL, SQLite SQL) that must produce identical results. The testing burden, merge-semantics fidelity risk, and ongoing maintenance cost far outweigh the marginal gain. The correct investment is ensuring the RMW path uses batched writes.

8. **The original 2-5x estimate was based on unbatched RMW.** The plan's estimated speedups assumed per-row writes in the RMW path. Once RMW is batched, most of the gap disappears. This is a good lesson: benchmark before committing to architectural complexity.

9. **The number of db.query() calls is the single most important performance variable.** Not SQL complexity, not JS merge speed, not data size. Every call pays a fixed latency cost. Direct SQL: 1 call. Batched RMW: 2 calls. Per-row RMW: N+1 calls. Everything else is noise by comparison.

## Performance Requirements for an RMW Algorithm

Any Read-Modify-Write implementation must follow these patterns to be performant:

### 1. Batch write-back with `UPDATE ... FROM (VALUES ...)`

Never issue per-row UPDATEs. Use a single statement:

```sql
UPDATE items
SET data = v.data
FROM (VALUES
  ($1, $2::jsonb),
  ($3, $4::jsonb),
  ...
) AS v(pk, data)
WHERE items.pk = v.pk
```

This collapses N round-trips into 1. At 1000 rows with 2ms latency, batched UPDATE is **48x faster** than per-row (19.7ms vs 950ms) and batched DELETE is **135x faster** (6.8ms vs 917ms).

### 2. Batch delete with `DELETE ... WHERE pk = ANY($1)`

Never issue per-row DELETEs. Collect matched PKs into an array and delete in one statement:

```sql
DELETE FROM items WHERE pk = ANY($1::text[])
```

### 3. Use SQL WHERE pre-filtering on the read step

Don't fetch all rows and filter in JS. Convert the `WhereFilterDefinition` to a SQL WHERE clause (using `postgresWhereClauseBuilder`) and use it in the SELECT:

```sql
SELECT pk, data FROM items WHERE <where_clause>
```

This limits data transfer to only the rows that will be modified.

### 4. Minimise WASM/network boundary crossings

The dominant cost is not SQL execution — it's crossing the boundary between JS and the database (WASM in PGlite, network in real Postgres). Every `db.query()` call is a crossing. The target is:
- **READ**: 1 crossing (SELECT)
- **WRITE**: 1 crossing (batched UPDATE/DELETE)
- **Total**: 2 crossings, regardless of how many rows are affected

### 5. Avoid per-item serialisation overhead where possible

When writing back, `JSON.stringify` each row into the VALUES list. Don't construct per-row SQL strings — build a single parameterised statement with all rows.

### 6. Transaction wrapping

Wrap the read + write in a single transaction to ensure consistency. The read and write-back should see the same snapshot:

```sql
BEGIN;
  SELECT pk, data FROM items WHERE ...;
  -- JS mutation happens here --
  UPDATE items SET data = v.data FROM (VALUES ...) AS v(pk, data) WHERE items.pk = v.pk;
COMMIT;
```