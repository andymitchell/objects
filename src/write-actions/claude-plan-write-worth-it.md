# Goal

Assess if it's possible to turn Write Actions into a declarative UPDATE SQL statement for a JSON column.

# CONCLUSION - IMPORTANT

There's only a 1.5x speed advantage to using direct queries, and a _lot_ more complexity to maintain. So for now we're ignoring it - there are better things to spend our time on. 

See @claude-plan-write-sql-perf-check.md for more.

If we do revisit this: 
* Remember to recheck how the where filter generator works, as it can now reject a where filter if not compatible (regex) 
* Tell it revisit the response types (it may be able to drop parts of the plan)
* Tell it to revisit the type specific parts 
* Remember to recheck once we add some more mongo-ese like ‘addToSet’
* Would need to handle duplicate_create_recovery, and growset, or deny it for the optimised path 

# Relevant Files

@./types.ts
@./write-action-schemas.ts
@./applyWritesToItems/types.ts
@./applyWritesToItems/schemas.ts
@./applyWritesToItems/applyWritesToItems.ts
@../where-filter/types.ts


# Context


A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts). It's inspired by MongoDb.

A `WriteAction` is a definition to create/update/delete/upsert a javascript object.

In @../where-filter/postgresWhereClauseBuilder.ts you'll see it can convert a `WhereFilterDefinition` to a WHERE SQL query.

In theory it's a short-step to converting a `WriteAction` to an `UPDATE` SQL statement, using the generated `WHERE` query - it just has to figure out `SET` (and conditional `INSERT` on UPSERT).

# How Write Actions Currently Work

## WriteAction Envelope

A `WriteAction<T>` wraps a mutation intent:
```
{ type: 'write', ts: number, uuid: string, payload: WriteActionPayload<T> }
```

## CRUD Payload Types

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

### `array_scope`
- `{ type: 'array_scope', scope: string, action: WriteActionPayload<NestedT>, where: WhereFilterDefinition<T> }`
- `scope` is a dot-prop path to a nested object-array (e.g. `'children'`, `'children.grandchildren'`).
- `action` is itself a `WriteActionPayload` (create/update/delete/array_scope) that operates **within** the scoped array.
- The engine resolves the path (spreading intermediate arrays), extracts each array, builds a scoped schema + DDL, and **recursively** calls `_applyWritesToItems` on it. The result is written back via `setProperty`.
- This is the key mechanism for atomic sub-document mutations.

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

### DDLPermissions
- `'none'`: anyone can write.
- `'basic_ownership_property'`: only the owner (identified by a dot-prop path to a user-id field) can mutate. Supports `property_type: 'id'` and `'id_in_scalar_array'`, plus optional `transferring_to_path`.
- `'opa'`: placeholder for future Open Policy Agent integration.

## Schema Validation

A Zod schema is required. After every create or update, the resulting object is validated against it (`failureTracker.testSchema`). Schema failures halt the action and are reported as `WriteCommonError { type: 'schema' }`. For `array_scope`, the schema is sliced to the sub-path via `getZodSchemaAtSchemaDotPropPath`.

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

**array_scope (1 level)**: Feasible but complex. Requires reconstructing the target array via `jsonb_agg`/`json_group_array` with element-level CASE logic:
- **create**: append via `|| new_element::jsonb` (pg) or `json_insert` (sqlite)
- **update within array**: `jsonb_array_elements` + CASE WHEN match THEN `jsonb_set(elem, ...)` ELSE elem + `jsonb_agg` (pg); `json_each` + CASE + `json_group_array` (sqlite)
- **delete within array**: filter out matching elements via WHERE NOT in the aggregation subquery

**array_scope (nested / recursive)**: Technically feasible but the SQL becomes deeply nested subqueries-within-subqueries. Each level of nesting multiplies the complexity. Debugging and testing become very difficult. Practical limit is ~2 levels before the SQL is unmanageable.

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

# TDD Testing Plan

# Implementation Plan

**Implement a "lite" version** covering create/update/delete without array_scope. This captures ~80% of the performance benefit with ~30% of the complexity. array_scope can be added later if needed, or can continue to use the existing JS path (hybrid approach).

## Architecture

### Entry point function (one per dialect)

```ts
// Signature (same shape for both dialects)
function writeActionToSql<T extends Record<string, any>>(
    writeActions: WriteAction<T>[],
    schema: z.ZodSchema<T>,
    ddl: DDL<T>,
    tableName: string,
    jsonColumnName: string,
    user?: IUser
): WriteActionToSqlResult
```

Returns an error-as-value discriminated union (mirroring `PreparedWhereClauseResult` from where-filter):
```ts
type WriteActionToSqlResult =
    | { success: true; statements: PreparedWriteStatement[] }
    | { success: false; errors: WriteActionSqlError[] }

type PreparedWriteStatement = {
    sql: string,
    arguments: PreparedStatementArgument[],
    writeActionUuid: string
}

/** Describes why a write action could not be compiled to SQL. */
type WriteActionSqlError = {
    writeActionUuid: string;
    message: string;
    /** When caused by an unsupported WHERE filter operator, includes the dialect errors. */
    whereClauseErrors?: WhereClauseError[];
}
```

The `success: false` path covers two failure categories:
1. **Structural rejection** — detected by `canApplyWriteActionsToSql` (e.g. array_scope, custom strategy).
2. **Dialect capability gap** — detected by `buildWhereClause` when compiling the update/delete WHERE filter (e.g. `$regex` on SQLite). The original `WhereClauseError[]` from the where-filter system is included in `whereClauseErrors` for full context.

### Dialect engine (shared logic)

Similar to `whereClauseEngine.ts`, create a `writeClauseEngine.ts` that contains the dialect-agnostic recursive logic:
- Iterates WriteActions
- Dispatches to dialect-specific SQL generators per payload type
- For update/delete: calls `buildWhereClause` with the dialect's `IPropertyMap` to compile the WHERE filter. If `buildWhereClause` returns `{ success: false }`, the engine collects the errors and returns `{ success: false }` at the top level — **no partial SQL is generated**.
- Handles permission checks as additional WHERE conditions
- Accumulates errors in a shared `WriteActionSqlError[]` array (same pattern as `WhereClauseError[]` accumulation in `whereClauseBuilder`)

Dialect-specific implementations provide an `IWritePropertyMap` interface:
```ts
interface IWritePropertyMap<T extends Record<string, any>> {
    /** Generate a SET clause for an update payload */
    generateUpdateSet(data: Partial<T>, method: 'merge' | 'assign', statementArguments: PreparedStatementArgument[]): string;
    /** Generate an INSERT statement for a create payload */
    generateInsert(data: T, statementArguments: PreparedStatementArgument[]): string;
    /** Generate a DELETE statement */
    generateDelete(whereClause: string): string;
    /** The IPropertyMap for WHERE clause generation (passed to buildWhereClause) */
    getWherePropertyMap(): IPropertyMap<T>;
}
```

Note: `generateArrayScope` is removed — array_scope is rejected upfront by `canApplyWriteActionsToSql`.

### File structure

```
src/write-actions/
  writeActionToSql/
    writeClauseEngine.ts          # Shared logic: iterate actions, dispatch, permissions, error accumulation
    types.ts                      # PreparedWriteStatement, WriteActionToSqlResult, WriteActionSqlError, IWritePropertyMap
    postgresWriteBuilder.ts       # Pg-specific: jsonb_set chains, INSERT, DELETE
    sqliteWriteBuilder.ts         # Sqlite-specific: json_set chains, INSERT, DELETE
    flattenDataToLeafPaths.ts     # Utility: flatten {a: {b: 1}} to [['a','b', 1]]
    tests/
      postgresWriteBuilder.test.ts
      sqliteWriteBuilder.test.ts
      writeClauseEngine.test.ts
```

### SQL generation per payload type

#### create
- **Pg**: `INSERT INTO {table} ({jsonCol}) VALUES ($N::jsonb)`
- **Sqlite**: `INSERT INTO {table} ({jsonCol}) VALUES (json(?))`
- Pre-validate `data` against schema in JS before generating SQL
- For `attempt_recover_duplicate_create: 'always-update'`: generate UPSERT via `ON CONFLICT`

#### update (assign)
- Flatten `data` to top-level keys only
- Compile `where` via `buildWhereClause` with dialect's `IPropertyMap`. If result is `{ success: false }`, propagate `WhereClauseError[]` into a `WriteActionSqlError` and abort.
- **Pg**: `UPDATE {table} SET {jsonCol} = jsonb_set(jsonb_set({jsonCol}, '{key1}', $1::jsonb), '{key2}', $2::jsonb) WHERE ...`
- For key deletion: chain `{jsonCol} #- '{key}'`
- **Sqlite**: `UPDATE {table} SET {jsonCol} = json_set({jsonCol}, '$.key1', ?, '$.key2', ?) WHERE ...`
- For key deletion: chain `json_remove({jsonCol}, '$.key')`

#### update (merge)
- Flatten `data` recursively to dot-prop leaf paths via `flattenDataToLeafPaths`
- Compile `where` via `buildWhereClause` (same error-as-value handling as assign)
- Same as assign but paths are deep: `'{contact,name}'` (pg) / `'$.contact.name'` (sqlite)
- Validate each path against TreeNodeMap (reuse existing infrastructure)
- Arrays in data are set wholesale (a leaf path to an array sets the whole array, matching `mergeWith` behaviour)

#### delete
- Compile `where` via `buildWhereClause` with dialect's `IPropertyMap`. If result is `{ success: false }`, propagate errors and abort.
- **Pg**: `DELETE FROM {table} WHERE ...`
- **Sqlite**: `DELETE FROM {table} WHERE ...`
- Reuse existing WHERE clause builders directly

#### array_scope
- Rejected upfront by `canApplyWriteActionsToSql`. Never reaches SQL generation.

### Permission handling
- For `basic_ownership_property` with `property_type: 'id'`: add `AND {jsonCol}->>'ownerPath' = $userIdParam` to the WHERE clause
- For `'none'`: no additional WHERE condition
- For unsupported permission types: return `{ unsupported: true }`

### Schema validation strategy
- **Pre-validate** the `data` payload against the schema in JS before generating SQL (for create/update)
- This catches schema errors before they reach the DB, at the cost of not validating the _result_ of the mutation
- Accept this tradeoff: the risk of a valid partial update producing an invalid full object is low when the schema is correct

### Transaction handling
- If multiple WriteActions are provided, wrap them in `BEGIN; ... COMMIT;`
- If `atomic` option is set, this is automatic (SQL transactions are inherently atomic)
- On error, `ROLLBACK` undoes everything

### Testing approach
- For each payload type x dialect: generate SQL, run it against a real test DB, compare result to `applyWritesToItems` on the same input
- Use the existing test fixtures from the write-actions test suite
- Property-based tests: random WriteActions + random data, verify SQL result matches JS result


# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Infer the spec for a `WriteAction` from the type - specifically the CRUD options it has. Also infer how a schema is defined for an object store (especially the `DDL` type in @./applyWritesToItems/types.ts) - as a lot of the Write Action work is in vetting that it can be safely applied to an object of a certain schema/shape.

You can ask me questions about how it works if there's uncertainty or ambiguity.

Output the analyse to 'How Write Actions Currently Work' in this document.


# [x] Phase 2

Remember, the intention here is to work on a table that has a JSON column representing the object to filter and mutate: `UPDATE colJson SET ... WHERE ...` (possibly with UPSERT mechanics; possibly multi step/line SQL statements)

Implement a plan to create a new converter - I imagine a function that will take a `WriteAction`, maybe a schema for the object, and the JSON column of the target table. There will be one for pg and one for sqlite.

Output the plan in Phase 3 below ('Implementation Plan').

Then update `Decision: Is it possible, it is worth?` above:
* `Feasibility: is it possible`:
    Was the plan possible to implement? It may simply not be technically possible to transpile a `WriteAction` (especially array_scope) into SQL.
* `Performance gain over 'query to read objects > update in JS context > write back to the DB'`:
    My current solution is to use a WhereFilterDefinition to read from the db table to get all the objects; bring them into a JS context and run applyWritesToItems on it; then write the changed items back to the table. Obviously this pure SQL mode would be faster if possible, but can you assess how much?
* `Likely maintenance burdens`:
    If this is feasible, is it going to be a pain to maintain? Identify potential issues.


# [ ] Phase 3

Do additional research to support the implementation.

## Step 1
Review how @../where-filter/standardTests.ts are used to test multiple implementations (e.g. matchJavascriptObject, pg, etc). This same mechanism will be used.

## Step 2

Update `How Write Actions Currently Work` in this document with new sections that detail:
* `Return type of applyWritesToItems`: The return format of `applyWritesToItems` (with the intention that all the pg/sqlite functions will use this return format). Note: `referential_comparison_ok` has been removed from the response type — it is JS-specific and irrelevant to SQL. `final_items` is optional (see Phase 4 notes).
* `List of general important tests from applyWritesToItems.test.ts`: Everything important that is tested in `applyWritesToItems.test.ts`, but only choose tests that would broadly make sense to the current TS implementation AND a pg/sql implementation (lowest common denominator). It should be a succinct concise list that gives just enough detail to be recreated in new tests.

**Inclusion/exclusion criteria** — before curating the list, propose explicit criteria for which test categories to include vs. exclude. Base the proposal on what you think is correct (e.g. "include permissions because ownership WHERE sub-conditions are feasible in SQL; exclude Immer and referential comparison because they're JS runtime concepts; exclude purity/mutate because SQL has no in-place mutation concept"). Challenge me on borderline cases and I will confirm or decide tie-breakers.


# [ ] Phase 4

Rewrite the implementation plan.

Keep most of it, but amend with the following decisions:

### `canApplyWriteActionsToSql` — gate function (structural check only)
* Standalone function that accepts a set of write actions and validates they fit the 'lite' version (create/update/delete only, LWW strategy only, supported permission types only).
* If they include any unsupported feature (array_scope, custom write strategies, pre-triggers, `attempt_recover_duplicate_create: 'if-identical'`, unsupported permission types), the entire batch is rejected.
* There is NO hybrid/partial execution — either all actions pass or none run as SQL.
* Returns an overall success/fail, plus specifies which write actions failed with a reason (reusable `FailedWriteAction` type).
* Enforced at BOTH the type level (a `WriteActionPayloadLite<T>` type that excludes `array_scope`) AND runtime (`canApplyWriteActionsToSql` checks at runtime). The type provides compile-time safety for callers who know they're on the SQL path; the runtime check is the definitive guard gate since `writeActionToSql` accepts the full `WriteAction<T>` union.
* **Important**: This is a _structural_ check only — it validates write action shape/features but does NOT validate whether the WHERE filters within update/delete actions are compatible with the target SQL dialect. Dialect-specific filter support (e.g. `$regex` unsupported on SQLite) is discovered during SQL generation in `writeActionToSql`, following the same error-as-value pattern used by `buildWhereClause` in the where-filter system.

### `writeActionToSql` — SQL generator (error-as-value)
* Begins by running `canApplyWriteActionsToSql`; halts and returns a failure result if structural validation fails.
* For update/delete actions, calls `buildWhereClause` (from the where-filter system) to compile the `where: WhereFilterDefinition` into SQL. If `buildWhereClause` returns `{ success: false }` (e.g. because the filter uses `$regex` on SQLite, or any other dialect-unsupported operator), the entire batch fails — consistent with the all-or-nothing approach.
* Returns a **discriminated union result type**, mirroring the `PreparedWhereClauseResult` pattern from where-filter:
  ```ts
  type WriteActionToSqlResult =
      | { success: true; statements: PreparedWriteStatement[] }
      | { success: false; errors: WriteActionSqlError[] }

  type WriteActionSqlError = {
      writeActionUuid: string;
      message: string;
      /** When the failure is caused by an unsupported WHERE filter, includes the original WhereClauseError(s). */
      whereClauseErrors?: WhereClauseError[];
  }
  ```
* No `unsupported` field on individual statements (since all-or-nothing validation already passed when `success: true`).
* This means a caller can distinguish three failure scenarios:
  1. Structural rejection (from `canApplyWriteActionsToSql`): write action uses array_scope, custom strategy, etc.
  2. Dialect capability gap (from `buildWhereClause`): WHERE filter uses an operator the target SQL dialect doesn't support.
  3. Execution failure (from `applyWritesToSql`): SQL ran but the DB returned an error.

### Error identification — use the transaction error directly
* No separate "re-run to find failures" helper. SQL transactions already report which statement failed. Since statements are executed sequentially within a transaction, the first error halts execution — the failing statement index maps directly to the failing `WriteAction`. Subsequent actions are marked `blocked_by_action_uuid` (same pattern as `applyWritesToItems`).

### `applyWritesToSql` — db-agnostic execution wrapper
* Generates SQL via `writeActionToSql`, executes it via a callback (one call per statement within a transaction).
* **Pre-execution failures** (error-as-value, no SQL is sent to DB):
  - If `writeActionToSql` returns `{ success: false }`, the wrapper returns the error result immediately. This covers both structural rejection (unsupported write action features) and dialect capability gaps (unsupported WHERE filter operators).
  - The caller receives a typed error result they can inspect without try/catch, and can fall back to the JS `applyWritesToItems` path if desired.
* **Execution failures** (SQL ran but DB returned error):
  - Identifies the failing WriteAction from the statement index, marks subsequent actions as `blocked_by_action_uuid`, returns error response.
* Shares the same response type as `applyWritesToItems`, with these modifications:
  - `referential_comparison_ok` is REMOVED from the response type entirely (from both `applyWritesToItems` and `applyWritesToSql`) — it's a JS runtime concept with no SQL equivalent.
  - `final_items` is OPTIONAL in the response type. `applyWritesToSql` accepts a config param `includeFinalItems?: boolean` (default false). When true, it does a final SELECT to retrieve the affected rows. When false (the common case for performance), `final_items` is omitted. This avoids negating the performance gain of pure SQL.
  - `affected_items` uses RETURNING clause (supported in both Postgres and SQLite 3.35+, which we assume as minimum).
* The full return type is a three-way discriminated union:
  ```ts
  type ApplyWritesToSqlResult<T> =
      | { status: 'ok'; changes: ...; successful_actions: ... }                     // all SQL executed successfully
      | { status: 'error'; changes: ...; successful_actions: ...; failed_actions: ... } // SQL execution error
      | { status: 'unsupported'; errors: WriteActionSqlError[] }                     // pre-execution rejection (structural or dialect gap)
  ```

### File structure
* New SQL code lives in: `./applyWritesToItems/sql/`
* No separate `tests/` directory — each function has a colocated `.test.ts` file
* `standardTests` lives in `./applyWritesToItems/` directory (shared by JS and SQL test suites)

### Permission handling
* For `basic_ownership_property` with `property_type: 'id'`: add `AND {jsonCol}->>'ownerPath' = $userIdParam` to the WHERE clause.
* For `'none'`: no additional WHERE condition.
* Unsupported permission types (e.g. `'opa'`, `'id_in_scalar_array'` with `transferring_to_path`) cause `canApplyWriteActionsToSql` to reject the batch.

Don't execute — just rewrite the `Implementation Plan` section of this document.


# [ ] Phase 5

We're going to do TDD for this. Create a plan in `TDD Testing Plan`.

## standardTests

Generate its own version of `standardTests.ts` seen in where-filter; that will be used by `applyWritesToItems` and both dialects of `applyWritesToSql`. It will work the same way, with each apply function setting up the tests (e.g. a sqlite table) and for each test (e.g. setting initial data in a fresh table), then executing the test on the function and assessing whether when run (directly in the case of applyWritesToItems; or have SQL executed in the case of writeActionToSql), the data source (table, raw JS) has been correctly modified.

Follow the same DB setup/teardown pattern used in `where-filter/standardTests.ts` — study how it manages test DB connections, per-test table creation, and cleanup. Replicate that pattern for write-action tests.

### Test design philosophy

The goal is to match the **spirit of the spec**, not to enumerate every permutation mechanically. The describe-block hierarchy should mirror the key intents of the WriteAction spec so that any developer reading it immediately sees "this maps to how I'd understand the spec." Under each intent, tests cover the happy path plus the edge cases and most likely failures — not an exhaustive combinatorial matrix.

### Steps
1. Identify the high-level parts of the spec and their intent. Structure these as nested `describe` blocks.
2. Under each describe, add tests for the happy path and the meaningful edge cases / failure modes.
3. Include any additional tests from `List of general important tests from applyWritesToItems.test.ts` that weren't already covered.
4. Split the file into two broad sections:
   - **Lite Write Actions** (create/update/delete — all implementations must support these)
   - **Full Write Actions** (array_scope, custom strategies, etc. — only `applyWritesToItems` supports these; SQL tests skip this section)

### Handling dialect capability gaps in standardTests

Follow the same pattern as `where-filter/standardTests.ts`: the test adapter function for each SQL dialect should handle `{ status: 'unsupported' }` results by returning `undefined`, which the shared test helper (`expectOrAcknowledgeUnsupported`) treats as "acknowledged, skip this test". This means:
- A standardTest that uses a WHERE filter with `$regex` will naturally pass for Postgres (which supports it) and be skipped for SQLite (which rejects it at SQL generation time).
- The test suite never sees a thrown exception for capability gaps — only error-as-value results that the adapter translates to `undefined`.
- Validation errors (malformed filters) should still be re-thrown as exceptions so error-handling tests work correctly.

This mirrors exactly how `sqliteWhereClauseBuilder.test.ts` distinguishes capability gaps from validation errors when consuming `PreparedWhereClauseResult`.

## DB specific tests

`applyWritesToSql.pg.test.ts` (and sqlite version) can have its own `dbStandardTests` in addition to `standardTests` for any tests that specifically stress-test a database (vs. vanilla `applyWritesToItems`).

These should include explicit tests for the `{ status: 'unsupported' }` path:
- Update with `$regex` WHERE filter on SQLite → `{ status: 'unsupported', errors: [{ whereClauseErrors: [...] }] }`
- Delete with `$regex` WHERE filter on SQLite → same
- Verify Postgres handles the same filters successfully

---

Output the plan to `TDD Testing Plan`.


# [ ] Phase 6

Do red/green TDD. Work in this order:

### Sub-phase 6.1: Types and validation
1. Define `WriteActionPayloadLite<T>` type (compile-time narrowing)
2. Define `PreparedWriteStatement` (without `unsupported` field)
3. Define shared response types (updated `ApplyWritesToItemsChanges` without `referential_comparison_ok`, `final_items` optional)
4. Implement `canApplyWriteActionsToSql` — runtime validation gate
5. Tests for `canApplyWriteActionsToSql`: accepts valid lite actions, rejects array_scope / custom strategies / unsupported permissions / `if-identical`

### Sub-phase 6.2: SQL generation (`writeActionToSql`)
1. Implement `flattenDataToLeafPaths` utility + tests
2. Implement `writeClauseEngine.ts` — shared logic: iterate actions, dispatch per payload type, call `buildWhereClause` for update/delete, inject permission WHERE conditions, accumulate errors
3. Implement `sqliteWriteBuilder.ts` — json_set/json_remove chains for update, INSERT for create, DELETE for delete
4. Implement `postgresWriteBuilder.ts` — jsonb_set chains for update, INSERT for create, DELETE for delete
5. Tests for each builder: verify generated SQL + arguments for each payload type
6. Tests for WHERE clause error propagation: verify that an update/delete with a dialect-unsupported filter operator (e.g. `$regex` on SQLite) returns `{ success: false }` with `whereClauseErrors` populated

### Sub-phase 6.3: Execution wrapper (`applyWritesToSql`)
1. Implement `applyWritesToSql` — calls `writeActionToSql` (which internally runs `canApplyWriteActionsToSql` + `buildWhereClause`). If `writeActionToSql` returns `{ success: false }`, return `{ status: 'unsupported', errors }` immediately (no SQL sent to DB). Otherwise execute via callback, handle transaction errors (maps statement index to WriteAction), support `includeFinalItems` config.
2. Wire up `RETURNING` for `affected_items`
3. Integration tests against real SQLite (and Postgres if available)
4. Tests for the `unsupported` path: verify that a write action with a dialect-incompatible WHERE filter returns `{ status: 'unsupported' }` without touching the database

### Sub-phase 6.4: Shared standardTests
1. Run `standardTests` against `applyWritesToItems` — verify existing behaviour matches
2. Run `standardTests` against `applyWritesToSql` (SQLite) — verify SQL path matches
3. Run `standardTests` against `applyWritesToSql` (Postgres) — verify SQL path matches
4. Fix any discrepancies until all three implementations pass the shared suite

### Sub-phase 6.5: Remove `referential_comparison_ok`
1. Remove `referential_comparison_ok` from `ApplyWritesToItemsChanges` type
2. Update `applyWritesToItems` implementation to stop computing it
3. Update any consumers / tests that reference it


# [ ] Phase 7

Audit and improve the DX of `WriteActionsResponse` and related return types.

## Goal

Review the full type surface that consumers interact with after calling `applyWritesToItems` / `applyWritesToSql` — specifically `ApplyWritesToItemsResponse`, `ApplyWritesToItemsChanges`, `WriteActionsResponseOk`, `WriteActionsResponseError`, `SuccessfulWriteAction`, `FailedWriteAction`, and any intermediate types. Identify unpleasantness, inconsistencies, or poor ergonomics.

## Steps

1. Read all relevant type definitions and their usage sites across the codebase (consumers, tests, internal helpers).
2. Catalogue concrete DX issues. For each, describe the problem and propose a fix. Examples of what to look for:
   - Awkward discriminated union narrowing (does `if (result.status === 'ok')` give clean access to all fields, or do consumers need extra casts/checks?)
   - Redundant or confusingly similar fields (e.g. `changes.changed` vs checking `changes.insert.length > 0`)
   - Fields that exist on both success and error variants but mean subtly different things
   - Naming inconsistencies (e.g. `remove_keys` vs `insert` — one is a verb, one is a noun)
   - Types that are overly nested or force consumers to destructure deeply
   - `final_items` becoming optional (from Phase 4) — does this make the success path annoying to use? Should there be a generic parameter or overloaded return type instead?
   - Whether `SuccessfulWriteAction[]` and `FailedWriteAction[]` appearing on both variants is confusing
   - Whether `ObjectsDelta<T>` being mixed into `ApplyWritesToItemsChanges` creates a leaky abstraction (delta is a reusable concept; changes adds write-action-specific fields)
3. Challenge me with the improvement proposals. I will confirm, reject, or modify each one.
4. Implement the agreed changes, updating types, implementations, and all consumers/tests.
