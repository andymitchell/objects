# Goal

Create robust testing, based on intent of the write actions library, 

There will be:
- standard-tests that any implementation must adhere to (e.g. `applyWritesToItems`). These will be lowest-common denominator tests of intent (not implementation specific... specific implementations can do this later).
    - It's important to know we'll be doing SQL based 'applyWritesToSqlDb' type functions in the future, so that's the lowest common denominator is to have tests that would apply in all scenarios. 
- type assertion tests for the major exported types 

# Relevant Files

@./types.ts
@./write-action-schemas.ts
@./applyWritesToItems/types.ts
@./applyWritesToItems/schemas.ts
@./applyWritesToItems/applyWritesToItems.ts
@./applyWritesToItems/applyWritesToItems.test.ts
@../where-filter/types.ts
@../where-filter/types.test.ts
@../where-filter/standardTests.ts
@../where-filter/matchJavascriptObject.test.ts


# Context 

The current testing is in @./applyWritesToItems/applyWritesToItems.test.ts and is directly tied the narrow implementation of `applyWritesToItems` (e.g. with a big focus on immer usage). This goes against good design and doesn't set us up for alternative implementations. 

Most importantly, it is NOT designing with the spirit/intent of the library in mind. 

## Reminder: Good Testing Practices

Always test the **intent**.

### Code

**1. Structure & Coverage**
- Derive intent and stakeholder perspectives from docs, code, types, and APIs; + interview me. 
- Nest `describe` blocks to represent these perspectives and boundary contracts (e.g. API)
- Prioritize by risk (e.g. error cost). Cover: happy path, errors, edges, forbidden states (e.g., PII logs), and state/time invariants (e.g. idempotency, eventual consistency).

**2. Design & Paradigm**
- Use DAMP naming to express intent. Never reference code details (e.g. class names).
- Favor property-based (e.g. 'reversing twice returns original string') and metamorphic (e.g. 'sorting then sorting again doesn’t change result') tests over hardcoded I/O examples. 
- Test outcomes; never implementation details. A refactor that preserves behavior must never break a test.
- Assertions must validate the **correctness of values**, not just the presence of fields.

**3. Test Reliability**
- Avoid mocks; use real modules with fake data. 
- No async races; strictly use deterministic/fake timers.

### Compile-Time Type Assertions

**1. Alignment & Intent**
- Highlight deviance between TS types and intent (stakeholder perspectives from docs, code, types, and APIs); ask me to resolve mismatches.
- Treat types as a **caller contract**: what we promise consumers they can and cannot do.

**2. Type Coverage**
- **Strictness & Inference**:
    - Assert exact type equivalence (e.g. `Expect<Equal>`). 
    - Prevent accidental widening, `any`/`unknown` leaks, and forced generic arguments. Verify correct overload resolution.
- **Negatives & Soundness**:
    - Use `@ts-expect-error` to enforce rejection of invalid shapes, excess properties, and forbidden states. 
    - Type-test and quarantine all unsafe escape hatches (`as`, `any`, `unknown`).
- **Transformations & Variance**:
    - Test metamorphic generic transforms (ensure mapped types preserve constraints, `readonly`, `?`, and discriminants). 
    - Assert safe function variance at boundaries (e.g. callback contravariance).
**Control Flow & Exhaustiveness**:
    - Assert discriminated unions narrow correctly.
    - Enforce exhaustive pattern matching (unhandled paths must resolve to `never`).


# Spirit of Write Actions

## Core Idea

Write Actions are a **serialisable, transport-agnostic instruction set** for CRUD operations on typed objects. A `WriteAction<T>` is a single timestamped, UUID-identified instruction that says *what* to do to data — not *how* to do it. The "how" is delegated to **applier functions** (e.g. `writeToItemsArray` for JS arrays; future: SQL, CRDT stores, etc.).

The library cleanly separates:
- **Intent** (the action payload) from **Execution** (the applier)
- **Schema** (Zod, the shape contract) from **Rules** (DDL: primary keys, ordering, permissions, write strategy)

## The Four Verbs

`WritePayload<T>` is a discriminated union on `type`:

1. **`create`** — Insert a new item. Data must include the primary key and pass schema validation.
2. **`update`** — Modify matching items. Uses `WhereFilterDefinition<T>` to target items. Data is `Partial<T>` restricted to non-object-array properties (to prevent full-array overwrites that would break CRDT reconciliation).
3. **`delete`** — Remove matching items. Uses `WhereFilterDefinition<T>` to target items.
4. **`array_scope`** — Recursively target a nested object-array property, then apply a sub-`WritePayload` within that scope. This is the key mechanism for granular nested-list mutations without replacing the whole array.

## Stakeholders and Their Concerns

### 1. Action Author (caller building WriteActions)
- Wants type-safe payload construction: the generic `T` constrains what data/where-filters are valid.
- Needs `assertWriteArrayScope` helper because TS can't fully infer nested generic paths.
- Expects that a well-typed payload will succeed, or receive a meaningful structured error.

### 2. Result Consumer (caller reading WriteResult)
- `WriteResult<T>` is NOT a discriminated union — `actions` and `changes` are always accessible regardless of `ok`.
- Per-action outcomes (`WriteOutcome<T>`) ARE discriminated on `ok`:
  - `ok: true` → `WriteOutcomeOk` with `affected_items`
  - `ok: false` → `WriteOutcomeFailed` with `errors[]`, optional `unrecoverable`, `back_off_until_ts`, `blocked_by_action_uuid`
- Helper functions `getWriteFailures()` / `getWriteSuccesses()` / `getWriteErrors()` provide typed, filtered access.
- `WriteError` is a discriminated union on `type`: `custom`, `schema`, `missing_key`, `update_altered_key`, `create_duplicated_key`, `permission_denied`. Enriched to `WriteErrorContext` with `item_pk` and `item`.

### 3. Applier Implementor (building a new apply function, e.g. SQL)
- Must respect the DDL (`ListRules`): primary key, ordering, permissions, write strategy, optional grow-set.
- Must validate against the Zod schema after mutations.
- Must implement the four verbs, including recursive `array_scope`.
- Must track and report per-action outcomes (successes + failures).
- Must support **sequential-with-halt-on-failure** semantics: process actions in order, halt on first failure, mark subsequent actions as `blocked_by_action_uuid`.
- Must optionally support **atomic/transactional** mode: if any action fails, all fail (rollback).
- The response must always include a `WriteChanges` delta (`insert[]`, `update[]`, `remove_keys[]`, `changed`).

### 4. Schema / DDL Author (defining the data contract)
- `DDL<T>` maps every object-array nesting level to `ListRules` (including `'.'` for root).
- `ListRules`: `primary_key`, `order_by`, optional `pre_triggers`, `write_strategy` (default: LWW), optional `growset`.
- Permissions: `'none'` (open) or `'basic_ownership_property'` (owner-only writes, identified by a path to an ID field).
- Schema is the source-of-truth for validation (Zod). Applier validates *after* mutation, rejecting invalid results.

## Key Design Invariants (what tests must enforce)

1. **Create**: new item added, PK must exist and not collide (unless recovery strategy), schema-validated.
2. **Update**: only matching items mutated, PK cannot be changed, partial data merged (LWW default), schema-validated post-merge.
3. **Delete**: matching items removed.
4. **Array scope**: recursively applies sub-action to the nested array at the scoped path.
5. **Failure halts subsequent actions**: first failure blocks everything after it.
6. **Atomic mode**: on failure, all changes are rolled back (including prior successes).
7. **Non-atomic mode**: successful actions before the failure are kept; their outcomes + changes are reported.
8. **Schema validation**: every create/update result is validated against the Zod schema.
9. **Permission checks**: if DDL requires ownership, writes without proper IUser are denied.
10. **Duplicate create recovery**: configurable strategy (`never`, `if-identical`, `always-update`).
11. **Immutability by default**: original items are not mutated (structuredClone). `mutate: true` opts into in-place mutation (needed for Immer drafts).
12. **Referential stability**: unchanged items keep original references; only affected items get new references.
13. **Changes delta**: result always includes `insert[]`, `update[]`, `remove_keys[]`, `changed` boolean, and (for `writeToItemsArray`) `final_items[]`.
14. **Update forbids object-array properties in data**: prevents accidental full-array replacement (use `array_scope` instead).
15. **Update method**: `merge` (deep, default) vs `assign` (shallow).

# Possible Breakers of Intent in Types and Implementations

## 1. Update schema doesn't enforce the "no object-array properties" restriction at runtime

**Type**: `WritePayloadUpdate<T>.data` is `Partial<Pick<T, NonObjectArrayProperty<T>>>` — forbids object-array keys at compile time.

**Schema**: `makeWriteActionAndPayloadSchema` builds update data as `objectSchema.partial().strict()` — includes all properties, including object-arrays.

**Impact**: A consumer bypassing TS (e.g. runtime JSON from an API) could send an update with a full nested array, which the schema would accept. The spirit says "use array_scope instead."

**Question**: Should the schema strip/reject object-array keys at runtime? Or is the TS type sufficient as the contract?

## 2. `WriteOutcomeFailed.errors` allows empty array at runtime

**Type**: JSDoc says "At least one error that caused the failure."

**Schema**: `z.array(makeWriteErrorContextSchema<T>())` — no `.min(1)`.

**Type system**: `WriteErrorContext<T>[]` — no `[WriteErrorContext<T>, ...WriteErrorContext<T>[]]` tuple.

**Impact**: A failed outcome could technically have zero errors, violating the documented invariant.

## 3. `WriteStrategy.update_handler` mutation contract is ambiguous

**Deferred**: See Phase 8 (new). Custom strategies are unused. Investigation needed into whether `update_handler` should mutate or return-new, given that `writeToItemsArray` handles cloning via `getMutableItem` before calling the handler.

## 4. Scoped permission bypass for array_scope sub-calls

When `_writeToItemsArray` recurses for `array_scope`, it passes `scoped=true`, which skips `checkWritePermission`. The assumption is permissions were checked at the root level. But an `array_scope` action could potentially modify nested data the root permission check didn't cover (e.g. if permission is based on the root item's owner, but the nested array belongs to a different user).

**Question**: Is this the intended behaviour, and should tests explicitly verify this assumption?

## 5. `not-authenticated` permission reason — used by consumers, not this library

`WriteError.permission_denied.reason` includes `'not-authenticated'` in both the type and schema, but no code path in *this library* produces it. It's used by consumer codebases (e.g. website access denial). See Phase 7 for investigating extensible `WriteError` unions so consumers don't need these baked in.

## 6. `if-identical` recovery — intentional subset matching, but needs better naming/docs

`equivalentCreateOccurs` simulates applying the create + all subsequent write actions in the batch, checking at each step whether the simulated item has achieved parity with the existing item (`isMatch` = subset check). The subset check is intentional: a create that only sets `{id:'1'}` shouldn't fail against an existing `{id:'1', text:'hello'}` because it doesn't contradict anything. Recovery means: "at some point during the batch, both paths (existing item, and create + subsequent actions) converge to the same state."

**Not an intent breaker** — the semantics are correct. But the name `if-identical` is misleading. See Phase 9 for renaming/JSDoc improvements.

## 7. Minor naming inconsistencies

- Class `FailedWriteActionuresTracker` (typo: "ures") vs file name `WriteActionFailuresTracker`
- Class `SuccessfulWriteActionesTracker` (typo: "es" instead of "s")
- These are cosmetic but could confuse future readers.

## 8. `writeToItemsArrayPreserveInputType` uses unsafe cast

`return writeToItemsArray(...) as WriteToItemsArrayResult<I>` — casts `WriteToItemsArrayResult<T>` to `WriteToItemsArrayResult<Draft<T>>` without validation. If Immer `Draft<T>` doesn't perfectly align with `T` in the result types, the cast hides mismatches.

## 9. `JSON.parse(JSON.stringify(...))` used for deep cloning in trackers

Both `SuccessfulWriteActionesTracker.get()` and `FailedWriteActionuresTracker.get()` use `JSON.parse(JSON.stringify(...))`. This loses symbol properties, `undefined` values, Dates, etc. For serialisable action data this works, but it's fragile if item types ever include non-JSON-serialisable values.

# Current Tests Good Parts

## Test Files Reviewed

- `applyWritesToItems/applyWritesToItems.test.ts` (2025 lines) — main test suite
- `types.test.ts` — schema validation tests
- `applyWritesToItems/types.test.ts` — type checks (dead code)
- `applyWritesToItems/helpers/equivalentCreateOccurs.test.ts` — unit test for recovery helper
- `applyWritesToItems/helpers/checkPermission.test.ts` — permission unit tests

## Good: Intents Worth Retaining

### 1. Multi-mode execution via `testUseCases`
Runs every test across 3 modes: immutable, mutable, immer-mutable. Ensures consistent behaviour regardless of execution mode. This pattern is excellent and should be carried forward — but restructured so standard tests are mode-agnostic and mode-specific tests are separate.

### 2. Core CRUD happy paths (standard-test worthy)
- Create adds item, appears in `changes.insert` and `final_items`
- Update modifies matched item, appears in `changes.update` and `final_items`
- Delete removes matched item, appears in `changes.remove_keys` and `final_items`
- Array scope create on nested structure

### 3. Purity & referential comparison (implementation-specific, good intent)
- Immutable mode: original items unchanged, new array returned, changed objects get new references, unchanged keep same reference
- Mutable mode: same array reference, same object references mutated in place
- Tests for "no change" scenarios: unmatched where-filter → same references

### 4. Error handling (standard-test worthy)
- Schema violation → `ok:false`, correct error type, affected item reported
- Failed action identification with partial success (actions 0 succeeds, 1 fails, 2+ blocked)
- `blocked_by_action_uuid` populated on subsequent actions
- `unrecoverable` flag set for schema/integrity violations

### 5. Atomic vs non-atomic (standard-test worthy)
- `atomic:true` → complete rollback, no successes, original items unchanged
- `atomic:false` → partial success, successes + failures reported, changes reflect only successes
- Atomic rollback on `array_scope` failures

### 6. Integrity constraints (standard-test worthy)
- Duplicate PK → `create_duplicated_key` error
- PK change via update → `update_altered_key` error
- `if-identical` recovery: convergence check with subsequent actions
- `always-update` recovery: converts create to update

### 7. Permissions (standard-test worthy)
- Owner can create/update, non-owner denied
- Various permission formats (uuid ID, email, scalar array, object array)
- Ownership transfer flow
- Atomic/non-atomic with permission failures

### 8. Scalar array updates (standard-test worthy)
- Scalar arrays (`string[]`) can be set via update (not object-arrays)
- Full replacement semantics (not merge)

### 9. Regression: delete/create cycles (standard-test worthy)
- delete→create→delete→create on same PK works correctly

### 10. `checkPermission` helper tests (implementation-specific, good intent)
- Thorough coverage: 3 permission types × success/fail/edge cases
- Transfer ownership flow tested independently

## Bad: What to Fix or Discard

### 1. Implementation-coupled test names and structure
- Tests say "Immer", "mutable", "immutable" in describe names — these are `writeToItemsArray` execution modes, not standard-test concepts
- `cx.skip()` conditionals scattered through tests based on mode — makes it unclear which tests apply to which modes

### 2. `types.test.ts` / `applyWritesToItems/types.test.ts` — weak type assertions
- `types.test.ts`: constructs WriteAction instances and validates against schema — a mix of runtime + type check, but no `expectTypeOf`, `@ts-expect-error`, or `Expect<Equal>`. No negative type cases.
- `applyWritesToItems/types.test.ts`: dead `typeCheck()` function never called. Just DDL construction — useful as a type check during build, but not a proper test.

### 3. Missing coverage
- No test for update method `'assign'` (only `'merge'` tested)
- No test for `VALUE_TO_DELETE_KEY` (deleting a key by setting to `undefined`)
- No test for empty actions array → should return ok with no changes
- No test for update targeting 0 items (where-filter matches nothing)
- No test for `changes.changed` boolean
- No test for `getWriteErrors()` helper
- No test for `WriteToItemsArrayResult` being always flat (not discriminated)
- No negative type tests (e.g. `@ts-expect-error` for object-array in update data)

# Learn From Where-Filter: Best Practices To Keep

## Standard Tests (`standardTests.ts`)

### Architecture: Adapter-Injected Shared Tests

The function `standardTests(config)` is exported and takes a `StandardTestConfig`:
```ts
type StandardTestConfig = {
    test: jest.It,
    expect: jest.Expect,
    matchJavascriptObject: MatchJavascriptObjectInTesting,
    implementationName?: string
}
```

Each applier wires up its own adapter function and passes it in. Examples:
- **JS** (`matchJavascriptObject.test.ts`): wraps the real function directly.
- **SQLite** (`sqliteWhereClauseBuilder.test.ts`): creates an in-memory SQLite DB per test, inserts the object as JSON, runs the built WHERE clause, returns `rows.length > 0`. Returns `undefined` for unsupported operations.

**Key instruction**: The standard test function takes an adapter that abstracts the "how" (JS match, SQL query, etc.) behind a common signature. Each test calls the adapter with (object, filter, schema) and asserts the boolean result. The adapter owns setup/teardown (e.g. creating a fresh DB table per test).

**Important difference for write-actions**: Where-filter tests are simple predicate checks (object + filter → boolean). Write-action tests are more involved — the adapter must support a 3-phase lifecycle per test:
1. **Setup**: Pre-fill the data source with initial items (e.g. insert rows into a table, or provide an initial JS array).
2. **Execute**: Apply the write action(s) via the implementation under test.
3. **Verify**: Go back to the data source independently to confirm the items are as expected (e.g. SELECT from the table, or inspect the returned array). This must not rely on the WriteResult alone — it must verify the actual data source was mutated correctly.

Teardown is implicit (fresh data source per test). The adapter signature will be richer than where-filter's — it needs to accept initial items, actions, DDL, schema, and options, and return both the WriteResult and a way to query the final state of the data source.

### Handling Cross-Implementation Divergence

Two helper functions handle the reality that not all implementations support everything:

1. **`expectOrAcknowledgeUnsupported(result, expected, reason?)`** — If result is `undefined` (adapter returned "unsupported"), logs a warning and skips. Otherwise asserts `result === expected`. Use for features an implementation may not support.

2. **`expectOrAcknowledgeDivergence(result, expected, reason)`** — If result differs from expected, logs a warning instead of failing. Use for known semantic differences (e.g. SQLite LIKE is case-insensitive for ASCII while JS `includes` is case-sensitive).

**Key instruction**: Use `undefined` return from adapter to signal "not supported". Use divergence helpers for known cross-impl differences. Standard tests should never skip silently — always log what was acknowledged.

### Describe Structure: Numbered Domain Sections

Tests are organised into numbered top-level `describe` blocks representing spec domains:
1. Filter forms (partial object, logic: $and/$or/$nor, implicit $and, mixed)
2. Scalar value comparisons (equality, range, $contains, $ne, $in/$nin, $not, $exists, $type, $regex, null)
3. Array comparisons (exact match, scalar element match, compound object, logic on elements, $elemMatch, $in/$nin on array, $all, $size, nesting)
4. Dot-prop paths and array spreading

Within each, sub-`describe` blocks group by operator or concept. Each test is a pass/fail pair with DAMP naming: `'exact scalar match via dot-prop path: passes'` / `'...fails'`.

**Key instruction**: Structure standard tests as numbered domain sections mirroring the spec. Group by concept, not implementation. Every assertion has a matching negative (pass + fail pair).

### Test Shape: Pure Input → Output

Every test follows the same shape:
1. Construct data inline (no shared mutable state)
2. Call the adapter
3. Assert with `expectOrAcknowledgeUnsupported` or `expectOrAcknowledgeDivergence`

No mocks, no shared setup between tests, no conditional skips based on mode. Each test is self-contained.

### Shared Schemas as Test Fixtures

Schemas are defined at module scope and reused: `ContactSchema`, `FormzSchema`, `NullableAgeContactSchema`, `BooleanContactSchema`, `SpreadNestedSchema`. These cover common shapes (nested objects, optional fields, arrays, nullable, boolean).

**Key instruction for write-actions**: Define shared test schemas + DDLs at module scope. Each applier's adapter test file imports the standardTests function and provides its own adapter. Schemas should cover: flat objects, nested objects, object-arrays (for array_scope), optional fields, scalar arrays.

### Edge Cases and Boundary Tests

The standard tests systematically cover boundaries:
- Empty arrays, empty lists, missing/undefined fields
- Exact boundary values ($gte at exact, $gt at exact)
- Type mismatches (number range on string → throws or returns false)
- Null handling
- Case sensitivity

**Key instruction**: For write-actions, systematically cover: empty actions array, update matching 0 items, create with missing PK, update that would set PK, array_scope on empty nested array, schema validation post-mutation failures.

## Type Assertion Tests (`types.test.ts`)

### What It Does Well

- Tests `WhereFilterDefinition<T>` for correct key inference and type narrowing
- Uses `@ts-expect-error` for negative assertions: wrong value types, unknown keys, wrong comparison operator types
- Tests discriminated union narrowing (properties that exist on some but not all variants)
- Tests type guard narrowing (`isPartialObjectFilter`, `isLogicFilter`)
- Documents known limitations as `describe('TODO - desirable features')` with inline comments explaining what's broken and why

### Structure

- Standalone `it()` blocks for each type assertion, not nested deeply
- Each test constructs a const of the target type — compilation success = positive assertion
- `@ts-expect-error` on the line above the assignment for negative assertions
- Complex regression tests use realistic domain types (not toy types)

### Key Instructions for Write-Action Type Tests

1. **Positive assertions**: Construct valid `WritePayload<T>` / `WriteAction<T>` / `WriteResult<T>` — if it compiles, the type accepts it
2. **Negative assertions with `@ts-expect-error`**:
   - Object-array property in `WritePayloadUpdate.data` → must error
   - Wrong PK type in where-filter → must error
   - Invalid `WriteError.type` discriminant → must error
   - `WriteOutcomeOk` accessing `.errors` → must error
3. **Discriminated union narrowing**: After checking `outcome.ok`, verify correct narrowing (`.errors` on failed, `.affected_items` on ok)
4. **Generic inference**: Verify `WritePayload<T>` correctly constrains `data`, `where`, and `scope` based on `T`
5. **Exhaustiveness**: Switch on `WriteError.type` — unhandled case should resolve to `never`
6. **Document known gaps**: Use `@ts-ignore` + comment for known type limitations, not silent `as any`

# Implementation Plan

## File Structure

```
src/write-actions/
  standardTests.ts              ← shared standard tests (adapter-injected)
  types.test.ts                 ← compile-time type assertion tests (rewrite)
  applyWritesToItems/
    applyWritesToItems.test.ts  ← rewrite: wires adapter + calls standardTests + implementation-specific tests
    types.test.ts               ← delete (dead code, replaced by root types.test.ts)
```

## Part A: Standard Tests (`standardTests.ts`)

### Adapter Signature

The adapter follows the same per-test lifecycle as where-filter's `standardTests`: each test independently sets up a fresh data source, executes, and verifies against that data source. The `standardTests` function receives a **factory** so it can create correctly-typed adapters for each test schema internally.

```ts
/** Each test calls adapter.apply() once. The adapter must:
 *  1. Setup: create a fresh data source pre-filled with initialItems
 *  2. Execute: apply writeActions via the implementation under test
 *  3. Return: WriteResult + an independent read-back of the data source
 */
type WriteTestAdapter<T extends Record<string, any>> = {
  apply: (config: {
    initialItems: T[],
    writeActions: WriteAction<T>[],
    schema: ZodSchema<T>,
    ddl: DDL<T>,
    user?: IUser,
    options?: { atomic?: boolean },
  }) => Promise<{
    result: WriteResult<T>,
    changes: WriteChanges<T>,
    /** Independent read of the data source AFTER execution (NOT from WriteResult) */
    finalItems: T[],
  } | undefined>  // undefined = this implementation doesn't support this operation
}

/** Factory: standardTests creates adapters per schema/DDL internally */
type AdapterFactory = <T extends Record<string, any>>(
  schema: ZodSchema<T>,
  ddl: DDL<T>
) => WriteTestAdapter<T>

type StandardTestConfig = {
  test: typeof test,
  expect: typeof expect,
  createAdapter: AdapterFactory,
  implementationName?: string,
}
```

For `writeToItemsArray`, the factory creates a fresh clone of `initialItems` per call and reads back `result.changes.final_items` as the independent verification. For a future SQL applier, the factory would create a fresh in-memory table, INSERT the initial items, run the applier, then SELECT to get `finalItems`.

### Helper Functions

- `expectOrAcknowledgeUnsupported(result, assertion, reason?)` — if adapter returned `undefined`, log + skip. Else run assertion.
- ~~`expectOrAcknowledgeDivergence`~~ **Removed** (Gemini review): allowing assertions to fail gracefully hides regressions. Implementations should either pass or return `undefined` (unsupported). Known semantic differences must be handled by the adapter's normalization layer, not by weakening assertions.

### Test Schemas & DDLs (module-scope fixtures)

1. **FlatSchema** — `{id: string, text?: string, count?: number, tags?: string[]}` + DDL with PK `'id'`, permissions `'none'`
2. **NestedSchema** — `{id: string, children: {cid: string, name?: string, items: {iid: string, value?: number}[]}[]}` + DDL with nested lists on `'children'` and `'children.items'`
3. **OwnerSchema** — `{id: string, text?: string, owner_id?: string}` + DDL with `basic_ownership_property` permissions (format uuid, path `'owner_id'`)
4. **OwnerEmailSchema** — same but `format: 'email'`, path `'owner_email'`
5. **OwnerScalarArraySchema** — `{id: string, owner_ids?: string[]}` + DDL with `id_in_scalar_array` permission type

### Describe Structure (numbered domain sections)

```
standardTests
  1. Core Verbs
    1.1 Create
      - creates a new item (happy path): item in finalItems, in changes.insert, result.ok
      - create with all optional fields populated
      - create with only required fields (PK)
      - multiple creates in one batch
    1.2 Update
      - updates matching item (happy path): item in finalItems changed, in changes.update
      - update with where-filter matching multiple items: all updated
      - update with where-filter matching zero items: no changes, still ok
      - partial update merges (default 'merge' method): untouched fields preserved
      - update method 'assign': shallow replacement
      - scalar array property can be set via update (full replacement, not merge)
      - VALUE_TO_DELETE_KEY: setting a property to undefined removes it
    1.3 Delete
      - deletes matching item (happy path): removed from finalItems, PK in changes.remove_keys
      - delete with where-filter matching multiple items: all removed
      - delete with where-filter matching zero items: no changes, still ok
    1.4 Array Scope
      - creates item in nested object-array
      - updates item in nested object-array
      - deletes item from nested object-array
      - deeply nested array_scope (2+ levels: children.items)
      - array_scope on empty nested array: no-op, still ok
      - array_scope where-filter matches zero parent items: no-op, still ok
      - array_scope where-filter matches multiple parent items: sub-action applied to all matched parents
      - constraint violation inside array_scope (e.g. duplicate PK in nested array): halts parent execution

  2. Result Shape
    2.1 WriteResult structure
      - result.ok is true on full success
      - result.ok is false when any action fails
      - result.actions length matches input actions length
      - empty actions array → ok:true, no changes, changes.changed === false
    2.2 WriteOutcome (per-action)
      - successful action: ok:true, action uuid matches, affected_items present
      - affected_items contains correct PKs for each verb
      - action uuid and ts from input are preserved in outcome
      - failed outcome always has at least one error (Breaker #2 enforcement)
    2.3 WriteChanges
      - changes.changed is true when mutations occurred
      - changes.changed is false when no mutations occurred
      - changes.insert/update/remove_keys are correct for mixed-verb batches

  3. Error Handling
    3.1 Schema validation
      - create violating schema → ok:false, error type 'schema', unrecoverable:true
      - update producing schema-invalid result → ok:false, error type 'schema'
      - error includes item_pk and item context
    3.2 Primary key integrity
      - create with duplicate PK → error type 'create_duplicated_key'
      - create missing PK → error type 'missing_key'
      - update that changes PK → error type 'update_altered_key'
    3.3 Helpers
      - getWriteFailures returns only failed outcomes
      - getWriteSuccesses returns only successful outcomes
      - getWriteErrors returns flat array of all errors across outcomes

  4. Sequential Halt & Blocking
    - first failure halts processing of subsequent actions
    - subsequent actions get ok:false with blocked_by_action_uuid set to failing action's uuid
    - successful actions before the failure are reported as successes (non-atomic)

  5. Atomic vs Non-Atomic
    5.1 Non-atomic (default)
      - partial success: earlier successes kept, later blocked
      - changes reflect only the successful mutations
      - finalItems reflect only the successful mutations
    5.2 Atomic
      - on failure: all actions fail, changes.changed is false
      - finalItems match original items (complete rollback — verified via independent data source read, not just WriteResult)
      - result.ok is false, no successes reported
    5.3 Atomic + array_scope
      - failure in nested scope rolls back everything (atomic)
      - failure in nested scope keeps prior successes (non-atomic)

  6. Duplicate Create Recovery
    6.1 'never' (default)
      - duplicate PK always fails
    6.2 'if-identical'
      - recovers when create data is subset of existing item
      - fails when create data contradicts existing item
      - recovers when subsequent actions in batch bring items to convergence
    6.3 'always-update'
      - converts duplicate create to update, succeeds

  7. Permissions
    7.1 No permissions (type: 'none')
      - all writes succeed without user
    7.2 Basic ownership (id property)
      - owner can create (owner_id matches user)
      - owner can update
      - non-owner create denied → error type 'permission_denied', reason 'not-owner'
      - non-owner update denied
      - no user provided → reason 'no-owner-id'
    7.3 Ownership formats
      - uuid format: matches getUuid()
      - email format: matches getEmail()
      - scalar array: user ID found in array at path
    7.4 Permissions on array_scope
      - owner can create/update via array_scope
      - non-owner denied for array_scope operations
      (Test top-level enforcement only — how sub-calls handle permission is an implementation detail)
    7.5 Permissions + atomic/non-atomic
      - non-atomic: actions before permission failure kept
      - atomic: permission failure rolls back everything

  8. Runtime Enforcement
    - update with object-array property in data: rejected at runtime (not just compile-time)
      (tests Breaker #1 — schema must strip/reject object-array keys)

  9. Edge Cases & Regression
    - delete → create → delete → create on same PK works
    - create + update in same batch targeting same PK: both succeed sequentially
    - many actions in one batch (10+): all processed correctly
    - deeply nested array_scope (3+ levels): processes without stack overflow
```

### Implementation Notes

- Each `test()` is self-contained: inline data, call `adapter.apply()`, assert. No shared mutable state between tests.
- Every assertion has a matching negative where applicable (pass + fail pair).
- Use `expectOrAcknowledgeUnsupported` for features that may not apply to all appliers (e.g. VALUE_TO_DELETE_KEY, specific merge methods).
- All schemas/DDLs are defined at module scope. `standardTests` creates adapters via `createAdapter(schema, ddl)` per section.
- The `standardTests(config)` function receives `{test, expect, createAdapter, implementationName}` — same injection pattern as where-filter.

---

## Part B: Implementation-Specific Tests (in `applyWritesToItems.test.ts`)

These test behaviours unique to `writeToItemsArray` that don't generalise to SQL or other appliers.

### Adapter Wiring

```ts
// Factory: creates a fresh adapter for any schema/DDL
// Maps generic standard-test options to implementation-specific options
const createAdapter: AdapterFactory = (schema, ddl) => ({
  apply: async ({ initialItems, writeActions, user, options }) => {
    // Fresh clone per test — each call gets its own data source
    const items = structuredClone(initialItems);
    const result = writeToItemsArray(writeActions, items, schema, ddl, user, {
      atomic: options?.atomic,
    });
    return {
      result,
      changes: result.changes,
      finalItems: result.changes.final_items,
    };
  }
});

describe('writeToItemsArray', () => {
  describe('standard tests', () => {
    standardTests({ test, expect, createAdapter, implementationName: 'writeToItemsArray' });
  });
  // ... implementation-specific tests below
});
```

`standardTests` internally calls `createAdapter(FlatSchema, flatDdl)`, `createAdapter(NestedSchema, nestedDdl)`, etc. as needed per test section. Each `adapter.apply()` call within a test gets a completely fresh data source (same as where-filter).

### Implementation-Specific Describe Structure

```
writeToItemsArray
  standard tests (via standardTests())

  implementation-specific
    1. Execution Modes (testUseCases pattern — run each test across 3 modes)
      1.1 Immutable mode (default)
        - returns new array reference (not ===)
        - original items array is unmodified
        - unchanged items keep same reference (=== original)
        - changed items get new reference (!== original)
      1.2 Mutable mode (mutate: true)
        - returns same array reference
        - items are mutated in-place (=== original reference)
      1.3 Immer compatibility (mutate: true inside produce)
        - works inside immer produce
        - draft items are accessible during produce
        - throws if mutate:false + immutable mode conflict
    2. Referential Stability (React-friendly shallow comparison)
      - mixed success/fail non-atomic: only affected items get new references
      - no-op batch: all references preserved
      - atomic rollback: all references preserved (original state)
    3. WriteToItemsArrayResult extras
      - changes.final_items present and correct
      - writeToItemsArrayPreserveInputType preserves Draft<T> in return type
```

### Migration from Current Tests

- Retain `testUseCases` pattern for mode-specific tests only
- Move all intent-level tests (CRUD, errors, atomic, permissions, integrity) into standardTests
- Keep Immer-specific tests, referential-comparison tests, and mode-crossing tests in implementation-specific
- Delete `applyWritesToItems/types.test.ts` (dead code)

---

## Part C: Type Assertion Tests (rewrite `types.test.ts`)

### Describe Structure

```
write-actions type assertions
  1. WritePayload<T> construction
    1.1 Create payload
      - accepts valid T as data ✓
      - @ts-expect-error: rejects extra properties not in T
      - @ts-expect-error: rejects wrong type for a known property
    1.2 Update payload
      - accepts Partial<T> (subset of fields) ✓
      - accepts scalar array properties (e.g. tags: string[]) ✓
      - @ts-expect-error: rejects object-array properties (e.g. children) in data
      - @ts-expect-error: rejects unknown properties
      - where-filter is correctly typed to T's keys
    1.3 Delete payload
      - accepts valid where-filter ✓
      - @ts-expect-error: rejects where-filter with unknown keys
    1.4 Array scope payload
      - accepts valid scope path (dot-prop to object-array) ✓
      - scoped action is correctly typed to the nested element type ✓
      - @ts-expect-error: rejects invalid scope path
      - @ts-expect-error: rejects scope path to scalar array
      - works with optional nested arrays (T['children']?)

  2. WriteAction<T> envelope
    - accepts valid {type:'write', ts, uuid, payload} ✓
    - @ts-expect-error: rejects missing uuid
    - @ts-expect-error: rejects missing ts

  3. WriteResult<T> / WriteOutcome<T> narrowing
    3.1 WriteOutcome discriminated union
      - after checking ok:true → .affected_items accessible
      - after checking ok:false → .errors accessible, .blocked_by_action_uuid accessible
      - @ts-expect-error: .errors not accessible without narrowing on ok:false
    3.2 WriteResult is NOT discriminated
      - result.ok, result.actions always accessible regardless of ok value
      - result.actions[0] requires narrowing before accessing .errors

  4. WriteError discriminated union
    4.1 Narrowing on type
      - type:'schema' → .issues accessible
      - type:'permission_denied' → .reason accessible
      - type:'custom' → .message accessible
      - @ts-expect-error: .issues not accessible on type:'custom'
    4.2 Exhaustiveness
      - switch on all WriteError.type variants → unhandled resolves to never

  5. DDL<T> type constraints
    - lists['.'] requires keys of T for primary_key and order_by
    - @ts-expect-error: unknown property name as primary_key
    - nested list keys match DotPropPathToObjectArraySpreadingArrays<T>
    - @ts-expect-error: scalar array path as list key

  6. Helper function return types
    - getWriteFailures: returns WriteOutcomeFailed<T>[]
    - getWriteSuccesses: returns WriteOutcomeOk<T>[]
    - getWriteErrors: returns WriteErrorContext<T>[]
    - WriteAffectedItem<T>: returned item shape narrows correctly based on input schema

  7. Path & Property Type Helpers
    - DotPropPathToObjectArraySpreadingArrays<T>: correctly infers paths for complex nested schemas
    - NonObjectArrayProperty<T>: Expect<Equal> — exactly the non-object-array keys of T
    - @ts-expect-error: object-array key is not in NonObjectArrayProperty<T>

  8. Schema ↔ Type alignment (bidirectional)
    - z.infer of WriteActionSchema satisfies WriteAction<any>
    - z.infer of WriteResultSchema satisfies WriteResult<any>
    - z.infer of WriteOutcomeSchema satisfies WriteOutcome<any>
    - z.infer of WriteErrorSchema satisfies WriteError
```

### Implementation Notes

- Use `expectTypeOf` (vitest) for positive type assertions where possible
- Use `@ts-expect-error` on the line above for negative assertions
- Use `Expect<Equal<A, B>>` pattern (from type-fest or inline) for exact equivalence
- Each `it()` block tests one type assertion — small, named by intent
- Use realistic domain types (not `{a: string}` toys)
- No runtime assertions needed — compilation success/failure IS the test

---

## Execution Order

1. Create `standardTests.ts` with adapter types, helper functions, test schemas/DDLs, and all standard test cases
2. Rewrite `applyWritesToItems.test.ts`: wire adapter, call `standardTests()`, add implementation-specific tests
3. Rewrite `types.test.ts` with comprehensive type assertions
4. Delete `applyWritesToItems/types.test.ts`
5. Run `bun typecheck`, `bun test`, `bun lint` — fix failures
6. Iterate: any standard test failure may reveal an actual bug vs a test design issue — investigate before fixing

## Resolved Decisions

1. **Adapter factory**: `standardTests` takes `createAdapter: AdapterFactory` — a factory `<T>(schema, ddl) => WriteTestAdapter<T>`. Each test section creates its own adapter for the needed schema. Each `adapter.apply()` call gets a fresh data source (same lifecycle as where-filter).
2. **Runtime enforcement of object-array exclusion** (Breaker #1): Standard tests WILL assert that object-array properties in update data are rejected at runtime, not just at compile time. Section 8 added.
3. **Permissions on array_scope**: Tests assert top-level permission enforcement on array_scope operations. We do NOT test whether recursive sub-calls skip permission checks — that's an implementation detail. A future SQL applier checking permissions differently internally should still pass these tests.
4. **Adapter options are generic** (Gemini review): Standard test adapter uses `{ atomic?: boolean }` — not `WriteToItemsArrayOptions<T>`. JS-specific options like `mutate` belong in implementation-specific tests only. Each adapter maps generic options to its implementation's API.
5. **No `expectOrAcknowledgeDivergence`** (Gemini review): Removed. Assertions must pass or be explicitly unsupported (`undefined`). Semantic differences between implementations are the adapter's responsibility to normalize, not the test framework's to suppress.
6. **Structure stays domain-separated** (Gemini review, rejected): Duplicate Create Recovery (section 6) stays separate from Create — it's a DDL-level concern, not a basic verb test. PK integrity (3.2) stays in Error Handling — error types form their own searchable domain. `array_scope` fragmentation across sections is intentional (cross-cutting concerns tested where they interact).
7. **Gemini gap additions incorporated**: `array_scope` zero/multiple parent targeting (1.4), nested constraint violations in `array_scope` (1.4), envelope metadata preservation (2.2), failed outcome minimum-one-error enforcement (2.2), deep recursion edge case (9), additional type assertions for `DotPropPath`, `NonObjectArrayProperty`, `WriteAffectedItem` (Part C sections 6-7).



# Project Plan

_Instructions: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Read around Write Actions and capture the spirit of what they're doing: the write payload types, the response types, and a concrete example in `applyWritesToItems` (but remember there will later be other applier functions). 

The goal here is to capture the intent of what the library is doing, so it can be tested. Consider different stake holders and their desired use cases.

Output this research to `Spirit of Write Actions`. 

# [x] Phase 2

Analyse the current code base for write-actions and look for types and function implementations that would appear to have parts that break the intent/spirit of the overall library. 

The goal here is to weed out inconsistencies, and have a discussion about anything that doesn't look right before we codify them into tests. 

Output anything found to `Possible Breakers of Intent in Types and Implementations` (may be nothing).

# [x] Phase 3

Analyse the current tests for `applyWritesToItems` and the type assertion tests. Conscisely record which tests were good (according to our criteria) and the intent of the tests should be retained going forward. 

Output to `Current Tests Good Parts` 

# [x] Phase 4

Look at how the Where-Filter tests are structured @../where-filter/standardTests.ts. These were done specifically to capture the intent of that where-filter module, breaking it up into describe blocks. This is an example of good practice. 

Note how it works: each apply function setting up the tests (e.g. a sqlite table) and for each test (e.g. setting initial data in a fresh table), then executing the test on the function and assessing whether when run (directly in the case of applyWritesToItems; or have SQL executed in the case of writeActionToSql), the data source (table, raw JS) has been correctly modified. Note how `{ status: 'unsupported' }` is used. 

I want you to capture a conscise imperative set of instructions of what made it a good test suite, with examples - to dictate to our own planning here. 
Also capture any specific tests/sections that represent a good idea to use here. 

Then do the same for type assertion tests. 

Output this to `Learn From Where-Filter: Best Practices To Keep`

# [x] Phase 5

Write a plan for generating much better tests:
- standardTests (capture the spirit of the spec of Write Actions - would work across JS, SQL, etc. appliers)
- specific implementation tests (e.g. the immer parts of `applyWritesToItems`)
- type assertion tests (matching the spirit of the spec of Write Actions)

Make use of `Reminder: Good Testing Practices`, `Spirit of Write Actions`, `Current Tests Good Parts`, `Learn From Where-Filter: Best Practices To Keep`, `Possible Breakers of Intent in Types and Implementations`. 


Output to `Implementation Plan`.

# [x] Phase 5a

Pass plan to Gemini for feedback. Output me the current implementation plan, and additional context it needs (e.g. relevant types, spirit of library), and a request to conscisely critique. 

# [x] Phase 5b

Update plan with this response from Gemini with critiques/suggestions, asking me questions about anything you don't agree with: 
```markdown 


### 1. Gaps (Missing Test Cases & Invariants)
- **`array_scope` targeting:** Missing tests for when `array_scope` matches zero parent items, or when its where-filter matches *multiple* parent items (does it apply to all?).
- **Nested failures:** Missing tests for constraint violations *inside* an `array_scope` (e.g., duplicate PK in the nested array) and ensuring they halt parent execution.
- **Empty error arrays:** No test verifying that `WriteOutcomeFailed.errors` guarantees at least one error at runtime (addressing Known Intent Breaker 2).
- **Envelope metadata:** No test verifying that `uuid` and `ts` are correctly preserved and passed through to the `WriteOutcome`.
- **Atomic rollback verification:** Needs explicit checks ensuring the underlying data store genuinely rolled back (not just checking the returned `WriteResult`).

### 2. Adapter Design
- **Leaked abstractions:** `WriteToItemsArrayOptions<T>` contains JS-specific options like `mutate`. The adapter interface should either use generic options (e.g., `atomic` only) or accept an extensible `<Options>` generic.
- **Test isolation:** The factory pattern assumes synchronous, memory-isolated execution. For DB implementations (SQL), tests running concurrently will collide unless the factory automatically handles unique table generation or isolated transactions per `apply` call.
- **Data normalization:** `finalItems` read-backs will cause flaky tests across implementations due to serialization differences (e.g., JS `Date` objects vs SQL timestamp strings). The adapter needs a strict serialization/normalization boundary.

### 3. Structure
- **Redundancy:** "Duplicate Create Recovery" (6) should just be a sub-section of "Create" (1.1). 
- **Overlap:** "Primary key integrity" errors (3.2) overlaps with Core Verbs (1.1, 1.2). Test rules under the Verb they apply to, rather than grouping by error type.
- **Fragmentation:** `array_scope` tests are scattered across 1.4, 5.3 (Atomic), and 7.4 (Permissions). Grouping cross-cutting concerns is fine, but be careful not to dilute the definition of how `array_scope` works. 

### 4. Type Assertion Coverage (Part C)
- **`WhereFilterDefinition<T>`:** Missing assertions to prove users cannot query against non-existent properties or complex nested object-arrays.
- **`NonObjectArrayProperty<T>`:** Needs strict negative assertions verifying that object-arrays are completely stripped from `Update` payloads (addressing Intent Breaker 1).
- **`DotPropPath...` helpers:** Needs explicit assertions for the path-string inference to ensure deep dot-notation typings don't break on complex schemas.
- **`WriteAffectedItem<T>`:** Missing checks to ensure the returned item shapes correctly narrow based on the input schema.

### 5. Risks
- **`expectOrAcknowledgeDivergence` is an anti-pattern:** Allowing assertions to "fail gracefully" as a warning hides regressions. Implementations should either explicitly `.skip()` unsupported tests or fix the divergence.
- **Database setup overhead:** Dynamically provisioning schemas (e.g., `CREATE TABLE`) per test case for 50+ standard tests will massively slow down SQL implementations. The adapter might need a bulk-setup/teardown hook.
- **Deep recursion stack overflow:** `array_scope` allows recursive payloads. Without a maximum depth check or test, the applier is at risk of maximum call stack exceptions on cyclic or deeply nested actions.

```

# [x] Phase 6

Implement the plan in `Implementation Plan`

**Files created/modified:**
- `src/write-actions/standardTests.ts` — Shared standard tests with adapter-injected pattern. Contains adapter types (`WriteTestAdapter`, `AdapterFactory`, `StandardTestConfig`), 5 test schemas/DDLs (Flat, Nested, OwnerUuid, OwnerEmail, OwnerScalarArray), `expectOrAcknowledgeUnsupported` helper, and 8 numbered domain sections (Core Verbs, Result Shape, Error Handling, Sequential Halt & Blocking, Atomic vs Non-Atomic, Duplicate Create Recovery, Permissions, Edge Cases & Regression). 63 standard tests.
- `src/write-actions/applyWritesToItems/applyWritesToItems.test.ts` — Rewritten to wire adapter + call `standardTests()` + implementation-specific tests. 4 implementation-specific sections (Execution Modes with immutable/mutable/Immer, Referential Stability, WriteToItemsArrayResult extras, Immer edge cases). 22 implementation-specific tests + 63 standard tests = 85 total.
- `src/write-actions/types.test.ts` — Comprehensive rewrite with 44 type assertion tests across 8 sections (WritePayload construction, WriteAction envelope, WriteResult/WriteOutcome narrowing, WriteError discriminated union, DDL type constraints, helper function return types, path & property type helpers, schema-type alignment). Uses `@ts-expect-error` for negative assertions, `isTypeEqual` for schema-type bidirectional checks.
- `src/write-actions/applyWritesToItems/types.test.ts` — Deleted (dead code).

**Test counts:** 149 tests in write-actions (85 + 44 + 19 checkPermission + 1 equivalentCreateOccurs). 956 total tests across 20 files, all passing.

# [x] Phase 7 (post-testing)

**Investigate extensible `WriteError` union for consumers.**

Currently `not-authenticated` is baked into the `WriteError` type/schema in this library, but it's only used by consumer codebases. This is a design smell — consumers shouldn't need library changes to add domain-specific error reasons.

Tasks:
- Investigate making `WriteError` extensible (e.g. generic parameter for additional error types, or an `'extension'` variant with a string code).
- Consider whether `not-authenticated` should be removed from the core union and instead added by the consumer's extension.
- Ensure backward compatibility for existing consumers.

**Resolution:**

Approach chosen: **Remove `'not-authenticated'` + widen reason with `(string & {})`**.

- Extracted `CorePermissionDeniedReason` type (`'no-owner-id' | 'not-owner' | 'unknown-permission' | 'invalid-permissions' | 'expected-owner-email'`) — the 5 reasons this library actually produces.
- Changed `permission_denied.reason` to `CorePermissionDeniedReason | (string & {})` — preserves IDE autocomplete for core reasons while allowing consumers to pass any string (e.g. `'not-authenticated'`).
- Schema uses `z.string()` for reason — accepts any string at runtime validation.
- `CorePermissionDeniedReason` exported from barrel for consumers who want to reference the known set.
- `isTypeEqual<z.infer<typeof WriteErrorSchema>, WriteError>(true)` still passes — both sides are structurally `string`.
- All 149 write-actions tests pass, no new typecheck errors.

**Consumer migration** (breaking): `breef/store`'s `ExtensionContentToBackgroundDatabase.ts:84` uses `reason: 'not-authenticated'` — this still works at runtime (string is accepted) and at the type level (widened union accepts it). No changes needed in consumers.

**Files modified:**
- `src/write-actions/types.ts` — Extracted `CorePermissionDeniedReason`, widened `permission_denied.reason`
- `src/write-actions/write-action-schemas.ts` — Changed reason schema to `z.string()`
- `src/write-actions/index.ts` — Exported `CorePermissionDeniedReason`

# [x] Phase 8 (post-testing)

**Investigate `WriteStrategy.update_handler` mutation vs immutability contract.**

The LWW handler mutates `target` in-place and returns it. The `WriteStrategy` interface doesn't document whether handlers must mutate or may return a new object.

Initial findings from code analysis:
- `writeToItemsArray` calls `getMutableItem(item, objectCloneMode)` *before* passing to `update_handler`. In `clone` mode, `target` is already a clone — so mutation is safe. In `mutate` mode, `target` is the original — mutation is the whole point.
- The caller reassigns `mutableUpdatedItem = writeStrategy.update_handler(...)` so it *would* work with a return-new handler in clone mode. But in mutate mode, a return-new handler would silently break the contract (original item unchanged, new object discarded after leaving scope in some paths).
- Suspicion: mutation is correct because `writeToItemsArray` owns the cloning decision, and the handler should be a fast in-place transform. The handler returning the same reference is a convenience, not the primary mechanism.

**Resolution:**

Changed `update_handler` to return `void` to make the mutation contract explicit:

1. **`applyWritesToItems/types.ts`** — `WriteStrategy.update_handler` signature changed from `=> T` to `=> void`. Added JSDoc: "MUST mutate `target` in-place — the caller owns the cloning decision."
2. **`writeStrategies/lww.ts`** — Removed `return target;` from `update_handler`.
3. **`applyWritesToItems.ts`** — Removed return-value capture and reassignment. Now calls `writeStrategy.update_handler(...)` as void, then validates `mutableUpdatedItem` directly.
4. **`applyWritesToItems.test.ts`** — Added 2 implementation-specific tests (section 4: WriteStrategy mutation contract):
   - Mutable mode: verifies original object is mutated in-place and is the same reference in final_items
   - Immutable mode: verifies original is untouched, clone was mutated

All 151 tests pass. Custom strategies remain internal and unused (not exported from barrel).

# [x] Phase 9 (post-testing)

**Rename `if-identical` duplicate create recovery to `if-convergent` and improve JSDoc.**

Renamed `'if-identical'` → `'if-convergent'` across the library. The old name was misleading — the semantics are subset-convergence, not strict identity.

**Files modified:**
- `src/write-actions/applyWritesToItems/types.ts` — Renamed string literal in `WriteToItemsArrayOptions.attempt_recover_duplicate_create` union. Rewrote JSDoc to explain the simulation algorithm, subset check (`isMatch` not `isEqual`), and why subset is correct.
- `src/write-actions/applyWritesToItems/applyWritesToItems.ts` — Updated runtime comparison and JSDoc references.
- `src/write-actions/applyWritesToItems/helpers/equivalentCreateOccurs.ts` — Added comprehensive JSDoc explaining the step-by-step algorithm, the subset rationale, and an `@example` showing convergence.
- `src/write-actions/standardTests.ts` — Updated adapter type signature, describe block name, all option values, and acknowledgement strings.

**Consumer migration** (breaking): 3 files in `breef/store` use `'if-identical'` and must be updated to `'if-convergent'`:
- `store/src/collection/raw-store/implementations/memory-raw-store/MemoryRawStore.ts:291`
- `store/src/collection/raw-store/implementations/sql-raw-stores/common/objects-strategy/read-modify-write/ReadModifyWrite.ts:113`
- `store/src/collection/implementations/inbuilt/test-dumb-shared-user/TestDumbSharedUser.ts:163`

All 151 write-actions tests pass.