# Goal

Improve the understandability of `WhereFilterDefinition` by creating a spec for its current implementation, and paving a path to making it 1-1 map with the MongoDB syntax.

# Relevant Files

@types.ts
@standardTests.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts).

It's loosely based on MongoDB, and I regret not making it a direct 1-1 mapping. But now is has too many dependendencies to make a breaking change.

Currently it's slightly under-specified in the documentation. Your job will be to make sure there's a clean spec for it. 

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Analyse the `WhereFilterDefinition` type and figure out the full range of syntax available, creating a conscise API reference for it. You'll find the most accurate answer by going through the types; but the standardTests.ts will help, as will matchJavascriptObject.ts.

I want you to create a WhereFilter spec, and append it to the JSDoc for the `WhereFilterDefinition` type so it's all in one place.

**Completed**: Full spec appended to the JSDoc on `WhereFilterDefinition` in `@types.ts` (lines 50–200). The spec covers:
- Two filter forms (Partial Object Filter, Logic Filter)
- Implicit AND for multi-key filters
- Logic operators (AND/OR/NOT) with semantics
- Value comparisons: exact scalar, deep object equality, range operators (gt/lt/gte/lte on numbers and strings), contains (substring)
- Array filtering: exact array match, scalar element match, compound object filter (per-key OR across elements), logic filter on arrays (atomic per element), elem_match (explicit single-element matching with WhereFilterDefinition or scalar/value comparison)
- Spreading arrays (nested arrays in dot paths with OR semantics)
- Edge cases ({}, {OR:[]}, {AND:[]}, undefined values)

# [x] Phase 2

Map the current spec to the MongoDB spec.
The initial goal isn't to identify gaps missing from MongoDB (I know MongoDB supports more); it's to identify how the MongoDB syntax could be added as aliases to the features/syntax we have.

Note `elem_match` isn't widely used in any other project and so could be made a breaking change.

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

**Deferred / out of scope**:
- `contains` has no clean MongoDB alias (`$regex` is a superset, not equivalent)
- MongoDB operators with no current equivalent (`$ne`, `$in`, `$nin`, `$not`, `$exists`, `$type`, `$regex`, `$all`, `$size`) are not in scope — the goal is aliasing existing features, not adding new ones

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

3. **No plain scalar** — MongoDB does NOT support `{ $elemMatch: 2 }`. For scalar containment you just use `{ field: 2 }` (implicit `$eq` on array), which our system already supports.

### What We Lose

| Current feature | Lost? | Covered by? |
|----------------|-------|-------------|
| `{ elem_match: scalar }` (e.g. `{ elem_match: 2 }`) | **Dropped** (not valid MongoDB) | Already covered by `{ field: 2 }` on an array (scalar element match). **No functional loss.** |
| `{ elem_match: { gt: 5 } }` on scalar arrays | Dropped | Was already broken at runtime. **No functional loss.** |
| `{ elem_match: { contains: 'x' } }` on scalar arrays | Dropped | Was already broken at runtime. **No functional loss.** |
| `{ elem_match: WhereFilterDefinition }` on object arrays | **Kept** — becomes `{ $elemMatch: WhereFilterDefinition }` | Direct rename. |

**Conclusion: there is zero functional power lost.** The only working features are the object-array WhereFilterDefinition mode (kept, just renamed) and the plain scalar mode (redundant, already covered by scalar-on-array matching).

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

### Implementation Plan

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

**Step 3: Drop plain scalar support (optional, for strict MongoDB compliance)**

After Step 2, `{ $elemMatch: 2 }` would still work (scalar elements → `compareValue(element, 2)`). To strictly match MongoDB, we could add a runtime validation that rejects plain scalars inside `$elemMatch`. But since it causes no harm and is a superset of MongoDB, this is optional — it could be kept as a harmless extension.

**Step 4: Update tests**

- Rename all `elem_match` → `$elemMatch` in existing tests
- Add new tests for scalar-array operator expressions (the previously-broken case):
  - `{ $elemMatch: { gte: 80, lt: 85 } }` on `[75, 82, 90]` → true (82 matches)
  - `{ $elemMatch: { gte: 80, lt: 85 } }` on `[75, 90]` → false (no single element in range)
  - `{ $elemMatch: { contains: 'Lon' } }` on `['London', 'NYC']` → true
- Add test confirming `{ $elemMatch: scalar }` still works (extension) or throws (strict mode)