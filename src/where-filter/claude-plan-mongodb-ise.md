# Goal

Align WhereFilterDefinition with MongoDB. The main gain from this is LLMs are trained on MongoDB, so speaking the same language reduces LLM errors and context required to explain how it works.


# Relevant Files

@types.ts
@schemas.ts
@standardTests.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts
@postgresWhereClauseBuilder.ts
@sqliteWhereClauseBuilder.ts
@whereClauseEngine.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts).

It was originally loosely based on MongoDB. It has dependencies so we can't do a breaking change (unless I specifically state), but we can use aliases to bring them into line. 

# Constraints

## Testing is very protected 

Changes to @standardTests.ts must be extremely cautious, and are only approved for the breaking changes to elem_match; or unless otherwise stated.

Aliases will not be tested at first, but instructions/plan will be left in the test file for how to do it. 

# Understanding our code base and it's relationship with Mongo DB

## Mapping: Current Syntax → MongoDB Aliases

### Logic Operators (top-level, take arrays of sub-filters)

| Current | MongoDB Alias | Notes |
|---------|---------------|-------|
| `AND: [...]` | `$and: [...]` | Identical semantics. Add `$and` as non-breaking alias. |
| `OR: [...]` | `$or: [...]` | Identical semantics. Add `$or` as non-breaking alias. |
| `NOT: [...]` | `$nor: [...]` | Identical semantics ("none must match"). Add `$nor` as non-breaking alias. **Caveat**: MongoDB's `$not` is a *different* operator (field-level inversion, e.g. `{ price: { $not: { $gt: 5 } } }`). The current `NOT` has no MongoDB namesake — it maps to `$nor`. |

### Value Comparison — Range Operators

| Current | MongoDB Alias | Notes |
|---------|---------------|-------|
| `{ gt: n }` | `{ $gt: n }` | Add `$gt` as non-breaking alias. |
| `{ lt: n }` | `{ $lt: n }` | Add `$lt` as non-breaking alias. |
| `{ gte: n }` | `{ $gte: n }` | Add `$gte` as non-breaking alias. |
| `{ lte: n }` | `{ $lte: n }` | Add `$lte` as non-breaking alias. |

### Value Comparison — String

| Current | MongoDB Alias | Notes |
|---------|---------------|-------|
| `{ contains: 'x' }` | `{ $regex: 'x' }` (loosely) | **Not a clean alias.** `contains` is substring-only; MongoDB's `$regex` is full PCRE. Adding `$regex` as an alias for `contains` would be misleading. Better to keep `contains` as a non-MongoDB extension, and consider adding true `$regex` support as a separate feature in the future. |

### Array Operators

| Current | MongoDB Alias | Notes |
|---------|---------------|-------|
| `{ elem_match: ... }` | `{ $elemMatch: ... }` | **Breaking change** (acceptable per plan). Rename `elem_match` → `$elemMatch`. |

### Already Identical (no alias needed)

| Feature | Current | MongoDB |
|---------|---------|---------|
| Exact scalar match | `{ 'name': 'Andy' }` | Implicit `$eq` — same syntax |
| Multi-key implicit AND | `{ 'a': 1, 'b': 2 }` | Implicit `$and` — same syntax |
| Dot notation | `'contact.name'` | Same syntax |
| Array literal equality | `{ 'tags': [1, 2] }` | Same syntax |
| Scalar on array | `{ 'tags': 'red' }` | Implicit `$eq` on array — same syntax |
| Deep object equality | `{ 'contact': { name: 'Andy', age: 30 } }` | Same syntax |

### Summary of Proposed Changes

**Non-breaking aliases** (accept both old and new syntax):
1. `$and` → alias for `AND`
2. `$or` → alias for `OR`
3. `$nor` → alias for `NOT`
4. `$gt` → alias for `gt`
5. `$lt` → alias for `lt`
6. `$gte` → alias for `gte`
7. `$lte` → alias for `lte`

**Breaking change** (replace old syntax):
8. `elem_match` → `$elemMatch`

**No Change**
- `contains` has no clean MongoDB alias (`$regex` is a superset, not equivalent). Allow it to exist as a custom extension.

**Deferred**:
- MongoDB operators with no current equivalent (`$ne`, `$in`, `$nin`, `$not`, `$exists`, `$type`, `$regex`, `$all`, `$size`). 

---

## Deep Dive: `elem_match` → `$elemMatch` Migration

### Current `elem_match` Behaviour (actual runtime, not just types)

The type signature allows three usage modes:

```ts
// types.ts
type ArrayValueComparisonElemMatch<T> = {
    elem_match: T extends Record<string, any>
        ? WhereFilterDefinition<T>   // object arrays
        : ValueComparisonFlexi<T>    // scalar arrays: range/contains/scalar
};
```

But at runtime (`matchJavascriptObject.ts:214–221`), the branching is:
```ts
if (isWhereFilterDefinition(filterValue.elem_match)) {
    // Branch A: apply as sub-filter via _matchJavascriptObject(element, ...)
} else {
    // Branch B: apply as value comparison via compareValue(element, ...)
}
```

This creates an **ambiguity bug** for operator objects on scalar arrays:

| Usage | Type allows? | Runtime works? | Why? |
|-------|-------------|---------------|------|
| `{ elem_match: { city: 'London', country: 'UK' } }` on object array | Yes | **Yes** | Branch A — applies WhereFilterDefinition per element |
| `{ elem_match: 2 }` on scalar array | Yes | **Yes** | `2` fails `isWhereFilterDefinition` → Branch B → `compareValue` |
| `{ elem_match: 'NYC' }` on scalar array | Yes | **Yes** | `'NYC'` fails `isWhereFilterDefinition` → Branch B → `compareValue` |
| `{ elem_match: { gt: 5 } }` on numeric array | Yes | **BROKEN** | `{ gt: 5 }` passes `isWhereFilterDefinition` (it's a valid record with key `'gt'`, value `5`) → Branch A → `_matchJavascriptObject(5, { gt: 5 })` → **throws** (5 is not a plain object) |
| `{ elem_match: { contains: 'x' } }` on string array | Yes | **BROKEN** | Same ambiguity — `{ contains: 'x' }` passes `isWhereFilterDefinition` → Branch A → **throws** |

**Summary**: Only plain scalars and WhereFilterDefinitions actually work in `elem_match`. Operator expressions on scalar arrays are typed but broken.

### MongoDB's `$elemMatch` Behaviour

In MongoDB, `$elemMatch` supports two modes:

1. **Object arrays** — value is a query document (field conditions):
   ```json
   { "instock": { "$elemMatch": { "warehouse": "A", "qty": { "$gt": 5 } } } }
   ```

2. **Scalar arrays** — value is an operator expression (no field names, just operators):
   ```json
   { "results": { "$elemMatch": { "$gte": 80, "$lt": 85 } } }
   ```

3. **No plain scalar** — MongoDB does NOT support `{ $elemMatch: 2 }`, because it's designed for pure objects not scalar arrays. For scalar containment you just use `{ field: 2 }` (implicit `$eq` on array), which our system already supports.

### Decision on Scalars (Phase 1 Resolution)

**No ambiguity exists** when using element-type-based branching (Phase 2 Step 2). The fix inspects the runtime type of each array element — not the filter shape — to decide the code path:

- **Element is a plain object** → route to `_matchJavascriptObject` (WhereFilterDefinition)
- **Element is a scalar** → route to `compareValue` (ValueComparisonFlexi)

This means:
- `{$elemMatch: {contains: 'Lon'}}` on `['London', 'NYC']` → each element is a string → `compareValue` → correct
- `{$elemMatch: {city: {contains: 'Lon'}}}` on `[{city: 'London'}]` → each element is an object → `_matchJavascriptObject` → correct

**No special syntax is needed for scalar arrays.** The current syntax works unambiguously with the element-type fix.

**Plain scalar support** (e.g. `{$elemMatch: 2}`) is kept as a non-MongoDB extension — it's useful and unambiguous since scalars always route to `compareValue`.

**Mixed arrays** (objects and scalars in the same array) are handled correctly since each element is branched independently.

### What We Gain

Aligning with MongoDB's `$elemMatch` on scalar arrays unlocks a currently-broken capability:
```ts
// NEW: operator expressions on scalar arrays (currently broken, would be fixed)
{ 'scores': { $elemMatch: { $gte: 80, $lt: 85 } } }
// → true if any element in 'scores' is >= 80 AND < 85
```

This is a net gain — it fixes the ambiguity bug and adds real MongoDB-compatible scalar-array filtering.

### Extension: `contains` inside `$elemMatch`

MongoDB uses `$regex` for string matching inside `$elemMatch`. Since `contains` is our non-MongoDB extension, we can keep it working inside `$elemMatch` as a custom extension:
```ts
// Extension (not MongoDB, but useful)
{ 'tags': { $elemMatch: { contains: 'Lon' } } }
// → true if any element in 'tags' contains the substring 'Lon'
```

This would be a natural part of fixing the scalar-array operator support, since `contains` is just another value comparison operator alongside `gt`/`lt`/etc.


# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

**Outcome:** No ambiguity exists when using element-type-based branching. No special syntax needed for scalar arrays. Plain scalar support kept as non-MongoDB extension. See "Decision on Scalars (Phase 1 Resolution)" section above for full details. Phase 2 Step 3 and Step 4 updated accordingly.

# [x] Phase 2

Implement the change. All 628 tests pass (7 skipped).

**What was done:**
- Step 1: Renamed `elem_match` → `$elemMatch` in types.ts, schemas.ts, matchJavascriptObject.ts, postgresWhereClauseBuilder.ts, sqliteWhereClauseBuilder.ts, combineWriteActionsWhereFilters.ts, standardTests.ts, types.test.ts, combineWriteActionsWhereFilters.test.ts. Performance-experiments/ left unchanged.
- Step 2: Fixed scalar-array ambiguity in matchJavascriptObject.ts using element-type-based branching. Also fixed the same ambiguity in both SQL builders (postgres + sqlite) by checking for value comparisons (scalar/contains/range) before falling through to WhereFilterDefinition. Postgres builder required additional numeric type casting via `(output_identifier)::numeric` for range operators on numeric scalar arrays.
- Step 3: No change needed (per Phase 1).
- Step 4: Added comprehensive `describe('$elemMatch element-type branching')` test block with 18 new tests covering scalar+operators, scalar+plain, object+WFD, object+nested operators, and edge cases.

**Step 0: Update this plan with new files**

Since this plan was written, I added sqliteWhereClauseBuilder.ts and whereClauseEngine.ts which will need to be included in the next steps. 

**Step 1: Rename the key** (`elem_match` → `$elemMatch`)

Files to change:
- `types.ts` — `ArrayValueComparisonElemMatch` type: rename key from `elem_match` to `$elemMatch`
- `schemas.ts` — `ArrayValueComparisonElemMatchSchema`: rename key in `z.object()`
- `schemas.ts` — `isArrayValueComparisonElemMatch`: updated by schema change
- `matchJavascriptObject.ts` — property access `.elem_match` → `.$elemMatch`
- `postgresWhereClauseBuilder.ts` — property access `.elem_match` → `.$elemMatch`
- `combineWriteActionsWhereFilters.ts` — filter construction `{elem_match: ...}` → `{$elemMatch: ...}`
- `standardTests.ts` — all test `elem_match` keys → `$elemMatch`
- `types.test.ts` — any type-level tests
- `combineWriteActionsWhereFilters.test.ts` — test expectations

Files to ignore:
- `performance-experiments/` — various files (6+ files)

**Step 2: Fix the scalar-array ambiguity bug**

In `matchJavascriptObject.ts`, change the `$elemMatch` handler from:
```ts
if (isWhereFilterDefinition(filterValue.$elemMatch)) {
    return value.some(x => _matchJavascriptObject(x, filterValue.$elemMatch, ...))
} else {
    return value.some(x => compareValue(x, filterValue.$elemMatch))
}
```

To logic that inspects the **array elements**, not the filter shape:
```ts
return value.some(element => {
    if (isPlainObject(element)) {
        // Object element: apply as WhereFilterDefinition
        return _matchJavascriptObject(element, filterValue.$elemMatch, ...)
    } else {
        // Scalar element: apply as value comparison
        return compareValue(element, filterValue.$elemMatch)
    }
});
```

This eliminates the ambiguity entirely. The array element's type determines the code path, not the filter shape. `{ $elemMatch: { gt: 5 } }` on `[1, 10, 100]` would correctly route through `compareValue` for each scalar element.

**Step 3: Plain scalar support — no change needed**

Per Phase 1 resolution: keep `{$elemMatch: scalar}` as a non-MongoDB extension. The element-type branching handles it correctly — scalars always route to `compareValue`. No code changes needed beyond Step 2.

**Step 4: Update tests**

- Rename all `elem_match` → `$elemMatch` in existing tests
- Add a new `describe('$elemMatch element-type branching')` block with comprehensive tests:

**4a. Scalar arrays — operator expressions (previously broken, now fixed):**
  - `{ $elemMatch: { gte: 80, lt: 85 } }` on `[75, 82, 90]` → true (82 matches both conditions)
  - `{ $elemMatch: { gte: 80, lt: 85 } }` on `[75, 90]` → false (no single element in range)
  - `{ $elemMatch: { gt: 5 } }` on `[1, 3, 10]` → true (10 > 5)
  - `{ $elemMatch: { gt: 5 } }` on `[1, 3, 4]` → false (no element > 5)
  - `{ $elemMatch: { contains: 'Lon' } }` on `['London', 'NYC']` → true
  - `{ $elemMatch: { contains: 'Lon' } }` on `['Paris', 'NYC']` → false

**4b. Scalar arrays — plain scalar (non-MongoDB extension):**
  - `{ $elemMatch: 2 }` on `[1, 2, 3]` → true
  - `{ $elemMatch: 2 }` on `[1, 3, 5]` → false
  - `{ $elemMatch: 'NYC' }` on `['London', 'NYC']` → true
  - `{ $elemMatch: 'NYC' }` on `['London', 'Paris']` → false

**4c. Object arrays — WhereFilterDefinition (existing behaviour, verify still works):**
  - `{ $elemMatch: { city: 'London', country: 'UK' } }` on `[{city:'London',country:'UK'}, {city:'NYC',country:'US'}]` → true
  - `{ $elemMatch: { city: 'London', country: 'US' } }` on same → false (no single element matches both)
  - `{ $elemMatch: { city: { contains: 'Lon' } } }` on same → true

**4d. Object arrays — nested operator expressions:**
  - `{ $elemMatch: { qty: { gt: 5 }, warehouse: 'A' } }` on `[{qty:10,warehouse:'A'}, {qty:1,warehouse:'B'}]` → true
  - `{ $elemMatch: { qty: { gt: 5 }, warehouse: 'A' } }` on `[{qty:1,warehouse:'A'}, {qty:10,warehouse:'B'}]` → false (no single element matches both)

**4e. Edge cases:**
  - Empty array: `{ $elemMatch: { gt: 5 } }` on `[]` → false
  - Single-element array: `{ $elemMatch: { gt: 5 } }` on `[10]` → true
  - Mixed array (objects + scalars): `{ $elemMatch: 'hello' }` on `[{a:1}, 'hello', 42]` → true (scalar element matches)


# [x] Phase 3

Add aliases for all our current MongoDB equivalent functionality (see `Mapping: Current Syntax → MongoDB Aliases`). All 628 tests pass (7 skipped).

**What was done:**

**Strategy: Early Normalization** — A `normalizeWhereFilter` function recursively converts all MongoDB aliases to canonical form at the entry points (`matchJavascriptObject` and `buildWhereClause`). This means all downstream runtime code (logic evaluation, range comparison, SQL generation) is unchanged — it only ever sees canonical operators.

**Files created:**
- `normalizeWhereFilter.ts` — Recursive normalization: `$and→AND`, `$or→OR`, `$nor→NOT`, `$gt→gt`, `$lt→lt`, `$gte→gte`, `$lte→lte`. Uses `Object.defineProperty` for safe property assignment (avoids `__proto__` prototype pollution) and `Object.hasOwn` for safe alias map lookups (avoids prototype chain leakage from `__proto__`/`constructor` keys).

**Files modified:**
- `consts.ts` — Added `LogicAliasToCanonical`, `RangeAliasToCanonical` mapping objects, and `WhereFilterLogicOperatorsWithAliases`/`ValueComparisonRangeOperatorsWithAliases` arrays for typeguards.
- `types.ts` — Added `MongoLogicAlias` (`$and|$or|$nor`) and `MongoRangeAlias` (`$gt|$lt|$gte|$lte`) types. Extended `LogicFilter`, `ValueComparisonRangeNumeric`, and `ValueComparisonRangeString` to accept aliases.
- `schemas.ts` — Extended Zod `WhereFilterSchema` to accept `$and/$or/$nor` in the logic object branch. Extended `ValueComparisonRangeNumericSchema` to accept `$gt/$lt/$gte/$lte`.
- `typeguards.ts` — Updated `isLogicFilter` and all `isValueComparisonRange*` guards to use `WithAliases` arrays, so external code calling typeguards on un-normalized data gets correct results.
- `matchJavascriptObject.ts` — Calls `normalizeWhereFilter(filter)` after validation, before `_matchJavascriptObject`.
- `whereClauseEngine.ts` — Calls `normalizeWhereFilter(filter)` after validation, before `whereClauseBuilder`.

# [ ] Phase 3a

**Goal:** Verify that every MongoDB alias produces identical results to its canonical form, without duplicating the full test matrix.

**Approach: Pairwise equivalence tests.** For each alias pair, run a representative test case with both forms and assert identical results. This gives thorough coverage (~20 tests) with zero maintenance burden from duplication.

**Where:** Add a new `describe('MongoDB aliases')` block at the end of `standardTests.ts`. Since `standardTests` is invoked by all 3 test files (matchJavascriptObject, postgres, sqlite), alias equivalence is automatically verified across all engines.

**Tests to add:**

### Logic operator aliases (6 tests)

Each pair (`AND`↔`$and`, `OR`↔`$or`, `NOT`↔`$nor`) gets a "passes" and "fails" test:

```ts
// $and alias
test('$and: passes', () => {
    expect(match(obj, { $and: [{ 'contact.name': 'Andy' }, { 'contact.emailAddress': 'andy@andy.com' }] }))
        .toEqual(match(obj, { AND: [{ 'contact.name': 'Andy' }, { 'contact.emailAddress': 'andy@andy.com' }] }));
});
test('$and: fails', () => {
    expect(match(obj, { $and: [{ 'contact.name': 'Andy' }, { 'contact.name': 'Bob' }] }))
        .toEqual(match(obj, { AND: [{ 'contact.name': 'Andy' }, { 'contact.name': 'Bob' }] }));
});
// Same pattern for $or and $nor
```

### Range operator aliases (8 tests)

Each pair (`gt`↔`$gt`, `lt`↔`$lt`, `gte`↔`$gte`, `lte`↔`$lte`) gets a "passes" and "fails" test:

```ts
// $gt alias
test('$gt: passes', () => {
    expect(match(obj, { 'contact.age': { $gt: 25 } }))
        .toEqual(match(obj, { 'contact.age': { gt: 25 } }));
});
test('$gt: fails', () => {
    expect(match(obj, { 'contact.age': { $gt: 100 } }))
        .toEqual(match(obj, { 'contact.age': { gt: 100 } }));
});
// Same pattern for $lt, $gte, $lte
```

### Combined range aliases (2 tests)

Multiple aliases used together in one filter:

```ts
test('$gte + $lt combined', () => {
    expect(match(obj, { 'contact.age': { $gte: 18, $lt: 100 } }))
        .toEqual(match(obj, { 'contact.age': { gte: 18, lt: 100 } }));
});
```

### Nested aliases (4 tests)

Aliases used inside `$elemMatch` and nested logic:

```ts
// Range alias inside $elemMatch on scalar array
test('$gt inside $elemMatch on scalar array', () => {
    expect(match(locObj, { 'contact.locations': { $elemMatch: { $gt: 5 } } }))
        .toEqual(match(locObj, { 'contact.locations': { $elemMatch: { gt: 5 } } }));
});

// Logic alias inside $elemMatch on object array
test('$and inside $elemMatch on object array', () => {
    expect(match(locObj, { 'contact.locations': { $elemMatch: { $and: [{city: 'London'}, {country: 'UK'}] } } }))
        .toEqual(match(locObj, { 'contact.locations': { $elemMatch: { AND: [{city: 'London'}, {country: 'UK'}] } } }));
});

// Deeply nested: $or containing $gt
test('$or containing $gte', () => {
    expect(match(obj, { $or: [{ 'contact.age': { $gte: 100 } }, { 'contact.name': 'Andy' }] }))
        .toEqual(match(obj, { OR: [{ 'contact.age': { gte: 100 } }, { 'contact.name': 'Andy' }] }));
});
```

**Total: ~20 tests**, covering all 7 alias pairs with pass/fail, combined usage, and nesting. No combinatorial explosion. Each test verifies alias↔canonical equivalence, not the underlying logic (which is already covered by the existing 100+ tests per engine).

# [ ] Phase 4

Write a plan for how we will support the missing functionality currently found in MongoDB but not us: `$ne`, `$in`, `$nin`, `$not`, `$exists`, `$type`, `$regex`, `$all`, `$size`. 

It will need to be supported in the types and schemas, matchJavascriptOBject, the postgres/sqlite query builders, the standardTests (ideally separated cleanly with 'describe' blocks). 

Output the plan in this document as steps under Phase 4a.

# [ ] Phase 4a
_To be filled in by Phase 4_