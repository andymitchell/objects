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

# [x] Phase 4

Write a plan for how we will support the missing functionality currently found in MongoDB but not us: `$ne`, `$in`, `$nin`, `$not`, `$exists`, `$type`, `$regex`, `$all`, `$size`. 

It will need to be supported in the types and schemas, matchJavascriptOBject, the postgres/sqlite query builders, the standardTests (ideally separated cleanly with 'describe' blocks). 

TDD is most important. Make a plan for how they'll be tested first, ideally all in standardTests.ts. 

Output the plan in this document as steps under `Phase 4a`.

# [x] Phase 4a

Discussed the builder return type change. Agreed:
1. **All errors become error-as-value** — not just capability gaps ($regex on SQLite), but also validation errors (bad filter shape, missing paths, type mismatches). No more throws from builders.
2. **Error includes both filters** — each error carries the specific sub-filter that failed AND the top-level root filter.
3. **Breaking change to return type** — `PreparedWhereClauseStatement` is replaced by a discriminated union `PreparedWhereClauseResult`. Consumers must check `.success`.
4. **snake_case for property names** — package convention. Existing camelCase properties (`whereClauseStatement`, `statementArguments`) renamed to `where_clause_statement`, `statement_arguments`.

Phase 5 updated with these decisions.

# [x] Phase 5

All 772 tests pass (7 skipped). Implemented all 9 new MongoDB operators plus error-as-value return type migration.

**What was done:**

- **Step 0 (Result type migration):** `PreparedWhereClauseResult` discriminated union replaces `PreparedWhereClauseStatement` as the builder return type. `WhereClauseError` type carries `sub_filter`, `root_filter`, and `message`. `IPropertyMap.generateSql` now receives `errors` and `rootFilter` params. Both dialect builders updated. All callers and tests updated to check `.success` and use `where_clause_statement`/`statement_arguments`. Old type kept as deprecated alias.

- **Step 1 (Tests):** ~48 new tests added to `standardTests.ts` covering `$ne`, `$in`, `$nin`, `$not`, `$exists`, `$type`, `$regex`, `$all`, `$size`. Run across all 3 test engines (JS matcher, Postgres, SQLite) = ~144 new test executions.

- **Steps 2–5 (Types, schemas, JS matching, SQL builders):** All operators implemented in `types.ts`, `schemas.ts`, `matchJavascriptObject.ts`, `postgresWhereClauseBuilder.ts`, `sqliteWhereClauseBuilder.ts`. Key decisions:
  - `$exists`/`$type` handled BEFORE the array/scalar branch in `_matchJavascriptObject`
  - `$ne`/`$nin`/`$not` use `optionalWrapperNullMatches` (IS NULL OR ...) for MongoDB-compatible missing-field behavior
  - `$type` in Postgres uses `jsonb_typeof()` on raw JSONB (via `->` chain)
  - `$type` in SQLite uses `json_type()` with type name mapping (number→integer/real, boolean→true/false, string→text)
  - `$regex` in SQLite pushes `WhereClauseError` and returns `FALSE` placeholder
  - `$regex` in Postgres uses `~` (case-sensitive) or `~*` (case-insensitive via `$options: 'i'`)
  - `$all` uses multiple `EXISTS` subqueries joined with AND
  - `$size` uses `jsonb_array_length` (Postgres) / `json_array_length` (SQLite)

## Implementation Plan


## Operator Categories

| Operator | Category | What it does | Works on |
|----------|----------|-------------|----------|
| `$ne` | Scalar comparison | Not equal | string, number |
| `$in` | Membership | Value in list (scalar) or array intersects list (array) | string, number; also arrays |
| `$nin` | Membership | Value NOT in list / array doesn't intersect list | string, number; also arrays |
| `$not` | Meta/wrapper | Negates an inner operator expression | wraps any ValueComparison |
| `$exists` | Meta | Field exists (not null/undefined) | any field |
| `$type` | Meta | Runtime type check | any field |
| `$regex` | String | Regex match | string |
| `$all` | Array-level | Array contains ALL specified values | arrays |
| `$size` | Array-level | Array has exactly N elements | arrays |

### Key Design Decisions

**$ne on undefined/null values:** Follow MongoDB — `{$ne: 5}` on a missing field returns `true` (the field's value is not 5). In JS, `undefined !== 5` is naturally `true`. In SQL, requires `(column IS NULL OR column != $N)` — opposite of the current optionalWrapper pattern.

**$in/$nin on array fields:** Follow MongoDB — `{$in: ['a','b']}` on an array means "array contains at least one of these" (intersection is non-empty). Needs handling in both `compareValue` (scalar fields) and `compareArray` (array fields).

**$not wraps operator expressions only:** Per MongoDB, `{$not: {$gt: 5}}` is valid, `{$not: 5}` is not. $not takes a non-scalar value comparison (range, $contains, $ne, $in, $regex, etc.) and negates it. On undefined/null: returns `true` (MongoDB: $not matches non-existent fields).

**$type values:** `"string"`, `"number"`, `"boolean"`, `"object"`, `"array"`, `"null"`. Maps to JS `typeof` (with special casing for array/null/object). SQL: Postgres `jsonb_typeof()`, SQLite `json_type()` (with type name mapping).

**$regex in SQLite:** SQLite has no native regex. Implement `$regex` for Postgres only. SQLite builder pushes a `WhereClauseError` to the errors array and returns a placeholder SQL fragment. The builder's top-level return is `{success: false, errors: [...]}`, surfacing exactly which sub-filter used `$regex`. This is handled by the error-as-value return type (see below).

**Builder return type (error-as-value):** Both `postgresWhereClauseBuilder` and `sqliteWhereClauseBuilder` change from returning `PreparedWhereClauseStatement` to returning `PreparedWhereClauseResult` — a discriminated union:
```ts
type WhereClauseError = {
    sub_filter: WhereFilterDefinition;    // the specific sub-filter that caused the error
    root_filter: WhereFilterDefinition;   // the entire top-level filter
    message: string;                      // human-readable error description
};

type PreparedWhereClauseResult =
    | { success: true; where_clause_statement: string; statement_arguments: PreparedStatementArgument[] }
    | { success: false; errors: WhereClauseError[] };
```
All errors become values — validation errors (bad filter shape, missing paths, type mismatches) AND capability gaps ($regex on SQLite). No throws from builders.

Internal plumbing: a shared `errors: WhereClauseError[]` array is passed through the call chain (`buildWhereClause` → `whereClauseBuilder` → `generateSql` → `generateComparison`). When a function hits an error, it pushes to the array and returns a placeholder SQL fragment (e.g., `'FALSE'`). At the top level, `buildWhereClause` checks `errors.length > 0` and returns the appropriate discriminant. This collects ALL errors in a single pass rather than bailing on the first one.

**snake_case for property names:** Package convention. Existing `PreparedWhereClauseStatement` properties renamed: `whereClauseStatement` → `where_clause_statement`, `statementArguments` → `statement_arguments`. The old type is replaced by the new result type. `IPropertyMap.generateSql` signature updated with additional `errors` and `root_filter` parameters.

**$exists in `_matchJavascriptObject`:** Handle BEFORE the array/scalar branch — it checks the resolved value itself, not its contents. Same for `$type`.

---

## Step 0: Result Type Migration (error-as-value)

This step is a prerequisite — it changes the builder return type before any new operators are added. All existing tests must still pass after this step (they just check `.success === true` and unwrap the result).

### 0a. New types in `whereClauseEngine.ts` (or a shared types file)

```ts
export type WhereClauseError = {
    sub_filter: WhereFilterDefinition;
    root_filter: WhereFilterDefinition;
    message: string;
};

export type PreparedWhereClauseResult =
    | { success: true; where_clause_statement: string; statement_arguments: PreparedStatementArgument[] }
    | { success: false; errors: WhereClauseError[] };
```

Remove (or keep as internal-only) the old `PreparedWhereClauseStatement` type. Export `PreparedWhereClauseResult` and `WhereClauseError` from the package index.

### 0b. Update `IPropertyMap` interface

```ts
export interface IPropertyMap<T extends Record<string, any>> {
    generateSql(
        dotprop_path: string,
        filter: WhereFilterDefinition<T>,
        statement_arguments: PreparedStatementArgument[],
        errors: WhereClauseError[],
        root_filter: WhereFilterDefinition<T>
    ): string;
}
```

### 0c. Update `buildWhereClause` in `whereClauseEngine.ts`

```ts
export function buildWhereClause<T extends Record<string, any> = any>(
    filter: WhereFilterDefinition<T>,
    property_sql_map: IPropertyMap<T>
): PreparedWhereClauseResult {
    const errors: WhereClauseError[] = [];
    if (!isWhereFilterDefinition(filter)) {
        errors.push({
            sub_filter: filter as any,
            root_filter: filter as any,
            message: `Not a valid WhereFilterDefinition: ${safeJson(filter)}`
        });
        return { success: false, errors };
    }
    const statement_arguments: PreparedStatementArgument[] = [];
    const where_clause_statement = whereClauseBuilder(filter, statement_arguments, property_sql_map, errors, filter);
    if (errors.length > 0) {
        return { success: false, errors };
    }
    return { success: true, where_clause_statement, statement_arguments };
}
```

### 0d. Update `whereClauseBuilder` (internal, recursive)

Add `errors` and `root_filter` params, pass them through to `generateSql`. Convert existing throws to `errors.push(...)` + return placeholder `'FALSE'`.

```ts
function whereClauseBuilder<T extends Record<string, any> = any>(
    filter: WhereFilterDefinition<T>,
    statement_arguments: PreparedStatementArgument[],
    property_sql_map: IPropertyMap<T>,
    errors: WhereClauseError[],
    root_filter: WhereFilterDefinition<T>
): string
```

### 0e. Update dialect builders (`postgresWhereClauseBuilder.ts`, `sqliteWhereClauseBuilder.ts`)

1. Each builder's `generateSql` and `generateComparison` accept `errors: WhereClauseError[]` and `root_filter: WhereFilterDefinition`.
2. Convert existing throws (path validation, type mismatch) to `errors.push({sub_filter: filter, root_filter, message: '...'})` + return `'FALSE'`.
3. Top-level export function signature changes:
   ```ts
   export default function sqliteWhereClauseBuilder<T extends Record<string, any> = any>(
       filter: WhereFilterDefinition<T>,
       property_sql_map: IPropertyMap<T>
   ): PreparedWhereClauseResult
   ```

### 0f. Update all callers and tests

- Every call site that uses the builder result must now check `result.success` before accessing `result.where_clause_statement` / `result.statement_arguments`.
- Existing tests that pass a filter and check SQL output need a thin unwrap: assert `result.success === true`, then check the fields.
- Update the package's `index.ts` exports: remove `PreparedWhereClauseStatement`, add `PreparedWhereClauseResult`, `WhereClauseError`.

### 0g. Rename existing snake_case migration

While touching every test and caller, rename:
- `whereClauseStatement` → `where_clause_statement`
- `statementArguments` → `statement_arguments`

This is a single find-and-replace pass across the codebase.

---

## Step 1: Test Plan (TDD — all tests written first, all fail)

All tests go in `standardTests.ts` in new `describe` blocks after the existing `$elemMatch element-type branching` block. Each uses the existing `ContactSchema` unless noted.

### `describe('$ne (not equal)')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$ne string: passes when not equal` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$ne: 'Bob'}}` | `true` |
| `$ne string: fails when equal` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$ne: 'Andy'}}` | `false` |
| `$ne number: passes when not equal` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$ne: 25}}` | `true` |
| `$ne number: fails when equal` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$ne: 30}}` | `false` |
| `$ne on missing optional field: passes` | `{contact: {name: 'Andy'}}` | `{'contact.age': {$ne: 30}}` | `true` |

### `describe('$in (membership)')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$in string: passes when value in list` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$in: ['Andy', 'Bob']}}` | `true` |
| `$in string: fails when value not in list` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$in: ['Bob', 'Carol']}}` | `false` |
| `$in number: passes` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$in: [25, 30, 35]}}` | `true` |
| `$in number: fails` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$in: [25, 35]}}` | `false` |
| `$in on array field: passes when intersection non-empty` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$in: ['NYC', 'Tokyo']}}` | `true` |
| `$in on array field: fails when no intersection` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$in: ['Tokyo', 'Paris']}}` | `false` |

### `describe('$nin (not in)')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$nin string: passes when value not in list` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$nin: ['Bob', 'Carol']}}` | `true` |
| `$nin string: fails when value in list` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$nin: ['Andy', 'Bob']}}` | `false` |
| `$nin number: passes` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$nin: [25, 35]}}` | `true` |
| `$nin number: fails` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$nin: [25, 30, 35]}}` | `false` |
| `$nin on array field: passes when no intersection` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$nin: ['Tokyo', 'Paris']}}` | `true` |
| `$nin on array field: fails when intersection exists` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$nin: ['NYC', 'Tokyo']}}` | `false` |

### `describe('$not (field-level negation)')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$not with $gt: passes when value does not exceed` | `{contact: {name: 'Andy', age: 20}}` | `{'contact.age': {$not: {$gt: 25}}}` | `true` |
| `$not with $gt: fails when value exceeds` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$not: {$gt: 25}}}` | `false` |
| `$not with $contains: passes when substring absent` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$not: {$contains: 'Bob'}}}` | `true` |
| `$not with $contains: fails when substring present` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$not: {$contains: 'And'}}}` | `false` |
| `$not on missing optional field: passes` | `{contact: {name: 'Andy'}}` | `{'contact.age': {$not: {$gt: 0}}}` | `true` |

### `describe('$exists')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$exists true on existing field: passes` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$exists: true}}` | `true` |
| `$exists true on missing field: fails` | `{contact: {name: 'Andy'}}` | `{'contact.age': {$exists: true}}` | `false` |
| `$exists false on missing field: passes` | `{contact: {name: 'Andy'}}` | `{'contact.age': {$exists: false}}` | `true` |
| `$exists false on existing field: fails` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$exists: false}}` | `false` |
| `$exists true on existing array: passes` | `{contact: {name: 'Andy', locations: ['London']}}` | `{'contact.locations': {$exists: true}}` | `true` |
| `$exists false on missing array: passes` | `{contact: {name: 'Andy'}}` | `{'contact.locations': {$exists: false}}` | `true` |

### `describe('$type')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$type "string": passes on string field` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$type: 'string'}}` | `true` |
| `$type "string": fails on number field` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$type: 'string'}}` | `false` |
| `$type "number": passes on number field` | `{contact: {name: 'Andy', age: 30}}` | `{'contact.age': {$type: 'number'}}` | `true` |
| `$type "number": fails on string field` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$type: 'number'}}` | `false` |
| `$type "array": passes on array field` | `{contact: {name: 'Andy', locations: ['London']}}` | `{'contact.locations': {$type: 'array'}}` | `true` |
| `$type on missing field: fails` | `{contact: {name: 'Andy'}}` | `{'contact.age': {$type: 'number'}}` | `false` |

### `describe('$regex')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$regex: passes when pattern matches` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$regex: 'And'}}` | `true` |
| `$regex: fails when pattern does not match` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$regex: 'Bob'}}` | `false` |
| `$regex anchored: passes` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$regex: '^And'}}` | `true` |
| `$regex anchored: fails` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$regex: '^ndy'}}` | `false` |
| `$regex case-insensitive via $options: passes` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$regex: 'andy', $options: 'i'}}` | `true` |
| `$regex case-sensitive default: fails` | `{contact: {name: 'Andy'}}` | `{'contact.name': {$regex: 'andy'}}` | `false` |

### `describe('$all (array contains all)')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$all: passes when array contains all values` | `{contact: {name: 'Andy', locations: ['London', 'NYC', 'Tokyo']}}` | `{'contact.locations': {$all: ['London', 'NYC']}}` | `true` |
| `$all: fails when array missing a value` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$all: ['London', 'Tokyo']}}` | `false` |
| `$all with single value: passes` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$all: ['London']}}` | `true` |
| `$all on empty array: fails` | `{contact: {name: 'Andy', locations: []}}` | `{'contact.locations': {$all: ['London']}}` | `false` |

### `describe('$size (array length)')`

| Test name | Object | Filter | Expected |
|-----------|--------|--------|----------|
| `$size: passes when length matches` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$size: 2}}` | `true` |
| `$size: fails when length differs` | `{contact: {name: 'Andy', locations: ['London', 'NYC']}}` | `{'contact.locations': {$size: 3}}` | `false` |
| `$size 0 on empty array: passes` | `{contact: {name: 'Andy', locations: []}}` | `{'contact.locations': {$size: 0}}` | `true` |
| `$size 0 on non-empty array: fails` | `{contact: {name: 'Andy', locations: ['London']}}` | `{'contact.locations': {$size: 0}}` | `false` |

### `describe('builder error-as-value')`

These tests verify the new `PreparedWhereClauseResult` error handling. They run against the SQL builders only (not `matchJavascriptObject`).

| Test name | Builder | Filter | Expected |
|-----------|---------|--------|----------|
| `SQLite: $regex returns success false with error` | sqlite | `{'contact.name': {$regex: 'And'}}` | `{success: false, errors: [{sub_filter: {$regex: 'And'}, root_filter: <entire filter>, message: /regex.*not supported/i}]}` |
| `Postgres: $regex returns success true` | postgres | `{'contact.name': {$regex: 'And'}}` | `{success: true, ...}` |
| `SQLite: valid filter returns success true` | sqlite | `{'contact.name': 'Andy'}` | `{success: true, where_clause_statement: ..., statement_arguments: [...]}` |
| `invalid filter returns success false` | both | `{not_a_real_path: 'x'}` (invalid path) | `{success: false, errors: [{..., message: /path/i}]}` |
| `$regex nested in $and: SQLite surfaces error with sub_filter and root_filter` | sqlite | `{$and: [{'contact.name': {$regex: 'x'}}, {'contact.age': {$gt: 5}}]}` | `{success: false, errors: [{sub_filter: {'contact.name': {$regex: 'x'}}, root_filter: <entire $and filter>, ...}]}` |

**Total: ~58 new tests across 10 describe blocks.**

---

## Step 2: Types (`types.ts`)

### New value comparison types

```ts
export type ValueComparisonNe<T = any> = { $ne: T extends string ? string : T extends number ? number : never };
export type ValueComparisonIn<T = any> = { $in: (T extends string ? string : T extends number ? number : never)[] };
export type ValueComparisonNin<T = any> = { $nin: (T extends string ? string : T extends number ? number : never)[] };
export type ValueComparisonExists = { $exists: boolean };
export type ValueComparisonType = { $type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' };
export type ValueComparisonRegex = { $regex: string; $options?: string };
export type ValueComparisonNot<T = any> = {
    $not: ValueComparisonRange<T> | ValueComparisonContains | ValueComparisonNe<T>
          | ValueComparisonIn<T> | ValueComparisonNin<T> | ValueComparisonRegex
};
```

### New array comparison types

```ts
export type ArrayValueComparisonAll<T = any> = { $all: T[] };
export type ArrayValueComparisonSize = { $size: number };
```

### Update ValueComparisonFlexi

Add the new operators to the union. `ValueComparisonFlexi<T>` becomes:
```ts
export type ValueComparisonFlexi<T = any> =
    (T extends string
        ? ValueComparisonString | ValueComparisonRegex
        : T extends number
            ? ValueComparisonRangeNumeric
            : never)
    | ValueComparisonNe<T>
    | ValueComparisonIn<T>
    | ValueComparisonNin<T>
    | ValueComparisonNot<T>
    | ValueComparisonExists
    | ValueComparisonType
    | T;
```

### Update ArrayValueComparison

```ts
export type ArrayValueComparison<T = any> =
    ArrayValueComparisonElemMatch<T>
    | ArrayValueComparisonAll<T>
    | ArrayValueComparisonSize;
```

---

## Step 3: Schemas & Typeguards (`schemas.ts`, `typeguards.ts`)

### New Zod schemas in `schemas.ts`

```ts
const ValueComparisonNeSchema = z.object({ $ne: z.union([z.string(), z.number()]) });
const ValueComparisonInSchema = z.object({ $in: z.array(z.union([z.string(), z.number()])) });
const ValueComparisonNinSchema = z.object({ $nin: z.array(z.union([z.string(), z.number()])) });
const ValueComparisonExistsSchema = z.object({ $exists: z.boolean() });
const ValueComparisonTypeSchema = z.object({
    $type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null'])
});
const ValueComparisonRegexSchema = z.object({
    $regex: z.string(),
    $options: z.string().optional()
});
// $not wraps non-scalar operators:
const ValueComparisonNotSchema = z.object({
    $not: z.union([
        ValueComparisonContainsSchema,
        ValueComparisonRangeNumericSchema,
        ValueComparisonNeSchema,
        ValueComparisonInSchema,
        ValueComparisonNinSchema,
        ValueComparisonRegexSchema,
    ])
});

const ArrayValueComparisonAllSchema = z.object({ $all: z.array(z.union([z.string(), z.number()])) });
const ArrayValueComparisonSizeSchema = z.object({ $size: z.number().int().nonnegative() });
```

### Update ValueComparisonSchema

```ts
const ValueComparisonSchema = z.union([
    ValueComparisonScalarSchema,
    ValueComparisonContainsSchema,
    ValueComparisonRangeNumericSchema,
    ValueComparisonNeSchema,
    ValueComparisonInSchema,
    ValueComparisonNinSchema,
    ValueComparisonNotSchema,
    ValueComparisonExistsSchema,
    ValueComparisonTypeSchema,
    ValueComparisonRegexSchema,
]);
```

### Update ArrayValueComparisonSchema

```ts
const ArrayValueComparisonSchema = z.union([
    ArrayValueComparisonElemMatchSchema,
    ArrayValueComparisonAllSchema,
    ArrayValueComparisonSizeSchema,
]);
```

### New typeguard functions in `schemas.ts`

```ts
export function isValueComparisonNe(x: unknown, proved?: boolean): x is ValueComparisonNe {
    return (proved || isPlainObject(x)) && "$ne" in x;
}
export function isValueComparisonIn(x: unknown, proved?: boolean): x is ValueComparisonIn {
    return (proved || isPlainObject(x)) && "$in" in x;
}
export function isValueComparisonNin(x: unknown, proved?: boolean): x is ValueComparisonNin {
    return (proved || isPlainObject(x)) && "$nin" in x;
}
export function isValueComparisonNot(x: unknown, proved?: boolean): x is ValueComparisonNot {
    return (proved || isPlainObject(x)) && "$not" in x;
}
export function isValueComparisonExists(x: unknown, proved?: boolean): x is ValueComparisonExists {
    return (proved || isPlainObject(x)) && "$exists" in x;
}
export function isValueComparisonType(x: unknown, proved?: boolean): x is ValueComparisonType {
    return (proved || isPlainObject(x)) && "$type" in x;
}
export function isValueComparisonRegex(x: unknown, proved?: boolean): x is ValueComparisonRegex {
    return (proved || isPlainObject(x)) && "$regex" in x;
}
export function isArrayValueComparisonAll(x: unknown): x is ArrayValueComparisonAll {
    return ArrayValueComparisonAllSchema.safeParse(x).success;
}
export function isArrayValueComparisonSize(x: unknown): x is ArrayValueComparisonSize {
    return ArrayValueComparisonSizeSchema.safeParse(x).success;
}
```

---

## Step 4: JS Matching (`matchJavascriptObject.ts`)

### 4a. Handle `$exists` and `$type` in `_matchJavascriptObject`

Insert AFTER the undefined/spreading check (line ~145) and BEFORE the `Array.isArray(objectValue)` check (line ~147):

```ts
// Handle $exists before array/scalar branching — it checks the value itself
if (isValueComparisonExists(dotpropFilter)) {
    if (dotpropFilter.$exists) {
        return objectValue !== undefined && objectValue !== null;
    } else {
        return objectValue === undefined || objectValue === null;
    }
}

// Handle $type before array/scalar branching — it checks the value's type
if (isValueComparisonType(dotpropFilter)) {
    return checkJsType(objectValue, dotpropFilter.$type);
}
```

`checkJsType` helper:
```ts
function checkJsType(value: any, expectedType: string): boolean {
    if (value === undefined || value === null) {
        return expectedType === 'null';
    }
    switch (expectedType) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number';
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return isPlainObject(value) && !Array.isArray(value);
        case 'null': return value === null;
        default: return false;
    }
}
```

### 4b. Add new operators to `compareValue`

Insert new branches AFTER the existing `isValueComparisonContains` check and BEFORE the `isValueComparisonRangeFlexi` check. Order matters: all `$`-prefixed operator checks must come before the deep-equality fallthrough.

```ts
// $ne
if (isValueComparisonNe(filterValue, true)) {
    if (value === undefined || value === null) return true; // MongoDB: ne matches missing
    return value !== filterValue.$ne;
}

// $in
if (isValueComparisonIn(filterValue, true)) {
    if (value === undefined || value === null) return false;
    return filterValue.$in.includes(value);
}

// $nin
if (isValueComparisonNin(filterValue, true)) {
    if (value === undefined || value === null) return true; // MongoDB: nin matches missing
    return !filterValue.$nin.includes(value);
}

// $not — negate inner comparison
if (isValueComparisonNot(filterValue, true)) {
    if (value === undefined || value === null) return true; // MongoDB: $not matches missing
    return !compareValue(value, filterValue.$not);
}

// $regex
if (isValueComparisonRegex(filterValue, true)) {
    if (typeof value !== 'string') return false;
    const regex = new RegExp(filterValue.$regex, filterValue.$options);
    return regex.test(value);
}
```

### 4c. Add `$in`, `$nin`, `$all`, `$size` to `compareArray`

Insert new branches after the `isArrayValueComparisonElemMatch` check and before the compound filter fallthrough:

```ts
// $in on array: at least one element must be in the list
if (isValueComparisonIn(filterValue)) {
    return filterValue.$in.some(v => value.includes(v));
}

// $nin on array: no element may be in the list
if (isValueComparisonNin(filterValue)) {
    return !filterValue.$nin.some(v => value.includes(v));
}

// $all: array must contain all specified values
if (isArrayValueComparisonAll(filterValue)) {
    return filterValue.$all.every(v => value.includes(v));
}

// $size: array must have exactly N elements
if (isArrayValueComparisonSize(filterValue)) {
    return value.length === filterValue.$size;
}
```

---

## Step 5: SQL Builders (`postgresWhereClauseBuilder.ts`, `sqliteWhereClauseBuilder.ts`)

### 5a. `generateComparison` — new branches (both builders)

Add BEFORE the `isValueComparisonScalar` check (since new operators are plain objects with `$` keys). Each needs Postgres-specific and SQLite-specific SQL.

**$ne:**
- Postgres: `(column IS NULL OR column != $N)` (to match MongoDB's missing-field behavior)
- SQLite: `(column IS NULL OR column != ?)`
- For non-optional fields, simplify to `column != $N`

**$in:**
- Postgres: `column IN ($1, $2, ...)` — generate a placeholder for each array element
- SQLite: `column IN (?, ?, ...)`

**$nin:**
- Postgres: `(column IS NULL OR column NOT IN ($1, $2, ...))` (missing → matches)
- SQLite: same pattern

**$not:**
- Postgres: `(column IS NULL OR NOT (inner_clause))` — recurse into `generateComparison` with the inner expression, then wrap with NOT
- SQLite: same pattern

**$exists:**
- Postgres: `$exists: true` → `column IS NOT NULL`; `$exists: false` → `column IS NULL`
- SQLite: same

**$type:**
- Postgres: `jsonb_typeof(column) = $N` — type name mapping: string→'string', number→'number', boolean→'boolean', object→'object', array→'array', null→'null'
- SQLite: `json_type(column) = ?` — type name mapping: string→'text', number→`IN ('integer','real')`, boolean→`IN ('true','false')`, object→'object', array→'array', null→'null'

**$regex:**
- Postgres: `column ~ $N` (case-sensitive); with `$options: 'i'` → `column ~* $N`
- SQLite: push `WhereClauseError` to the `errors` array (`{sub_filter: <the $regex filter>, root_filter, message: '$regex is not supported in SQLite'}`) and return `'FALSE'` as placeholder SQL.

### 5b. `generateSql` — array-level operators

In the array-path branch (where `countArraysInPath > 0`), add detection for `$all` and `$size` before the `$elemMatch` check.

**$all on arrays:**
- Postgres: For each value in `$all`, generate `EXISTS (SELECT 1 FROM jsonb_array_elements(column) AS elem WHERE elem #>> '{}' = $N)`, join with AND.
- SQLite: For each value, `EXISTS (SELECT 1 FROM json_each(column, '$.path') WHERE value = ?)`, join with AND.

**$size on arrays:**
- Postgres: `jsonb_array_length(column) = $N`
- SQLite: `json_array_length(column, '$.path') = ?`

**$in/$nin on arrays:**
- Detect `isValueComparisonIn`/`isValueComparisonNin` in the array-path branch.
- Postgres $in: `EXISTS (SELECT 1 FROM jsonb_array_elements(column) AS elem WHERE elem #>> '{}' IN ($1, $2, ...))`.
- Postgres $nin: `NOT EXISTS (SELECT 1 FROM jsonb_array_elements(column) AS elem WHERE elem #>> '{}' IN ($1, $2, ...))`.
- SQLite: same pattern with `json_each`.

---

## Step 6: Implementation Order

Implement in rounds to progressively make tests pass:

**Round 0 — Result type migration (Step 0):**
1. Add `WhereClauseError` and `PreparedWhereClauseResult` types
2. Update `IPropertyMap` interface with `errors` and `root_filter` params
3. Update `buildWhereClause` and `whereClauseBuilder` in engine
4. Update both dialect builders: convert throws → error pushes, update signatures
5. Rename snake_case properties (`where_clause_statement`, `statement_arguments`)
6. Update all callers and existing tests to unwrap the result
7. Run tests — all existing tests must still pass (no new operators yet)

**Round 1 — Simple operators ($ne, $exists, $size):**
1. Add types, schemas, typeguards for $ne, $exists, $size
2. Add `$exists` and `checkJsType` handler in `_matchJavascriptObject` (early exit)
3. Add `$ne` branch in `compareValue`
4. Add `$size` branch in `compareArray`
5. Add SQL for $ne, $exists, $size in both builders
6. Run tests — ~13 tests should pass

**Round 2 — Membership operators ($in, $nin):**
1. Add types, schemas, typeguards for $in, $nin
2. Add `$in`/`$nin` branches in `compareValue`
3. Add `$in`/`$nin` branches in `compareArray`
4. Add SQL for $in, $nin in both builders (scalar and array paths)
5. Run tests — ~12 more tests should pass

**Round 3 — Negation ($not):**
1. Add types, schemas, typeguards for $not
2. Add `$not` branch in `compareValue` (recursive call)
3. Add SQL for $not in both builders (NOT wrapper + recursive generateComparison)
4. Run tests — ~5 more tests should pass

**Round 4 — Type and regex ($type, $regex):**
1. Add types, schemas, typeguards for $type, $regex
2. Add `$type` handler in `_matchJavascriptObject` (early exit)
3. Add `$regex` branch in `compareValue`
4. Add SQL for $type in both builders (dialect-specific type function)
5. Add SQL for $regex in Postgres; SQLite pushes `WhereClauseError` and returns `'FALSE'`
6. Run tests — ~12 more operator tests + builder error tests should pass

**Round 5 — Array containment ($all):**
1. Add types, schemas, typeguards for $all
2. Add `$all` branch in `compareArray`
3. Add SQL for $all in both builders (multiple EXISTS subqueries joined with AND)
4. Run tests — ~4 more tests should pass

**Round 6 — Final verification:**
1. Run full test suite (all ~681+ tests)
2. Update JSDoc on `WhereFilterDefinition` in `types.ts` to document new operators
3. Mark Phase 5 as complete
