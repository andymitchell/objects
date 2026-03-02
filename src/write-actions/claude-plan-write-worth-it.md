# Goal

Assess if it's possible to turn Write Actions into a declarative UPDATE SQL statement for a JSON column.

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
8. WHERE clause is already solved -- high reuse, low maintenance.
9. Path conversion utilities already exist -- reusable.


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


# [ ] Phase 3: Implementation Plan

## Recommendation

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
): PreparedWriteStatement[]
```

Returns an array of `PreparedWriteStatement` objects (one per WriteAction), each containing:
```ts
type PreparedWriteStatement = {
    sql: string,
    arguments: PreparedStatementArgument[],
    /** WriteActions that could not be converted to SQL (e.g. array_scope).
     *  The caller should fall back to JS-based applyWritesToItems for these. */
    unsupported?: boolean,
    writeActionUuid: string
}
```

### Dialect engine (shared logic)

Similar to `whereClauseEngine.ts`, create a `writeClauseEngine.ts` that contains the dialect-agnostic recursive logic:
- Iterates WriteActions
- Dispatches to dialect-specific SQL generators per payload type
- Handles permission checks as additional WHERE conditions

Dialect-specific implementations provide an `IWritePropertyMap` interface:
```ts
interface IWritePropertyMap<T extends Record<string, any>> {
    /** Generate a SET clause for an update payload */
    generateUpdateSet(data: Partial<T>, method: 'merge' | 'assign', statementArguments: PreparedStatementArgument[]): string;
    /** Generate an INSERT statement for a create payload */
    generateInsert(data: T, statementArguments: PreparedStatementArgument[]): string;
    /** Generate a DELETE statement */
    generateDelete(whereClause: string): string;
    /** Generate array_scope SQL (or return undefined if unsupported) */
    generateArrayScope?(scope: string, action: WriteActionPayload, whereClause: string, statementArguments: PreparedStatementArgument[]): string | undefined;
}
```

### File structure

```
src/write-actions/
  writeActionToSql/
    writeClauseEngine.ts          # Shared logic: iterate actions, dispatch, permissions
    types.ts                      # PreparedWriteStatement, IWritePropertyMap
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
- **Pg**: `UPDATE {table} SET {jsonCol} = jsonb_set(jsonb_set({jsonCol}, '{key1}', $1::jsonb), '{key2}', $2::jsonb) WHERE ...`
- For key deletion: chain `{jsonCol} #- '{key}'`
- **Sqlite**: `UPDATE {table} SET {jsonCol} = json_set({jsonCol}, '$.key1', ?, '$.key2', ?) WHERE ...`
- For key deletion: chain `json_remove({jsonCol}, '$.key')`

#### update (merge)
- Flatten `data` recursively to dot-prop leaf paths via `flattenDataToLeafPaths`
- Same as assign but paths are deep: `'{contact,name}'` (pg) / `'$.contact.name'` (sqlite)
- Validate each path against TreeNodeMap (reuse existing infrastructure)
- Arrays in data are set wholesale (a leaf path to an array sets the whole array, matching `mergeWith` behaviour)

#### delete
- **Pg**: `DELETE FROM {table} WHERE ...`
- **Sqlite**: `DELETE FROM {table} WHERE ...`
- Reuse existing WHERE clause builders directly

#### array_scope (deferred / fallback)
- Return `{ unsupported: true }` initially
- Caller falls back to the existing JS path for these actions
- Can be implemented later if demand justifies the complexity

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
