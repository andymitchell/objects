# Goal

Update ./planning-testing/proposed-test-structure.md to resolve these conflicts with the live code base.

# Conflicts

### CONFLICT 1: `standardTests.ts` — Jest types instead of Vitest
- **Skeleton:** `StandardTestConfig` uses `jest.It` and `jest.Expect` (line 22-23)
- **Implementation:** Project uses Vitest (vitest, not jest)
- **Why it won't work:** Type mismatch — `jest.It` vs vitest's `it`
- **Hypothesis:** Replace with Vitest equivalents. Trivial fix. Intent unaffected.
- **Decision / Action**: Use vitest

### CONFLICT 2: `standardTests.ts` — `SortAndSlice` missing type parameter
- **Skeleton:** `Execute` type uses `SortAndSlice` without `<T>` (line 17)
- **Implementation:** `SortAndSlice<T>` requires a type parameter (`types.ts:72`)
- **Why it won't work:** Won't compile without the generic parameter
- **Hypothesis:** Use `SortAndSlice<T>` in the `Execute` type. Trivial fix.
- **Decision / Action**: Use generic

### CONFLICT 3: `standardTests.ts` — Nested Properties test incompatible with `prepareColumnTableQuery` adapters
- **Skeleton:** "sorts by a dot-prop path into nested objects" (line 92-96) is in `standardTests` shared by ALL 5 adapters
- **Implementation:** `prepareColumnTableQuery` uses column names directly via `quoteIdentifier(key)` (`prepareColumnTableQuery.ts:106`). It does NOT do JSON path extraction. A sort key like `'sender.name'` would be treated as a literal column name `"sender.name"`, not a nested path.
- **Why it won't work:** Column-table adapters cannot meaningfully sort by nested dot-prop paths. The shared fixtures with nested objects (`{ sender: { name: string } }`) can't be stored as relational columns either.
- **Hypothesis (per INTENT.md):** `prepareColumnTableQuery` is designed for "relational tables where sort keys map directly to column names" — nested paths are out of scope. Options: (a) exclude nested-property tests from column-table adapters via a config flag, (b) move nested-property tests out of standardTests into per-file tests for `sortAndSliceObjects` and `prepareObjectTableQuery` only, (c) use flat-only fixtures in standardTests and test nested separately.
- **Decision / Action**: Update the instructions for how to do standard tests by saying a specific test can just to 'skip' (return undefined or an error to the executor). The fact 4 tests out of 5 can work means it should just skip the 5th but stay in standard tests (because it's a good test; just columns can't handle it). 

### CONFLICT 4: `standardTests.ts` — Invariant "limit N is prefix of limit N+1" unreliable for SQL without sort
- **Skeleton:** "limit N result is a prefix of limit N+1 result" (line 224-226), "offset pages are complementary with limit" (line 228-230)
- **Implementation:** Without ORDER BY, SQL doesn't guarantee deterministic row order. These properties only hold when sort is specified.
- **Why it won't work:** If the test omits sort, SQL adapters may return different row orderings between `LIMIT N` and `LIMIT N+1` queries.
- **Hypothesis (per INTENT.md):** These tests MUST include a sort key to be valid across all adapters. The skeleton comments are ambiguous. Clarify that sort is required for these invariant tests.
- **Decision / Action**: Give standardTests a default sort by PK ascending. Non-sort tests (limit, offset, cursor, invariants, edge cases) use this default for deterministic results across all adapters. Sort-specific tests (single key, multi-key, null handling, PK tiebreaker, nested properties) override with their own keys. The test "returns all items unchanged when SortAndSlice is empty" keeps `{}` and only asserts all items are present (order may vary).

### CONFLICT 5: `schemas.test.ts` — Type alignment "inferred schema type assignable to manual SortAndSlice type"
- **Skeleton:** `expectTypeOf<z.infer<typeof SortAndSliceSchema>>().toMatchTypeOf<SortAndSlice<any>>()` (line 390-392)
- **Implementation:** `z.infer<typeof SortAndSliceSchema>` allows both `offset` AND `after_pk` simultaneously. `SortAndSlice<any>` uses a discriminated union (`types.ts:75`) preventing this. The inferred type is WIDER and NOT assignable to the manual type. The code already acknowledges this (`types.ts:193-194`: "the manual type has a discriminated union for offset/after_pk that z.infer cannot express").
- **Why it won't work:** Compile-time assertion would fail — `z.infer` doesn't capture the mutual exclusion.
- **Hypothesis (per INTENT.md):** The existing approach (`types.ts:195-201`) verifies the flat inferred shape matches base fields, explicitly noting the discriminated union gap. The skeleton test should match this approach: test flat shape equivalence, NOT direct assignability. The reverse direction test (line 393-396, "manual assignable to inferred") would pass and is valid.
- **Decision / Action**: Agree with your hypothesis, do it. 

### CONFLICT 6: `prepareObjectTableQuery` tests — "returns error for sort key path not in schema"
- **Skeleton:** Lines 492-496 and 645-650 expect `{ success: false, errors }` for invalid sort key paths
- **Implementation:** `convertDotPropPathToPostgresJsonPath` THROWS on unknown paths (`convertDotPropPathToPostgresJsonPath.ts:37`: `throw new Error('Unknown dotPropPath...')`). `prepareObjectTableQuery` does NOT wrap `pathToSqlExpression` in try/catch (`prepareObjectTableQuery.ts:103-109, 132-134`). So invalid sort keys cause an **uncaught exception**, not an error return.
- **Why it won't work:** The test expects an error-as-value return, but the implementation throws. This also violates the INTENT.md contract: "Errors returned as values, never thrown."
- **Hypothesis (per INTENT.md):** The INTENT clearly states errors-as-values. Two options: (a) wrap `pathToSqlExpression` calls in try/catch in `prepareObjectTableQuery` and convert to `QueryError`, or (b) validate sort key paths against the schema BEFORE passing to `pathToSqlExpression` (similar to how `prepareColumnTableQuery` validates against `allowedColumns` at lines 89-103). The skeleton test describes the correct intended behavior — the implementation needs updating. Note: same issue affects `prepareObjectTableQuery`'s cursor WHERE building (`_buildAfterPkWhereClause` also calls `pathToSqlExpression`).
- **Decision / Action**: Both (a) and (b). First, add upfront path validation in `prepareObjectTableQuery` — extract valid dot-prop paths from the Zod schema via `convertSchemaToDotPropPathTree`, check all sort keys exist, return `QueryError` if not (mirrors `prepareColumnTableQuery`'s `allowedColumns` check). Second, wrap `pathToSqlExpression` calls in try/catch as defense-in-depth — if the throw in `convertDotPropPath*` somehow fires despite validation, catch it and convert to `QueryError` rather than letting it propagate. The `utils/sql/` convert functions keep their throw (security backstop) — the query module owns the user-facing validation.

### CONFLICT 7: `prepareColumnTableQuery` tests — `sortAndSlice` is required, not optional
- **Skeleton:** The skeleton structure implies column-table tests call `standardTests` with the same `Execute` adapter pattern, including the test "returns all items unchanged when SortAndSlice is empty" (line 204-208)
- **Implementation:** `prepareColumnTableQuery` requires `sortAndSlice` (not optional, `prepareColumnTableQuery.ts:65`), unlike `prepareObjectTableQuery` where it's optional (`prepareObjectTableQuery.ts:76`)
- **Why it might cause issues:** The `Execute` adapter can pass `{}` (valid — all fields optional in schema), so the test still works at runtime. But the TYPE constraint is different from `prepareObjectTableQuery`. The adapter implementation needs to handle this signature difference.
- **Hypothesis:** Not a hard conflict — `{}` is a valid `SortAndSlice`. The adapter just always passes the value. Note for adapter implementers.
- **Decision / Action**: Do it 

# Action

For each conflict, update the relevant part of `./planning-testing/proposed-test-structure.md` with the decision in `**Decision / Action**`. 

Ask me if you have any uncertainty. 

Note `./planning-testing/proposed-test-structure.md` remains a skeleton test file (no implementation). 