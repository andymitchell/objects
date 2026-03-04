# Goal

Extend what a Write Action can do with Mongo-esque `addToSet` + `pull` + `push` (on array properties), and `inc` (on number properties).
They are specific `update` actions, in comparison to the current generic `update` write payload. 

It will work with the type system (limiting what paths these can be used on to match their type). 

It will be thoroughly tested. 

# Context

The current system has an 'update' that applies a partial delta change to any object matching the Where Filter. See ` WriteActionPayloadUpdate` in @./types.ts

This works great, but can collide if multiple updates try to occur at once. The proposed changes allow multiple property changes without conflict. 

# Constraints 
Don't try to alter how it identifies arrays with the helper types - this has already been done (it was used in array_scope). 
Note array_scope is important to know about - it basically namespaces/scopes the write actions to each object in an array (that becoming the new start point). 





# Relevant Files

@./types.ts
@./write-action-schemas.ts
@./applyWritesToItems/types.ts
@./applyWritesToItems/schemas.ts
@./applyWritesToItems/applyWritesToItems.ts
@./applyWritesToItems/applyWritesToItems.test.ts




# Proposed New Types

**Decision: Option A** — each mutation is a separate payload type in the `WritePayload` discriminated union.

## New Helper Types

```ts
// In dot-prop-paths/types.ts

/** Keys of T whose value is any variable-length array (scalar or object). Excludes tuples. */
type ArrayProperty<T> = {
    [P in keyof T]: NonNullable<T[P]> extends Array<any>
        ? number extends NonNullable<T[P]>['length'] ? P : never  // exclude tuples
        : never
}[keyof T];

/** Element type of the array at key P. */
type ArrayElement<T extends Record<string, any>, P extends keyof T> =
    NonNullable<T[P]> extends Array<infer U> ? U : never;

/** Keys of T whose value is generic number (excludes literal types like 1 | 2). */
type NumberProperty<T> = {
    [P in keyof T]: NonNullable<T[P]> extends number
        ? number extends NonNullable<T[P]> ? P : never  // bidirectional: excludes literals
        : never
}[keyof T];
```

Scope: **top-level keys only** (no dot-prop paths). Consistent with how `WritePayloadUpdate.data` uses `Pick<T, NonObjectArrayProperty<T>>`. For nested access through object-arrays, compose with `array_scope`.

## New Payload Types

All array mutation types use a **mapped-type-to-union** pattern: the type maps over each possible `path` value, producing a discriminated union. This means TypeScript narrows `items` / `items_where` automatically when the consumer sets `path`.

```ts
// In write-actions/types.ts

/** Mapped-type-to-union: produces one union variant per array property P.
 *  Discriminated on `path` — setting path narrows items type automatically. */
type WritePayloadAddToSet<T extends Record<string, any>> = {
    [P in ArrayProperty<T>]: {
        type: 'add_to_set',
        path: P,
        items: ArrayElement<T, P>[],        // always an array, even for one item
        unique_by: 'deep_equals' | 'pk',    // pk = DDL primary_key for that list
        where: WhereFilterDefinition<T>
    }
}[ArrayProperty<T>]

type WritePayloadPush<T extends Record<string, any>> = {
    [P in ArrayProperty<T>]: {
        type: 'push',
        path: P,
        items: ArrayElement<T, P>[],
        where: WhereFilterDefinition<T>
    }
}[ArrayProperty<T>]

/** Pull uses conditional items_where:
 *  - Object arrays → WhereFilterDefinition (full filter)
 *  - Scalar arrays → ArrayElement<T,P>[] (value list to remove, like $pullAll) */
type WritePayloadPull<T extends Record<string, any>> = {
    [P in ArrayProperty<T>]: {
        type: 'pull',
        path: P,
        items_where: ArrayElement<T, P> extends Record<string, any>
            ? WhereFilterDefinition<ArrayElement<T, P>>
            : ArrayElement<T, P>[],
        where: WhereFilterDefinition<T>
    }
}[ArrayProperty<T>]

type WritePayloadInc<T extends Record<string, any>> = {
    type: 'inc',
    path: NumberProperty<T>,
    amount: number,             // negative for decrement
    where: WhereFilterDefinition<T>
}
```

## Updated Union

```ts
type WritePayload<T extends Record<string, any>> =
    | WritePayloadCreate<T>
    | WritePayloadUpdate<T>
    | WritePayloadDelete<T>
    | WritePayloadArrayScope<T>
    | WritePayloadAddToSet<T>
    | WritePayloadPush<T>
    | WritePayloadPull<T>
    | WritePayloadInc<T>;
```

## Key Design Decisions

1. **Top-level keys, not dot-prop paths** — matches `update`'s existing constraint. Compose with `array_scope` for nesting.
2. **`unique_by` required on `addToSet`** — forces explicit choice between PK-based or deep-equals uniqueness. `'pk'` only valid for object arrays (runtime check); for scalar arrays use `'deep_equals'`.
3. **`pull` uses `items_where: WhereFilterDefinition`** — leverages the existing where-filter system to match elements for removal. Works for both scalar and object arrays.
4. **`push` always appends** (no `position` option in V1).
5. **`inc` supports negative `amount`** — no need for a separate `dec` payload.
6. **Not routed through `WriteStrategy`** — semantics are fixed (push is push, inc is inc). Handled directly in `applyWritesToItems`, same as `delete`/`array_scope`.
7. **Auto-composable with `array_scope`** — since they're in `WritePayload`, they become valid sub-actions for `array_scope` with no additional work.
8. **CRDT-friendly** — each operation has its own `WriteAction` UUID/timestamp for conflict resolution.

# Understanding Type Helpers

## Property-Type Detection (dot-prop-paths/types.ts)

Recursive conditional mapped types iterate over `keyof T`, testing each property's value type. Pattern:

```ts
type FooProperties<T> = {
    [P in keyof T]: NonNullable<T[P]> extends SomeConstraint ? P : never
}[keyof T];  // resolves to union of matching key names
```

**Existing helpers:**

| Helper | Resolves to | Used in |
|---|---|---|
| `ScalarProperties<T>` | Keys where value is `string\|number\|boolean\|null\|undefined` | Dot-path walkers |
| `PrimaryKeyProperties<T>` | Keys where value is `PrimaryKeyValue` (string\|number) | DDL `primary_key`, `order_by` |
| `ObjectProperties<T>` | Keys where value is object AND NOT array | Dot-path walkers |
| `NonArrayProperty<T>` | Keys where value is NOT any array | `NonObjectArrayProperty` |
| `ArrayOfScalarProperties<T>` | Keys where value is `Array<Scalar>` | `NonObjectArrayProperty` |
| `NonObjectArrayProperty<T>` | `NonArrayProperty \| ArrayOfScalarProperties` — everything except object-arrays | `WritePayloadUpdate.data` (restricts what `update` can touch) |

**Dot-prop path resolvers (recursive, with depth guards):**

| Helper | What it finds |
|---|---|
| `DotPropPathToArraySpreadingArrays<T>` | All dot-paths leading to ANY array (scalar or object) |
| `DotPropPathToObjectArraySpreadingArrays<T>` | Dot-paths leading to arrays-of-objects only |
| `DotPropPathValidArrayValue<T, P>` | Given path P → element type of the array at that path (as `Record`) |
| `PathValue<T, P>` | Value type at any dot-prop path |

**Not yet existing but easy to create following the same pattern:**
- `NumberProperties<T>` — keys where `NonNullable<T[P]> extends number`
- Could also create a dot-path walker variant for number-valued paths if needed

## DDL & Primary Keys

`DDL<T>` auto-generates a `lists` object:

```ts
{
  lists: {
    '.': ListRules<T>,                           // root list
    [K in DotPropPathToObjectArraySpreadingArrays<T>]:
      ListRules<EnsureRecord<DotPropPathValidArrayValue<T, K>>>
  }
}
```

Every nested object-array path becomes a key in `lists`. Each `ListRules<T>` has:
- `primary_key`: constrained to `PrimaryKeyProperties<T>` (only string/number-valued keys of the element type)
- `order_by`: `ListOrdering<T>` with `key` also constrained to `PrimaryKeyProperties<T>`
- Optional: `pre_triggers`, `write_strategy` (lww | custom), `growset`

**Key insight for new mutations:** `addToSet` uniqueness can use the `primary_key` from the DDL's list rules for the targeted array path. The DDL already knows the PK for every object-array in the type hierarchy.

# What Works in SQL too?

All mutations are expressible as **single UPDATE statements** in both engines (no multi-statement transactions needed). Objects stored in a `jsonb` column (PG) or `TEXT`/`json` column (SQLite).

## Summary

| Mutation | PostgreSQL | SQLite | Notes |
|---|---|---|---|
| **push** | `jsonb_set` + `\|\|` concat | `json_insert(col, '$.path[#]', val)` (variadic for multiple) | Trivial in both |
| **addToSet (scalars)** | `@>` containment + CASE | `UNION` dedup via `json_group_array` | Single statement in both |
| **addToSet (objects, pk)** | `EXISTS` + `jsonb_array_elements` checking `->>'id'` | `json_extract(value, '$.id')` in `json_each` WHERE | Single statement in both |
| **addToSet (objects, deep_equals)** | `jsonb =` structural equality (key-order independent) | **Unreliable** — text comparison, key order preserved not normalized | See below |
| **addToSet (multi-item)** | Correlated `jsonb_agg` over candidates filtering existing | Same pattern with `json_group_array` + `json_each` | Single statement in both |
| **pull (scalars)** | `jsonb_agg` + filter, or `-` operator | `json_group_array` + `json_each` WHERE filter | Single statement in both |
| **pull (objects, pk)** | `jsonb_agg` + `WHERE elem->>'id' != ALL(...)` | `json_group_array` + `WHERE json_extract(value, '$.id') NOT IN (...)` | Single statement in both |
| **pull (objects, deep_equals)** | `jsonb_agg` + `WHERE elem != target::jsonb` | Unreliable (same key-order issue) | See below |
| **inc** | `jsonb_set` + `to_jsonb((col->>'path')::numeric + n)` | `json_set(col, '$.path', json_extract(col, '$.path') + n)` | Trivial in both |

## The deep_equals Problem in SQLite

PostgreSQL `jsonb` normalises key order at storage time — `'{"a":1,"b":2}'::jsonb = '{"b":2,"a":1}'::jsonb` is `TRUE`. Structural equality works.

SQLite's `json()` strips whitespace but **does not reorder keys**. `json('{"a":1,"b":2}') = json('{"b":2,"a":1}')` is `FALSE`. Deep-equals on objects is unreliable unless key order is controlled at write time.

**Mitigation options:**
1. Control key ordering at application level (serialize with sorted keys). Fragile.
2. For `addToSet` deep_equals: fall back to comparing every known field via `json_extract`. Requires schema knowledge at SQL generation time. Feasible but verbose.
3. Perform read-modify-write in application code (SELECT, deduplicate in JS, UPDATE). Loses atomicity unless wrapped in a transaction with row locking.

**Recommendation:** For SQLite, `addToSet` and `pull` with `deep_equals` on object arrays should use option 2 (field-by-field comparison) or document as a known limitation that requires `'pk'` mode instead.

## Engine-Specific Gotchas

**PostgreSQL:**
- `jsonb_agg` returns `NULL` on zero rows → always wrap with `COALESCE(..., '[]'::jsonb)`
- `to_jsonb()` preferred over `::text::jsonb` cast chain for `inc`

**SQLite:**
- `json_group_array` returns `'[]'` on zero rows (not NULL) — no COALESCE needed for empty arrays
- `json_each` value column: scalars are unquoted text; objects/arrays are JSON text → wrap objects with `json(value)` when re-inserting via `json_group_array`
- `json_insert` is variadic: `json_insert(col, '$.arr[#]', v1, '$.arr[#]', v2)` appends both
- Guard `inc` against missing path: `COALESCE(json_extract(col, '$.path'), 0) + amount`

## Verdict

Nothing is too difficult to replicate in SQL. All mutations are expressible as single UPDATE statements in both engines. The one limitation is **deep_equals on objects in SQLite** which requires field-by-field comparison or application-level normalization. Recommend steering users toward `'pk'` mode for object arrays in SQLite.

# Learning From Mingo

Source: [kofrasa/mingo](https://github.com/kofrasa/mingo) — MongoDB query language for in-memory JS collections. Studied their `$addToSet`, `$push`, `$pull`, `$inc` update operator implementations.

## Architecture — Implementation Tips

1. **Separate path traversal from operator logic.** Mingo's operators are 30–80 LOC each. All path resolution, positional operator handling, and graph building lives in shared infra (`walkExpression`, `applyUpdate`). Each operator is just a `(container, key) => boolean` callback. We should follow this: our `applyWritesToItems` should dispatch to per-type handlers that receive the resolved target object and key.

2. **Normalise single-item and multi-item forms early.** Both `$push` and `$addToSet` immediately normalise a bare value into `{ $each: [val] }`. This eliminates branching — there's only one code path. Our `items: T[]` field (always an array) already does this at the type level.

3. **Return a boolean "did-modify" signal from every operator.** Mingo propagates `true/false` up through the call chain. This matters for accurate change counting and for short-circuiting no-op writes. We should do the same in each handler.

4. **Clone at assignment, not at input.** Mingo does NOT clone the entire document before applying updates — only the *values being inserted* (`clone(args.$each, options)`). Full-document cloning caused a 70k+ deep-clone performance regression (Issue #202). Our immutability constraint means we should structurally share unchanged branches and only copy the path being mutated (like a persistent data structure update).

## `addToSet` — Implementation Tips

5. **Deep equality needs a value-based set, not reference equality.** Mingo uses a custom `HashMap` with FNV-1a hashing + recursive `isEqual` for bucket confirmation. For our `deep_equals` mode we need equivalent semantics. Consider using `JSON.stringify` with sorted keys for scalar-array dedup (cheap) and a proper structural compare for object arrays.

6. **Mingo's dedup is O(n) per operation — we can do better.** `unique(prev.concat(args.$each))` rebuilds the entire HashMap every time, even if only checking 1 new item against 1000 existing. For our `add_to_set`, iterate only the new `items` and check membership against the existing array. Short-circuit on first duplicate found per item.

7. **Change detection via length comparison is elegant.** After dedup, if `result.length === original.length`, nothing was added → no-op. Simple and correct.

8. **`pk` mode should extract and compare only the primary key field(s)**, not the full object. This is cheaper than deep equality and matches how our DDL already declares `primary_key` per list.

## `push` — Implementation Tips

9. **Execution order for modifiers is insert → sort → slice.** This matches MongoDB's documented behaviour and produces deterministic results. We don't need `$sort`/`$slice`/`$position` in V1 (plain append), but if added later, this order is mandatory.

10. **Building a new array vs splicing in-place.** Mingo splices in-place then takes a snapshot for change detection. Given our immutability constraint, we should build a new array: `[...existing, ...newItems]`.

## `pull` — Implementation Tips

11. **Two matching modes: value match vs document match.** Mingo's `$pull` detects whether the condition contains operator keys (`$in`, `$gte`, etc.) and wraps accordingly. Our design uses `items_where: WhereFilterDefinition` — the existing where-filter system handles both simple value matching and complex queries uniformly.

12. **Build a new filtered array, never splice-while-iterating.** Mingo builds `curr = []` by pushing non-matching elements. This avoids index-shift bugs from forward-loop splicing. We should do the same: `existing.filter(...)`.

13. **`$pullAll` is just `$pull` with `$in`.** Thin wrapper pattern — worth knowing but our `pull` with `items: T[]` already covers this.

## `inc` — Implementation Tips

14. **Missing field (`undefined`) should initialise to 0, then increment.** Mingo does `o[k] ||= 0; o[k] += val`. This means `$inc: { count: 5 }` on a document without `count` sets it to `5`. We should match this.

15. **`null` is NOT treated as 0 — it's a type error (no-op).** Mingo's `isNumber(null)` returns false, so `$inc` on a `null` field silently no-ops. We should decide: error or no-op. Recommendation: return a `WriteError` since `null` likely indicates a schema mistake.

16. **Beware `||= 0` vs `??= 0`.** Mingo uses `||=` which treats `0` as falsy (assigns `0` to `0` — harmless but wasteful) and would also convert `NaN` to `0`. We should use `??= 0` (nullish coalescing assignment) which only triggers on `null`/`undefined`, correctly preserving an existing `0`.

## General Edge Cases — Implementation Tips

17. **`buildGraph`: auto-create intermediate objects for missing path segments.** `$inc: { "a.b.c": 1 }` on `{}` must produce `{ a: { b: { c: 1 } } }`. Mingo fixed this in Issues #384/#385. Since we only support top-level keys (no dot-paths), this is N/A for V1 but critical if dot-path support is ever added.

18. **Path conflict detection.** Mingo validates that no update path is a prefix of another (`"a.b"` and `"a"` conflict). N/A for our top-level-only V1, but worth noting for future.

19. **Never share mutable state across recursive calls.** Mingo had a critical bug (#592) where a shared `SCRATCH_KEYS` array was corrupted by recursive hash computation. Always use local variables in recursive functions.

20. **`undefined` vs `null` must be clearly distinguished.** Convention: `undefined` = missing field (auto-create/initialise). `null` = explicit null (type error for numeric/array operators). MongoDB follows this and so should we.

## Anti-Patterns to Avoid

- **In-place mutation of input documents.** Mingo mutates directly; users hit bugs where source collections were corrupted (Issues #195, #387). Our immutability constraint avoids this by design.
- **`toString()`-based equality for custom types.** Fragile, broke in mingo v6.5.1 (#529). We should use structural comparison only.
- **Single-key sort limitation in `$push`.** Mingo only supports one sort key. If we ever add `$sort`, support compound from day one.
- **Defaulting to expensive deep clone.** Mingo's perf regression (#202) from default deep-clone was severe. Clone surgically.

# Edge Case Behaviours

Each case is labelled with a severity: **must-handle** (incorrect results or crash without it), **should-handle** (surprising UX), **nice-to-have** (polish).

---

## `add_to_set`

### Target field state
| # | Case | Expected | Severity |
|---|------|----------|----------|
| A1 | Field exists and is an array | Normal path — dedup + append | must-handle |
| A2 | Field is `undefined` (missing on object) | Initialise to `[]`, then add all items | must-handle |
| A3 | Field is `null` | WriteError — `null` is not an array | must-handle |
| A4 | Field is a non-array value (string, number, object) | WriteError — type mismatch | must-handle |

### Items input
| # | Case | Expected | Severity |
|---|------|----------|----------|
| A5 | `items: []` (empty array) | No-op, no error | must-handle |
| A6 | `items` with one element | Adds if not present, no-op if duplicate | must-handle |
| A7 | `items` with multiple elements, none duplicated | All added | must-handle |
| A8 | `items` with multiple elements, some already in array | Only new ones added | must-handle |
| A9 | `items` with multiple elements, ALL already in array | No-op (no change) | must-handle |
| A10 | `items` contains internal duplicates (e.g. `[x, x]`) | Deduplicate — only one `x` added | must-handle |

### `unique_by: 'deep_equals'` specifics
| # | Case | Expected | Severity |
|---|------|----------|----------|
| A11 | Scalar array (`string[]`, `number[]`) | Equality by value (`===`) | must-handle |
| A12 | Object array, same values different key order (`{a:1,b:2}` vs `{b:2,a:1}`) | Treated as equal | must-handle |
| A13 | Object array, nested objects | Deep recursive equality | must-handle |
| A14 | Objects with `undefined` vs missing key (`{a:1, b:undefined}` vs `{a:1}`) | Decide: treat as equal or different? Recommend **equal** (match JSON semantics — both serialise to `{a:1}`) | should-handle |
| A15 | `NaN === NaN` in arrays | Should treat as equal (unlike `===`). Use `Object.is` semantics | should-handle |
| A16 | `null` elements in array | Valid — `null` is a legitimate array element | must-handle |
| A17 | Mixed types in array (e.g. `[1, "1"]`) | Not equal — no type coercion | must-handle |
| A18 | Date objects in array | Not expected in our system (JSON-serialisable only) — can ignore or error | nice-to-have |

### `unique_by: 'pk'` specifics
| # | Case | Expected | Severity |
|---|------|----------|----------|
| A19 | Object array with DDL-defined PK — item has same PK as existing | Skip (not added) | must-handle |
| A20 | Object array with DDL-defined PK — item has new PK | Added | must-handle |
| A21 | Used on a scalar array (no PK possible) | WriteError — `'pk'` requires object elements with a DDL list entry | must-handle |
| A22 | DDL has no list entry for the targeted path | WriteError — can't resolve PK | must-handle |
| A23 | Item missing the PK field entirely | WriteError — PK must be present on every item | must-handle |
| A24 | Existing element missing the PK field | Treat as non-matching (it can't collide) or WriteError. Recommend WriteError — data integrity issue | should-handle |
| A25 | Same PK but different other fields (PK match, data differs) | NOT added — addToSet only checks uniqueness, not upsert | must-handle |

### Where filter
| # | Case | Expected | Severity |
|---|------|----------|----------|
| A26 | `where: {}` (match all) | Applies to every item in the list | must-handle |
| A27 | `where` matches zero items | No-op, no error | must-handle |
| A28 | `where` matches multiple items | Applies to each matched item independently | must-handle |

---

## `push`

### Target field state
| # | Case | Expected | Severity |
|---|------|----------|----------|
| P1 | Field exists and is an array | Append items to end | must-handle |
| P2 | Field is `undefined` (missing) | Initialise to `[]`, then push items (result = items) | must-handle |
| P3 | Field is `null` | WriteError | must-handle |
| P4 | Field is a non-array value | WriteError | must-handle |

### Items input
| # | Case | Expected | Severity |
|---|------|----------|----------|
| P5 | `items: []` (empty) | No-op, no error | must-handle |
| P6 | `items` with duplicates of existing | Appended anyway (push has no uniqueness) | must-handle |
| P7 | `items` preserves order | Items appear in array in the same order as provided | must-handle |
| P8 | Push to scalar array (`string[]`) | Works — elements are scalars | must-handle |
| P9 | Push to object array | Works — elements are objects | must-handle |

### Where filter
| # | Case | Expected | Severity |
|---|------|----------|----------|
| P10 | Same cases as A26–A28 | Same behaviour | must-handle |

---

## `pull`

### Target field state
| # | Case | Expected | Severity |
|---|------|----------|----------|
| R1 | Field exists and is an array with elements | Normal path — filter out matches | must-handle |
| R2 | Field exists and is an empty array | No-op (nothing to remove) | must-handle |
| R3 | Field is `undefined` (missing) | No-op, no error (nothing to pull from) | must-handle |
| R4 | Field is `null` | WriteError | must-handle |
| R5 | Field is a non-array value | WriteError | must-handle |

### `items_where` matching
| # | Case | Expected | Severity |
|---|------|----------|----------|
| R6 | `items_where: {}` (empty — matches all) | All elements removed, array becomes `[]` | must-handle |
| R7 | `items_where` matches some elements | Those elements removed, others preserved | must-handle |
| R8 | `items_where` matches all elements | Array becomes `[]` | must-handle |
| R9 | `items_where` matches no elements | No-op | must-handle |
| R10 | Multiple copies of same value in array, where filter matches them | ALL copies removed (pull removes every match, not just first) | must-handle |
| R11 | Match by PK field (e.g. `items_where: { id: '1' }`) | Removes elements with matching PK | must-handle |
| R12 | Match by non-PK fields (e.g. `items_where: { status: 'done' }`) | Removes elements matching the filter | must-handle |
| R13 | Scalar array pull (e.g. `items_where: { $eq: 'x' }`) | Works if WhereFilter supports scalar matching, otherwise document limitation | should-handle |

### Where filter
| # | Case | Expected | Severity |
|---|------|----------|----------|
| R20 | Same cases as A26–A28 | Same behaviour | must-handle |

---

## `inc`

### Target field state
| # | Case | Expected | Severity |
|---|------|----------|----------|
| I1 | Field exists and is a number | Add `amount` to it | must-handle |
| I2 | Field is `undefined` (missing) | Initialise to `0`, then add `amount` (result = `amount`) | must-handle |
| I3 | Field is `null` | WriteError — `null` is not a number | must-handle |
| I4 | Field is a string (e.g. `"5"`) | WriteError — no type coercion | must-handle |
| I5 | Field is `NaN` | WriteError — `NaN` is technically `number` type but not a useful value | should-handle |
| I6 | Field is `Infinity` or `-Infinity` | Decide: allow or error. Recommend: allow (valid IEEE 754, let schema validation catch if unwanted) | should-handle |

### Amount input
| # | Case | Expected | Severity |
|---|------|----------|----------|
| I7 | `amount: 0` | No-op (value unchanged). Optimisation: skip if `amount === 0` | should-handle |
| I8 | `amount` positive | Increment | must-handle |
| I9 | `amount` negative | Decrement | must-handle |
| I10 | `amount` that causes overflow (e.g. `Number.MAX_SAFE_INTEGER + 1`) | JS silently loses precision. No error, but schema validation may catch unexpected values | nice-to-have |
| I11 | `amount: NaN` | WriteError or runtime guard — `x + NaN = NaN` corrupts data | must-handle |
| I12 | `amount: Infinity` | Allow — `5 + Infinity = Infinity`. Schema may reject | should-handle |

### Where filter
| # | Case | Expected | Severity |
|---|------|----------|----------|
| I13 | Same cases as A26–A28 | Same behaviour | must-handle |

---

## Cross-Cutting Edge Cases

### Schema validation after mutation
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X1 | Push produces array that violates schema (e.g. max length, element type) | WriteError from `failureTracker.testSchema` — mutation rejected | must-handle |
| X2 | Inc produces value that violates schema (e.g. negative when schema requires positive) | WriteError from schema validation | must-handle |
| X3 | Pull empties a required array (`minLength: 1`) | WriteError from schema validation | must-handle |

### Composition with `array_scope`
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X4 | `array_scope` wrapping `push` on a nested object-array's sub-array | Works by design — `push` is a `WritePayload`, valid as `array_scope.action` | must-handle |
| X5 | `array_scope` wrapping `inc` on a nested object's number field | Works | must-handle |
| X6 | `array_scope` wrapping `add_to_set` with `unique_by: 'pk'` at nested level | DDL must resolve PK for the nested path. Already handled by `DDL.lists` | must-handle |
| X7 | Nested `array_scope` → `array_scope` → `pull` (3 levels deep) | Works recursively | should-handle |

### Atomicity
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X8 | Atomic mode: first action is `push` (succeeds), second is `inc` with type error (fails) | Both rolled back | must-handle |
| X9 | Non-atomic mode: same scenario | Push committed, inc fails independently | must-handle |

### Growset interaction
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X10 | Growset enabled + `pull` | `pull` removes elements — conflicts with grow-only semantics. Decide: block `pull` on growset lists, or let `convertWriteActionToGrowSetSafe` convert to tombstone | should-handle |
| X11 | Growset enabled + `push`/`add_to_set`/`inc` | Compatible — these are additive/monotonic | should-handle |

### Change detection / no-op semantics
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X12 | `add_to_set` where all items already exist | No change detected, item reference preserved (referential stability) | must-handle |
| X13 | `push` with `items: []` | No change, reference preserved | must-handle |
| X14 | `pull` where no elements match | No change, reference preserved | must-handle |
| X15 | `inc` with `amount: 0` | No change, reference preserved | must-handle |
| X16 | Multiple mutations on same item in sequence (e.g. push then pull) | Each applies to the result of the previous, not the original | must-handle |

### Immutability contract
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X17 | Original item's array must not be mutated by push/pull/addToSet | New array created, original array reference untouched | must-handle |
| X18 | Items in the `items` param must not be mutated | Defensive copy if needed (objects inserted should be clones) | must-handle |

### Permissions
| # | Case | Expected | Severity |
|---|------|----------|----------|
| X19 | `basic_ownership_property` — user does not own the matched item | WriteError `permission_denied`, same as update/delete | must-handle |
| X20 | Permissions on new mutations follow same rules as `update` | No special permission model needed | must-handle |

# Implementation Plan Critique from Gemini

## Our Response

**Adopted:**
- **NumberProperty literal guard** — bidirectional `number extends NonNullable<T[P]>` to exclude `1 | 2` literal types. Applied to Step 1 + Proposed Types.
- **ArrayProperty tuple guard** — `number extends NonNullable<T[P]>['length']` to exclude fixed-length tuples. Applied to Step 1 + Proposed Types.
- **DDL path resolution** — `resolveDdlListRules` helper that tries `ddl.lists[path]` then `ddl.lists['.' + path]` to handle scoped DDL coordinate rewriting. Applied to Step 6a.
- **Scalar pull conditional type** — `items_where` is `WhereFilterDefinition` for object arrays, `ArrayElement<T,P>[]` (value list) for scalar arrays. Uses mapped-type-to-union so TypeScript narrows from `path`. Applied to Steps 2, 4, 6, 9.
- **Mapped-type-to-union for all array mutations** — `AddToSet`, `Push`, `Pull` all use this pattern so `path` discriminates and narrows `items`/`items_where` type. Applied to Steps 2, Proposed Types.

**Rejected:**
- **WriteStrategy extension** — `delete` and `array_scope` already bypass WriteStrategy. The `update_handler` is just a plain merge (no timestamps, no side effects). Extending it for fixed-semantics operations would be over-engineering. Instead: added JSDoc comments noting future extensibility (Step 7).
- **GrowSet integration** — `convertWriteActionToGrowSetSafe` is a stub (`// TODO`, returns `[action]` unchanged). Nothing to integrate with. When growset is implemented, all mutation types will need handling — that's future work, not V1.
- **Single file consolidation** — Project convention is "many small files > few large files" (AGENTS.md). Each handler has distinct concerns. Keeping separate files.

**Already covered in plan:**
- `unique_by: 'pk'` on scalar arrays → Edge case A21 (must-handle WriteError)
- `pull` removes all matches → Edge case R10 (must-handle, explicit)

## Raw Critique

Here is a concise, actionable critique of your implementation plan, addressing your specific questions and flagging architectural risks.

### 🚨 Critical Architectural Risks

**1. Breaking CRDT / GrowSet Semantics (Missing Edge Case)**
Your existing system uses `convertWriteActionToGrowSetSafe` to enforce CRDT rules on nested arrays. Bypassing this for `push`, `pull`, and `add_to_set` will break synchronization. 
* **Fix:** Before applying array mutations, check `ddl.lists[absolutePath]?.growset`. If true, `push`/`add_to_set` must wrap items in your standard GrowSet metadata (e.g., UUIDs, timestamps). `pull` against a GrowSet is an illegal CRDT operation unless you implement tombstones (soft deletes).

**2. WriteStrategy Abstraction Leak (Answers Q1)**
Bypassing `WriteStrategy` means any custom logic (like auto-updating an `updatedAt` timestamp, or backend-specific triggers) won't fire for `push`/`pull`/`inc`. 
* **Fix:** Do not bypass it. Extend `WriteStrategy` to either handle the new payload types via a generic `mutate_handler(payload, target)`, or map these actions to a synthetic `update` payload before passing them to `update_handler`.

### 🎯 Answers to Your Specific Questions

* **Q1 (WriteStrategy):** As noted above, bypassing it is an architectural error. Extend the strategy pattern to handle these.
* **Q2 (DDL Path Resolution):** `payload.path` is just the local key (e.g., `'tags'`). DDL lists are keyed by absolute dot-prop paths. **Fix:** Pass a `currentAbsolutePath` down your `array_scope` recursion (e.g., `scopePath ? scopePath + '.' + payload.path : payload.path`). Use this absolute path to look up `ddl.lists`.
* **Q3 (WhereFilter for Scalars):** `WhereFilterDefinition<string>` will fail or be meaningless if your filter expects object keys. **Fix:** Use a conditional type to distinguish between object-arrays and scalar-arrays:
  ```typescript
  type WritePayloadPull<T, P extends ArrayProperty<T>> = {
    type: 'pull', path: P, where: WhereFilterDefinition<T>,
    // Object arrays use WhereFilter; Scalar arrays use exact matching
    match: ArrayElement<T,P> extends Record<string, any> ? WhereFilterDefinition<ArrayElement<T,P>> : ArrayElement<T,P>[]
  }
  ```
* **Q4 (Over-engineered Files?):** Yes, 6 files in a `mutations/` subfolder for these simple operations scatters context. **Fix:** Consolidate them into a single `array-math-mutations.ts` file exporting the handlers and the `deepEquals` utility.
* **Q5 (Missing Edge Cases/TDD):** See the "Types & Edge Cases" section below.

### 🛠 Types & Edge Cases to Fix

**1. Prevent Incrementing Literals**
Your `NumberProperty<T>` type (`NonNullable<T[P]> extends number`) will match literal numbers (e.g., `type Status = 1 | 2`). Incrementing `2` yields `3`, silently breaking schema types at compile time.
* **Fix:** Use `number extends NonNullable<T[P]> ? P : never`. This ensures only generic `number` types can be incremented.

**2. Prevent Pushing to Tuples**
Your `ArrayProperty<T>` type (`extends Array<any>`) will match tuples (e.g., `[string, string]`). `push`ing to a tuple breaks its length constraint.
* **Fix:** Add a length check to ensure variable arrays: `number extends NonNullable<T[P]>['length'] ? P : never`.

**3. `unique_by: 'pk'` on Scalar Arrays**
Scalar arrays (like `string[]`) have no PK defined in the DDL. If a caller submits `add_to_set` with `unique_by: 'pk'` on a `string[]`, your system will crash looking for an undefined PK.
* **Fix:** Add a runtime guard in `applyAddToSet` that falls back to `deep_equals` or throws a clear `WriteError` if `ddl.lists[path]?.primary_key` is missing.

**4. `pull` Ambiguity**
The plan doesn't specify if `pull` removes *all* matches or just the *first*. 
* **Fix:** Explicitly document and test that `pull` removes **all** array elements matching the condition (standard DB behavior). 

### 📋 Revised Action / TDD Order

1. **Type Helpers:** Implement refined types (blocking literals and tuples).
2. **Payload Types & Zod Schemas:** Implement conditional types for `pull`.
3. **Core Wiring:** Modify `applyWritesToItems` to track and pass `currentAbsolutePath`. Extend `WriteStrategy`.
4. **Inc Handler:** Easiest to implement. TDD against `undefined` init and `NaN` guards.
5. **Push Handler:** Ensure it respects `ddl.lists[path]?.growset` wrappers.
6. **Pull Handler:** Handle Object vs Scalar arrays. Ensure tombstones/errors for GrowSets.
7. **Add_to_Set Handler:** Complex logic (deep equality + PK merges + GrowSet wrapping).
8. **Cross-cutting Tests:** Verify nested `array_scope` combinations resolve DDL paths correctly.

# Implementation Plan

## Step 1: Type Helpers (`dot-prop-paths/types.ts`)

Add 3 new mapped types following the existing `ScalarProperties<T>` pattern:

```ts
/** Keys of T whose value is any variable-length array (scalar or object). Excludes tuples. */
export type ArrayProperty<T> = {
    [P in keyof T]: NonNullable<T[P]> extends Array<any>
        ? number extends NonNullable<T[P]>['length'] ? P : never  // exclude tuples
        : never
}[keyof T];

/** Element type of array at key P. */
export type ArrayElement<T extends Record<string, any>, P extends keyof T> =
    NonNullable<T[P]> extends Array<infer U> ? U : never;

/** Keys of T whose value is generic number (excludes literal types like 1 | 2). */
export type NumberProperty<T> = {
    [P in keyof T]: NonNullable<T[P]> extends number
        ? number extends NonNullable<T[P]> ? P : never  // bidirectional: excludes literals
        : never
}[keyof T];
```

Add compile-time type assertions including:
- `ArrayProperty` matches `string[]` and `{id:string}[]` keys, excludes tuples and non-arrays
- `NumberProperty` matches `number` keys, excludes `1 | 2` literal union keys
- `ArrayElement` extracts correct element type

## Step 2: Payload Types (`write-actions/types.ts`)

Add 4 new payload types using **mapped-type-to-union** pattern for array mutations. Import `ArrayProperty`, `ArrayElement`, `NumberProperty` from `dot-prop-paths/types.ts`.

```ts
/** Mapped-type-to-union: one variant per array property. Discriminated on `path`. */
export type WritePayloadAddToSet<T extends Record<string, any>> = {
    [P in ArrayProperty<T>]: {
        type: 'add_to_set',
        path: P,
        items: ArrayElement<T, P>[],
        unique_by: 'deep_equals' | 'pk',
        where: WhereFilterDefinition<T>
    }
}[ArrayProperty<T>]

export type WritePayloadPush<T extends Record<string, any>> = {
    [P in ArrayProperty<T>]: {
        type: 'push',
        path: P,
        items: ArrayElement<T, P>[],
        where: WhereFilterDefinition<T>
    }
}[ArrayProperty<T>]

/** Pull: conditional items_where based on array element type.
 *  Object arrays → WhereFilterDefinition. Scalar arrays → value list (like $pullAll). */
export type WritePayloadPull<T extends Record<string, any>> = {
    [P in ArrayProperty<T>]: {
        type: 'pull',
        path: P,
        items_where: ArrayElement<T, P> extends Record<string, any>
            ? WhereFilterDefinition<ArrayElement<T, P>>
            : ArrayElement<T, P>[],
        where: WhereFilterDefinition<T>
    }
}[ArrayProperty<T>]

export type WritePayloadInc<T extends Record<string, any>> = {
    type: 'inc',
    path: NumberProperty<T>,
    amount: number,
    where: WhereFilterDefinition<T>
}
```

Update the `WritePayload<T>` union to include all 4.

**Compile-time type assertions** (add to types.ts or a colocated test):
- For `Pull<MyType>`: when `path: 'tags'` (scalar array), `items_where` is `string[]`
- For `Pull<MyType>`: when `path: 'sub_items'` (object array), `items_where` is `WhereFilterDefinition<{sid:string,...}>`
- `@ts-expect-error`: using WhereFilter when path is a scalar array key
- `@ts-expect-error`: using value list when path is an object array key

## Step 3: Helper Guard (`write-actions/helpers.ts`)

Extend `isUpdateOrDeleteWritePayload` to include new type strings:

```ts
x.type==='update' || x.type==='array_scope' || x.type==='delete'
    || x.type==='add_to_set' || x.type==='push' || x.type==='pull' || x.type==='inc'
```

Also update return type annotation to include the 4 new payload types.

## Step 4: Zod Schemas (`write-actions/write-action-schemas.ts`)

Inside `makeWriteActionAndPayloadSchema`, add 4 new schemas:

- `WritePayloadAddToSetSchema`: `z.object({ type: z.literal('add_to_set'), path: z.string(), items: z.array(z.any()), unique_by: z.enum(['deep_equals', 'pk']), where: WhereFilterSchema })`
- `WritePayloadPushSchema`: `z.object({ type: z.literal('push'), path: z.string(), items: z.array(z.any()), where: WhereFilterSchema })`
- `WritePayloadPullSchema`: `z.object({ type: z.literal('pull'), path: z.string(), items_where: z.union([WhereFilterSchema, z.array(z.any())]), where: WhereFilterSchema })` — items_where accepts either a WhereFilter (object arrays) or a value list (scalar arrays)
- `WritePayloadIncSchema`: `z.object({ type: z.literal('inc'), path: z.string(), amount: z.number(), where: WhereFilterSchema })`

Add all 4 to the `z.union([...])` that forms `WritePayloadSchema`.

Note: path constraints (`ArrayProperty`, `NumberProperty`) live only in the TS types — Zod uses `z.string()` for runtime. This matches how `array_scope.scope` is `z.string()` at runtime but constrained by generic at type level.

## Step 5: Exports (`write-actions/index.ts`)

Add the 4 new payload types to the `export type { ... } from "./types.ts"` block:
`WritePayloadAddToSet, WritePayloadPush, WritePayloadPull, WritePayloadInc`

Export `ArrayProperty, ArrayElement, NumberProperty` from `dot-prop-paths` barrel if not already.

## Step 6: Mutation Handlers (`applyWritesToItems/helpers/mutations/`)

Create a new internal module `applyWritesToItems/helpers/mutations/` with handlers for each mutation. Each receives `(item: T, payload, ddl, rules)` → returns `{ value: newFieldValue } | { error: WriteError }`. Separating logic from the switch keeps the main file under LOC limits.

### `applyAddToSet.ts`
1. Resolve `item[payload.path]` → validate is array or undefined (error on null / non-array).
2. If undefined, init to `[]`.
3. If `items` empty, no-op.
4. If `unique_by === 'deep_equals'`: for each new item, check existence via deep structural equality (JSON.stringify with sorted keys for scalars; recursive compare for objects, treating `undefined` ≡ missing). Only append non-duplicates. Also deduplicate within `items` themselves.
5. If `unique_by === 'pk'`: resolve PK using `resolveDdlListRules(ddl, payload.path)` (see Step 6a). Error if no list entry or scalar array. For each new item, check PK field exists (error if missing). Skip items whose PK already exists in array. Also deduplicate within `items` by PK.
6. Return new array `[...existing, ...newUnique]`.

### `applyPush.ts`
1. Resolve `item[payload.path]` → validate is array or undefined (error on null / non-array).
2. If undefined, init to `[]`.
3. If `items` empty, no-op.
4. Return `[...existing, ...payload.items]` (structuredClone items to avoid shared refs).

### `applyPull.ts`
1. Resolve `item[payload.path]` → if undefined, no-op. Error on null / non-array.
2. If existing array empty, no-op.
3. Determine matching mode from `items_where`:
   - If `Array.isArray(payload.items_where)` → **scalar mode**: filter by direct value equality against the value list (using `===` or deep equality for consistency).
   - Else → **object mode**: filter using `WhereFilter.matchJavascriptObject(element, payload.items_where)`.
4. Remove every element that matches. ALL copies removed (not just first).
5. Return filtered array.

### `applyInc.ts`
1. Resolve `item[payload.path]`.
2. If `amount` is `NaN`, return WriteError.
3. If value is `undefined`, treat as 0.
4. If value is `null`, non-number, or `NaN`, return WriteError.
5. Return `currentValue + payload.amount`.

### Deep Equality Utility (`applyWritesToItems/helpers/mutations/deepEquals.ts`)
Used by `add_to_set` (for `unique_by: 'deep_equals'`):
- For scalars: `===` except `NaN === NaN` is true (use `Object.is` semantics or explicit check).
- For objects: recursive key-by-key. Treat `undefined` value ≡ missing key (JSON semantics). Key-order independent.
- For arrays: element-by-element, order-sensitive.
- `null` is a valid distinct value (not equal to `undefined`).

### DDL Path Resolution Helper (`applyWritesToItems/helpers/mutations/resolveDdlListRules.ts`)

When `add_to_set` with `unique_by: 'pk'` is used inside an `array_scope`, the DDL has been rewritten by `getArrayScopeSchemaAndDDL` to local coordinates. At root level, DDL keys are plain property names (e.g. `'sub_items'`). After scoping, the prefix-strip logic produces keys with a leading dot (e.g. `'.items'`).

```ts
/** Resolve DDL list rules for a given array property path.
 *  Handles both root-level paths ('sub_items') and scope-rewritten paths ('.items'). */
function resolveDdlListRules<T>(ddl: DDL<T>, path: string): ListRules<any> | undefined {
    return ddl.lists[path as keyof typeof ddl.lists]
        ?? ddl.lists[('.' + path) as keyof typeof ddl.lists];
}
```

Used by `applyAddToSet` for PK resolution.

## Step 7: Wire Into `applyWritesToItems.ts`

In the inner `switch(action.payload.type)` (after `case 'delete'`), add 4 new cases:

```ts
case 'add_to_set': {
    if (!mutableUpdatedItem) mutableUpdatedItem = getMutableItem(item, objectCloneMode);
    const result = applyAddToSet(mutableUpdatedItem, action.payload, ddl, rules);
    if ('error' in result) { failureTracker.report(action, item, result.error); }
    else { mutableUpdatedItem[action.payload.path] = result.value; failureTracker.testSchema(action, mutableUpdatedItem); }
    break;
}
// ... same pattern for push, pull, inc
```

For `inc`, the assignment is `mutableUpdatedItem[action.payload.path as keyof T] = result.value as T[keyof T]`.

No-op detection: if the handler returns a signal that nothing changed (same array ref or same number), skip setting `mutableUpdatedItem` to preserve referential stability.

**WriteStrategy bypass note:** New mutations bypass `WriteStrategy` (same as `delete` and `array_scope`). Add a JSDoc comment to the `WriteStrategy` interface explaining that it currently only handles `create`/`update` payloads, and that future work may need to extend it if custom strategies need to intercept `push`/`pull`/`add_to_set`/`inc`. Also add a comment at each new case in the switch noting the bypass.

## Step 8: Tests — New Test Schemas & DDLs (`standardTests.ts`)

Add a new schema for object-array mutations (pk-based addToSet/pull):

```ts
const FlatWithSubItemsSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    count: z.number().optional(),
    tags: z.array(z.string()).optional(),
    sub_items: z.array(z.object({
        sid: z.string(),
        val: z.number().optional(),
    }).strict()).optional(),
}).strict();

const flatWithSubItemsDdl: DDL<FlatWithSubItems> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', order_by: { key: 'id' } },
        'sub_items': { primary_key: 'sid', order_by: { key: 'sid' } },
    },
    permissions: { type: 'none' },
};
```

Existing `FlatSchema` already has `tags: string[]` and `count: number` — sufficient for scalar push/pull/addToSet(deep_equals) and inc.

## Step 9: Tests — Standard Test Sections (`standardTests.ts`)

Add 4 new describe blocks inside `1. Core Verbs`. Use TDD: write tests first, then implement (Phase 5).

### `describe('1.5 AddToSet')`

**Scalar deep_equals:**
- A1+A6: adds item to existing array
- A5: empty items → no-op
- A7: multiple new items all added
- A8: some items already present → only new added
- A9: all items present → no-op
- A10: internal duplicates deduped
- A11: scalar value equality
- A16: null elements in array are valid

**Object deep_equals:**
- A12: key-order independent equality
- A13: nested object equality

**PK-based:**
- A19: same PK skipped
- A20: new PK added
- A21: pk on scalar array → WriteError
- A25: same PK different data → not added

**Field validation:**
- A2: undefined field inits to []
- A3: null field → WriteError
- A27: where matches zero → no-op
- A28: where matches multiple → each gets the add

### `describe('1.6 Push')`

- P1+P8: push scalars to existing array
- P2: undefined field inits to []
- P3: null field → WriteError
- P5: empty items → no-op
- P6: duplicates appended (no uniqueness)
- P7: order preserved
- P9: push objects to array

### `describe('1.7 Pull')`

**Object array (WhereFilter mode):**
- R1+R7: `items_where` matches some elements → those removed
- R2: empty array → no-op
- R3: undefined field → no-op
- R4: null field → WriteError
- R6: `items_where: {}` matches all → array emptied
- R8: all matched → empty array
- R9: no match → no-op
- R10: multiple copies all removed
- R11: match by PK field (`items_where: { sid: '1' }`)
- R12: match by non-PK field (`items_where: { val: 5 }`)

**Scalar array (value list mode):**
- R13a: pull scalar values from `tags: string[]` using value list `['foo', 'bar']`
- R13b: pull value not present → no-op
- R13c: pull all values → empty array
- R13d: pull with duplicates in existing array — all copies removed

### `describe('1.8 Inc')`

- I1: increments number
- I2: undefined inits to 0 then adds
- I3: null → WriteError
- I7: amount 0 → no-op
- I8: positive increment
- I9: negative decrement
- I11: NaN amount → WriteError

### Cross-cutting (in existing sections or new `1.9`)

- X4–X5: array_scope wrapping push/inc on nested objects
- X8–X9: atomicity (push ok + inc error → rollback in atomic)
- X12–X15: referential stability on no-op
- X17–X18: immutability contract (original arrays/items not mutated)

## Step 10: Tests — Implementation-Specific (`applyWritesToItems.test.ts`)

In the `implementation-specific` section, add:
- Immer draft compatibility for new mutations (same pattern as existing Immer tests)
- Referential stability: push with empty items preserves array reference
- Atomic rollback: mixed mutation batch

## File Change Summary

| File | Change |
|---|---|
| `dot-prop-paths/types.ts` | +3 type helpers |
| `write-actions/types.ts` | +4 payload types, widen union |
| `write-actions/helpers.ts` | Extend guard function |
| `write-actions/write-action-schemas.ts` | +4 Zod schemas, widen union |
| `write-actions/index.ts` | +4 type exports |
| `applyWritesToItems/helpers/mutations/applyAddToSet.ts` | NEW — handler |
| `applyWritesToItems/helpers/mutations/applyPush.ts` | NEW — handler |
| `applyWritesToItems/helpers/mutations/applyPull.ts` | NEW — handler |
| `applyWritesToItems/helpers/mutations/applyInc.ts` | NEW — handler |
| `applyWritesToItems/helpers/mutations/deepEquals.ts` | NEW — shared utility |
| `applyWritesToItems/helpers/mutations/resolveDdlListRules.ts` | NEW — DDL path lookup helper (handles scoped paths) |
| `applyWritesToItems/helpers/mutations/index.ts` | NEW — barrel |
| `applyWritesToItems/applyWritesToItems.ts` | +4 switch cases, import handlers |
| `write-actions/standardTests.ts` | +test schema, +4 describe sections (~150 tests) |
| `applyWritesToItems/applyWritesToItems.test.ts` | +Immer/referential/atomic edge cases |

## TDD Execution Order

Phase 5 implements in red-green TDD:

1. **Types first** (Steps 1–5) — no tests needed, verified by `npm typecheck`
2. **Push** (simplest mutation) — write tests → implement handler → wire into switch → green
3. **Inc** (next simplest) — same cycle
4. **AddToSet** — deep_equals scalar tests → implement deepEquals + handler → pk tests → extend handler → green
5. **Pull** — items_where filter tests → implement using `WhereFilter.matchJavascriptObject` → green
6. **Cross-cutting** — array_scope composition, atomicity, referential stability, immutability



# Project Plan

_Instructions: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._


# [x] Phase 0

Look at the current code base to understand how it automatically detects the type of a property in a generic T, so it knows that propertyX is a number, propertyY is an array. 

Also, separately understand the DDL and how it defines primary key for a list (which is each nested array starting from root).

Document, succinctly, how to use this when writing new types and output to `Understanding Type Helpers`

# [x] Phase 1

Identify the current update type in @./types.ts, and explore options for how the new type will look for the actions. 
- Is it brand new payloads ('update', 'update-add-to-set', etc.)
- Is it just the 'update' payload but overloaded with a sub option? 

Explore pros & cons of each, output that into our chat, then ask me which to choose.

Remember that addToSet + pull + push must only be on array types; and inc only on number. 

Unlike Mongo, I propose addToSet and push can add multiple items in one go. Also for addToSet it should clarify whether to check just on an id (the primary key expressed in DDL for that list), or to do deep equals equality. 

Output the decision and types into `Proposed New Types`. 


# [x] Phase 2

I will later be making a variant of `applyWritesToItems` that works with SQL by generating an UPDATE statement on objects stored in a JSON column. In both pg and sqlite. 

For each db engine, tell me which new mutations can be natively expressed in an UPDATE statement on a JSON object. Alternatively can they do it with multiple SQL expressions in a transaction? 

For addToSet, be sure to consider uniqueness detect on a primary key id on the object vs deep equals. Can the engines support either? 

For each, flag if it's too difficult to replicate in SQL. 

Output findings to `What Works in SQL too?`


# [x] Phase 3

Analyse code internals for kofrasa/Mingo on github. It's not directly useable - the repo is an in-memory solution only (whereas we're planning to support many sources) - but they will certainly have learnt lessons we can use. 

Is there anything we can learn from their code base: have they documented any hard won lessons or edge cases, can you detect any good ideas in their code, can you spot sub-optimal things they've done? 

Summarise your discovery and output the lessons as declarative "Implementation Tips" in `Learning From Mingo`

# [x] Phase 4

Identify edge case behaviours for each new update action (and its various inputs, e.g. deep equality testing). These will need to be tracked through implementation. 

Add to `Edge Case Behaviours`. 

# [x] Phase 5

Generate an implementation plan that will update the types and schemas, update `applyWritesToItems`, and update the tests with full coverage as per our approach to testing. Output to `Implementation Plan`. 

# [x] Phase 5a

Pass plan to Gemini for feedback. Output me the current implementation plan, and additional context it needs (e.g. relevant types, spirit of library... anything the plan references that another LLM would need to know), and a request to conscisely critique that you can act on. 

# [x] Phase 5b

Gemini responded as seen in the `Implementation Plan Critique from Gemini` section. Analyse it and decide what is worth altering the plan to include. You can ask me about any and every point to clarify your decision (especially if you disagree).

Update the `Implementation Plan` with any agreed changes.

**Changes made:** See "Our Response" in the Gemini critique section. Key changes: bidirectional number guard, tuple guard, mapped-type-to-union for all array mutations, conditional `items_where` for scalar/object pull, DDL path resolution helper, WriteStrategy JSDoc comments. Rejected: WriteStrategy extension, GrowSet integration, file consolidation.

# [x] Phase 6

Implement the plan in `Implementation Plan`.

Where it makes sense aim for a red/green TDD process. Expand standardTests, using its current structural philosphy (but add to it), to handle these new tests.

**Implemented files:**
- `src/dot-prop-paths/types.ts` — Added `ArrayProperty<T>`, `ArrayElement<T,P>`, `NumberProperty<T>` type helpers
- `src/dot-prop-paths/index.ts` — Exported the 3 new type helpers
- `src/write-actions/types.ts` — Added `WritePayloadAddToSet`, `WritePayloadPush`, `WritePayloadPull`, `WritePayloadInc` types; widened `WritePayload` union
- `src/write-actions/helpers.ts` — Extended `isUpdateOrDeleteWritePayload` guard for new types
- `src/write-actions/write-action-schemas.ts` — Added 4 Zod schemas for runtime validation
- `src/write-actions/index.ts` — Exported 4 new payload types
- `src/write-actions/applyWritesToItems/helpers/mutations/deepEquals.ts` — Structural equality utility
- `src/write-actions/applyWritesToItems/helpers/mutations/resolveDdlListRules.ts` — DDL path resolution for scoped paths
- `src/write-actions/applyWritesToItems/helpers/mutations/applyAddToSet.ts` — addToSet handler (deep_equals + pk modes)
- `src/write-actions/applyWritesToItems/helpers/mutations/applyPush.ts` — push handler
- `src/write-actions/applyWritesToItems/helpers/mutations/applyPull.ts` — pull handler (WhereFilter + value list modes)
- `src/write-actions/applyWritesToItems/helpers/mutations/applyInc.ts` — inc handler
- `src/write-actions/applyWritesToItems/helpers/mutations/index.ts` — barrel export
- `src/write-actions/applyWritesToItems/applyWritesToItems.ts` — 4 new switch cases with lazy cloning for referential stability
- `src/write-actions/standardTests.ts` — `FlatWithSubItems` schema/DDL + 40 new standard tests in sections 1.5–1.9
- `src/write-actions/applyWritesToItems/applyWritesToItems.test.ts` — 4 implementation-specific tests (immutability, referential stability, Immer compat)

**Test results:** 1002 tests pass (131 in write-actions, up from 87), all 20 test files green.

# [x] Phase 7

How would we add UPSERT to the system? It would need a where-filter for collision detection? What are the consequences (changes, maintenance) of this add?

Suppose the underlying implementation simply didn't support UPSERT (e.g. it's a data library without upsert mechanics)... is it *always* possible to expand an UPSERT into other conditional WriteActions to compensate (e.g. run a CREATE but don't throw if exists, then run UPDATE). I.e. it's slower but can workaround as fallback?

## Analysis

### Near-Miss: `duplicate_create_recovery: 'always-update'`

The system almost has UPSERT already. When `always-update` is enabled, a CREATE hitting a duplicate PK silently converts to UPDATE. But it differs from true UPSERT:

| | `always-update` | True UPSERT |
|---|---|---|
| Collision detection | PK only | PK or where-filter |
| Granularity | Batch-level (all CREATEs) | Per-action |
| Create vs Update data | Same for both paths | Could differ |
| Intent | Accident recovery (defensive) | Deliberate semantics |

### Proposed Type

```ts
type WritePayloadUpsert<T extends Record<string, any>> = {
    type: 'upsert',
    data: T,                          // Full object for CREATE path
    update_data?: Partial<Pick<T, NonObjectArrayProperty<T>>>,  // If omitted, uses data (minus PK)
    where: WhereFilterDefinition<T>,  // Collision detection
    method?: UpdatingMethod,          // 'merge' | 'assign' for update path
}
```

`where` is the collision detector:
- **0 matches** → CREATE using `data`
- **1 match** → UPDATE using `update_data ?? data` (minus PK)
- **2+ matches** → Error (UPSERT implies singular intent; use UPDATE for multi-item)

### Consequences

**Changes required:**

| File | Change | Effort |
|---|---|---|
| `types.ts` | +1 payload type, widen union | Small |
| `write-action-schemas.ts` | +1 Zod schema | Small |
| `helpers.ts` | Extend guard | Trivial |
| `index.ts` | Export | Trivial |
| `applyWritesToItems.ts` | New switch case — check items, branch on match count | Medium |
| `standardTests.ts` | ~15-20 new tests | Medium |
| SQL adapters (future) | `INSERT...ON CONFLICT` (native in PG + SQLite) | Small |

**Maintenance cost**: Low-medium. Logic is conditional dispatch to existing CREATE + UPDATE handlers — no new execution mode. Main complexity:
1. 2+ match policy (recommend: error)
2. PK tracking interaction — UPSERT creating should add to `existingIds` like CREATE does
3. `WriteStrategy` reuse — calls `create_handler` or `update_handler` depending on path; no new handler
4. Atomic mode — straightforward, same rollback

### Can UPSERT Always Be Decomposed?

**Yes — always.** Within `applyWritesToItems`, the function has exclusive access to the item array. No race window exists, so "check → create or update" is always safe.

**Decomposition approaches:**

| Approach | Works? | Atomic? | Where-filter? | Race-safe? |
|---|---|---|---|---|
| `always-update` recovery | Yes | Yes (within batch) | PK only | Yes |
| CREATE + UPDATE sequence in batch | Yes | Yes (within batch) | PK only | Yes |
| Read-then-branch (2 calls) | Yes | No | Yes | No (TOCTOU) |
| Native UPSERT payload | Yes | Yes | Yes | Yes |

**Batch decomposition detail**: Send `[CREATE(data, recovery:'always-update'), UPDATE(where, data)]`. If item doesn't exist, CREATE succeeds and UPDATE no-ops (where matches nothing before create is committed — but actually within `applyWritesToItems` the CREATE adds to the items array first, so the UPDATE would also fire). This can be managed by making the UPDATE's where-filter narrow enough, or by relying on idempotent update data.

**SQL backends**: Both PostgreSQL (`INSERT...ON CONFLICT DO UPDATE`) and SQLite (`INSERT OR REPLACE` / `ON CONFLICT`) support native UPSERT. Decomposition into `SELECT + INSERT/UPDATE` within a transaction is always possible as fallback.

### Why UPSERT Is Not Just a Convenience

The closest existing mechanism (`duplicate_create_recovery: 'always-update'`) has three gaps that make true UPSERT inexpressible, not merely inconvenient:

1. **Batch-level, not per-action.** `duplicate_create_recovery` is a setting on the entire `applyWritesToItems` call. If a batch has 10 CREATEs and only 1 should be UPSERT, there's no way to distinguish them. All CREATEs get the same recovery mode.

2. **PK-only collision detection.** Collision is detected by primary key match only. "Upsert where `email = 'x@y.com'`" (when `email` isn't the PK) is a genuine semantic gap — not expressible at all.

3. **No separate create vs update data.** With `always-update`, the converted UPDATE uses the CREATE's `data` (minus PK). You can't say "if creating, set defaults A/B/C; if updating, only change field X."

The two-action decomposition (`CREATE` + `UPDATE` in sequence) doesn't work cleanly either:
- If item exists: CREATE fails/blocks unless recovery mode is set — which is batch-level (back to problem 1).
- If item doesn't exist: UPDATE silently no-ops, CREATE succeeds — but the exists case still requires the batch-level flag.

### Verdict

UPSERT fills real gaps in expressiveness. Worth adding because:
1. Per-action upsert intent (vs batch-level recovery mode that applies to all CREATEs)
2. Where-filter collision detection (vs PK-only)
3. Separate create/update data paths
4. SQL backends map it to native `ON CONFLICT` for atomicity + performance