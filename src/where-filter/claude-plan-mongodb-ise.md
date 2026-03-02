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

Plan a breaking change to rename our current terms (AND/NOT/OR, {gt}, {lte}, etc) to their Mongo form. 

You'll need to rewrite the types, then the matching functions (matchJavascriptObject and the pg/sqlite), then the tests - for the most part just using string replacement I hope. 

Do not add/remove or change the intent of tests. This is simply replacing the terms.

Also you will not alias. We're dropping the current terms. 

For our extensions, rename them to use the $ prefix to match Mongo style, e.g. {contains} becomes {$contains}. 

Output the plan as the body of 'Phase 3a'.

# [x] Phase 3a

All 628 tests pass (7 skipped). Breaking rename of all operators to MongoDB form. No aliases — old names are dropped entirely. Extensions get `$` prefix.

## Rename Map

| Current | New (MongoDB) | Category |
|---------|---------------|----------|
| `AND` | `$and` | Logic operator |
| `OR` | `$or` | Logic operator |
| `NOT` | `$nor` | Logic operator (our NOT = MongoDB's $nor: "none must match") |
| `gt` | `$gt` | Range operator |
| `lt` | `$lt` | Range operator |
| `gte` | `$gte` | Range operator |
| `lte` | `$lte` | Range operator |
| `contains` | `$contains` | Extension (not MongoDB, keep with $ prefix) |

## Step 1: Update consts.ts

Change the two const arrays:
```ts
// Before:
export const WhereFilterLogicOperators = ['AND', 'OR', 'NOT'] as const;
export const ValueComparisonRangeOperators = ['lt', 'gt', 'lte', 'gte'] as const;

// After:
export const WhereFilterLogicOperators = ['$and', '$or', '$nor'] as const;
export const ValueComparisonRangeOperators = ['$lt', '$gt', '$lte', '$gte'] as const;
```

All downstream types (`WhereFilterLogicOperatorsTyped`, `ValueComparisonRangeOperatorsTyped`) and typeguard functions (`isLogicFilter`, `isValueComparisonRange*`) derive from these consts, so they update automatically.

## Step 2: Update types.ts

1. Rename `ValueComparisonContains`:
   ```ts
   // Before:
   export type ValueComparisonContains = { contains: string };
   // After:
   export type ValueComparisonContains = { $contains: string };
   ```

2. Update all documentation examples and comments:
   - `AND` → `$and`, `OR` → `$or`, `NOT` → `$nor`
   - `{ gte: 18 }` → `{ $gte: 18 }`, `{ gt: 10, lte: 100 }` → `{ $gt: 10, $lte: 100 }`, etc.
   - `{ contains: 'And' }` → `{ $contains: 'And' }`

No structural changes needed — `LogicFilter` and `ValueComparisonRange*` types derive from the consts automatically.

## Step 3: Update schemas.ts

1. Logic filter schema keys:
   ```ts
   // Before:
   z.object({
       OR: z.array(WhereFilterSchema).optional(),
       AND: z.array(WhereFilterSchema).optional(),
       NOT: z.array(WhereFilterSchema).optional(),
   })
   // After:
   z.object({
       $or: z.array(WhereFilterSchema).optional(),
       $and: z.array(WhereFilterSchema).optional(),
       $nor: z.array(WhereFilterSchema).optional(),
   })
   ```

2. Contains schema:
   ```ts
   // Before:
   const ValueComparisonContainsSchema = z.object({
       contains: z.union([z.string(), z.number()]),
   });
   // After:
   const ValueComparisonContainsSchema = z.object({
       $contains: z.union([z.string(), z.number()]),
   });
   ```

3. `isValueComparisonContains` typeguard:
   ```ts
   // Before:
   return (alreadyProvedIsPlainObject || isPlainObject(x)) && "contains" in x;
   // After:
   return (alreadyProvedIsPlainObject || isPlainObject(x)) && "$contains" in x;
   ```

## Step 4: Update typeguards.ts

1. Error message on line 21:
   ```ts
   // Before:
   "A WhereFilter must have a single key, or be a recursive with OR/AND/NOT arrays."
   // After:
   "A WhereFilter must have a single key, or be a recursive with $or/$and/$nor arrays."
   ```

2. The TODO comment on line 44 referencing `contains` → `$contains`.

No other changes needed — all operator checks derive from the const arrays.

## Step 5: Update matchJavascriptObject.ts

1. Multi-key normalization (line 117-118):
   ```ts
   // Before:
   filter = { AND: keys.map(key => ({[key]: filter[key]})) }
   // After:
   filter = { $and: keys.map(key => ({[key]: filter[key]})) }
   ```

2. Logic operator access (lines 125-127):
   ```ts
   // Before:
   const passOr = !Array.isArray(filter.OR) || filter.OR.some(subMatcher);
   const passAnd = !Array.isArray(filter.AND) || filter.AND.every(subMatcher);
   const passNot = !Array.isArray(filter.NOT) || !filter.NOT.some(subMatcher);
   // After:
   const passOr = !Array.isArray(filter.$or) || filter.$or.some(subMatcher);
   const passAnd = !Array.isArray(filter.$and) || filter.$and.every(subMatcher);
   const passNor = !Array.isArray(filter.$nor) || !filter.$nor.some(subMatcher);
   return passOr && passAnd && passNor;
   ```

3. Spread array OR (line 141):
   ```ts
   // Before:
   OR: spreadArrays.map(x => ({[x.path]: dotpropFilter}))
   // After:
   $or: spreadArrays.map(x => ({[x.path]: dotpropFilter}))
   ```

4. Range operator function map (lines 163-168):
   ```ts
   // Before:
   { 'gt': ..., 'lt': ..., 'gte': ..., 'lte': ... }
   // After:
   { '$gt': ..., '$lt': ..., '$gte': ..., '$lte': ... }
   ```

5. Contains access (line 176):
   ```ts
   // Before:
   return value.indexOf(filterValue.contains) > -1;
   // After:
   return value.indexOf(filterValue.$contains) > -1;
   ```

6. Update comments throughout (AND/OR/NOT references, `gt`, `lt`, `contains`).

## Step 6: Update whereClauseEngine.ts

**Critical issue**: The current code uses logic operator names directly as SQL keywords (`subClauses.join(` ${type} `)` where `type` is `'AND'` or `'OR'`). After renaming to `$and`/`$or`, we need a mapping.

1. Add a SQL keyword mapping:
   ```ts
   const logicOperatorSqlKeyword: Record<string, string> = {
       '$and': 'AND',
       '$or': 'OR',
       '$nor': 'NOT', // used in the special NOT (...) case
   };
   ```

2. Update multi-key normalization:
   ```ts
   // Before:
   AND: keys.map(key => ({ [key]: filter[key] }))
   // After:
   $and: keys.map(key => ({ [key]: filter[key] }))
   ```

3. Update logic handling:
   ```ts
   // Before:
   if (type === 'NOT') { ... }
   // After:
   if (type === '$nor') { ... }
   ```
   ```ts
   // Before:
   subClauseString = subClauses.length === 1 ? subClauses[0] : `(${subClauses.join(` ${type} `)})`;
   // After:
   const sqlKeyword = logicOperatorSqlKeyword[type]!;
   subClauseString = subClauses.length === 1 ? subClauses[0] : `(${subClauses.join(` ${sqlKeyword} `)})`;
   ```
   ```ts
   // Before:
   if (type === 'AND') { subClauseString = '1 = 1'; }
   // After:
   if (type === '$and') { subClauseString = '1 = 1'; }
   ```

4. The final `andClauses.join(' AND ')` on line 81 stays unchanged — that's SQL syntax, not a JSON key.

5. Update the JSDoc comment on line 43.

## Step 7: Update postgresWhereClauseBuilder.ts

1. Contains access:
   ```ts
   // Before:
   this.generatePlaceholder(`%${filter.contains}%`, statementArguments)
   // After:
   this.generatePlaceholder(`%${filter.$contains}%`, statementArguments)
   ```

2. Range operator SQL mapping (lines 365-370):
   ```ts
   // Before:
   { 'gt': ..., 'lt': ..., 'gte': ..., 'lte': ... }
   // After:
   { '$gt': ..., '$lt': ..., '$gte': ..., '$lte': ... }
   ```

3. Any inline SQL fragments using `AND`, `OR`, `NOT` are SQL keywords and stay unchanged.

4. Update comments referencing `contains`, `range`, etc.

## Step 8: Update sqliteWhereClauseBuilder.ts

Same changes as Step 7 (postgres), mirrored for SQLite:
1. `filter.contains` → `filter.$contains`
2. Range operator SQL mapping keys: `'gt'` → `'$gt'`, etc.
3. SQL keyword strings (`AND`, `OR`, `NOT`) stay unchanged.
4. Update comments.

## Step 9: Update combineWriteActionsWhereFilters.ts (write-actions)

1. Line 51: `{AND: [x.payload.where, subResult.filter]}` → `{$and: [...]}`
2. Line 72: `OR: filtersForExisting` → `$or: filtersForExisting`

## Step 10: Update test files (string replacement only, no intent changes)

### standardTests.ts
Replace all operator keys in filter definitions:
- `AND:` → `$and:` (all occurrences in filter objects)
- `OR:` → `$or:` (all occurrences in filter objects)
- `NOT:` → `$nor:` (all occurrences in filter objects)
- `'gt':` / `gt:` → `'$gt':` / `$gt:`
- `'lt':` / `lt:` → `'$lt':` / `$lt:`
- `'gte':` / `gte:` → `'$gte':` / `$gte:`
- `'lte':` / `lte:` → `'$lte':` / `$lte:`
- `contains:` → `$contains:`

Test descriptions (string labels) should also update to reference the new names where they mention the operator name, e.g. "multikey is AND" → "multikey is $and". But do NOT change descriptions where AND/OR/NOT refer to the logical concept rather than the operator name.

### types.test.ts
- `gte:` → `$gte:`
- `contains:` → `$contains:`
- `AND:` / `{AND:` → `$and:` / `{$and:`
- `a['OR']` → `a['$or']`
- Descriptions referencing operator names

### combineWriteActionsWhereFilters.test.ts
- `AND:` → `$and:`
- `OR:` → `$or:`

### postgresWhereClauseBuilder.test.ts / sqliteWhereClauseBuilder.test.ts
- Any filter definitions using old operator names need updating.

## Step 11: Verify

Run the full test suite. All tests should pass with the new operator names. No tests should be added or removed — this is purely a rename.

# [ ] Phase 4

Write a plan for how we will support the missing functionality currently found in MongoDB but not us: `$ne`, `$in`, `$nin`, `$not`, `$exists`, `$type`, `$regex`, `$all`, `$size`. 

It will need to be supported in the types and schemas, matchJavascriptOBject, the postgres/sqlite query builders, the standardTests (ideally separated cleanly with 'describe' blocks). 

Output the plan in this document as steps under Phase 4a.

# [ ] Phase 4a
_To be filled in by Phase 4_