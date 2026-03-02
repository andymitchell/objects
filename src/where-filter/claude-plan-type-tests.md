
# Goal

Exhaustively check the spec/intention of WhereFilterDefinition is correctly represented in the types by rewriting @types.test.ts to match the spec (similar to how it's structured in standardTests.ts with nested `describe` blocks representing the hierarchy of the spec).

# Relevant Files

@types.ts
@types.test.ts
@schemas.ts
@standardTests.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts as an example).

It's inspired by MongoDB. 

The current @types.test.ts is extremely patchy and weak. 

The current testing suite is good; but it's not exhaustive enough for 100% confidence that the tests match the structure. 

# The WhereFilterDefinition spec

_Copied from `claude-plan-standard-test-harden.md` and verified against current `types.ts`._

A `WhereFilterDefinition<T>` is a serialisable JSON query for filtering plain JS objects. Loosely inspired by MongoDB. It is a union of two forms:

## 1. Filter forms

### 1a. Partial Object Filter
Keys are **dot-prop paths** (e.g. `'contact.name'`), values are **value comparisons** or **array comparisons**.

**Implicit $and**: multiple keys on one object are ANDed.

### 1b. Logic Filter
Keys are logic operators, values are arrays of sub-`WhereFilterDefinition`s.

| Operator | Semantics |
|----------|-----------|
| `$and` | All sub-filters must match (`every`) |
| `$or` | At least one must match (`some`) |
| `$nor` | None may match (negated `some`) |

Multiple logic operators on one object are ANDed.

## 2. Scalar value comparisons (`ValueComparisonFlexi<T>`)

Applied when the resolved property is a scalar. The type conditionally includes operators based on `T`:

- **T extends string**: `ValueComparisonRangeString | ValueComparisonContains | ValueComparisonRegex | ValueComparisonNe<T> | ValueComparisonIn<T> | ValueComparisonNin<T> | ValueComparisonNot<T> | ValueComparisonExists | ValueComparisonType | T`
- **T extends number**: `ValueComparisonRangeNumeric | ValueComparisonNe<T> | ValueComparisonIn<T> | ValueComparisonNin<T> | ValueComparisonNot<T> | ValueComparisonExists | ValueComparisonType | T`
- **T extends boolean**: Only `ValueComparisonNe<never> | ValueComparisonIn<never> | ValueComparisonNin<never> | ValueComparisonNot<never> | ValueComparisonExists | ValueComparisonType | T` (range/contains/regex resolve to `never`)
- **T is object**: Only `ValueComparisonExists | ValueComparisonType | T` (all conditional operators resolve to `never`)

### Operators

| Operator | Type constraint | Semantics |
|----------|----------------|-----------|
| Exact scalar | `T` | Strict equality |
| Range (`$gt`,`$lt`,`$gte`,`$lte`) | string or number | Numeric or lexicographic comparison |
| `$contains` | string only | Substring match |
| `$ne` | string or number | Not equal |
| `$in` | string or number | Value in list |
| `$nin` | string or number | Value not in list |
| `$not` | wraps Range, $contains, $ne, $in, $nin, $regex | Negation |
| `$exists` | any T | `{ $exists: boolean }` |
| `$type` | any T | `{ $type: 'string' \| 'number' \| 'boolean' \| 'object' \| 'array' \| 'null' }` |
| `$regex` | string only | `{ $regex: string; $options?: string }` |

## 3. Array comparisons

Applied when the resolved property is an array (via `DotPropPathToArraySpreadingArrays`):

| Type | Semantics |
|------|-----------|
| `ArrayFilter<T[]>` | Union of `ArrayElementFilter<T[number]>` or `T` (exact array) |
| `ArrayElementFilter<T>` | If T is Record → `WhereFilterDefinition<T>`, if T is string\|number → `T`, plus `ArrayValueComparison<T>` |
| `ArrayValueComparisonElemMatch<T>` | If T is Record → `{$elemMatch: WhereFilterDefinition<T>}`, else → `{$elemMatch: ValueComparisonFlexi<T>}` |
| `ArrayValueComparisonAll<T>` | `{ $all: T[] }` |
| `ArrayValueComparisonSize` | `{ $size: number }` |

## 4. Dot-prop paths and array spreading

- `DotPropPathsIncArrayUnion<T>` generates all valid dot-prop paths
- `DotPropPathToArraySpreadingArrays<T>` identifies paths that resolve to arrays (these get `ArrayFilter` instead of `ValueComparisonFlexi`)
- `PathValueIncDiscrimatedUnions<T, P>` resolves the value type at a given path, handling discriminated unions

## 5. Type guards

- `isLogicFilter(filter)`: narrows `WhereFilterDefinition<T>` → `LogicFilter<T>`
- `isPartialObjectFilter(filter)`: narrows `WhereFilterDefinition<T>` → `PartialObjectFilter<T>`

# The Current types.test.ts important cases

## Spec coverage (8 tests — all KEEP)

| Lines | Test | Verifies |
|-------|------|----------|
| 7–15 | Basic key + correct value type | `{name:'2'}` accepted for `{name:'2'}` |
| 17–41 | `$gte` on number | Accepts number, rejects string, rejects number on string field |
| 43–56 | `$gte` on string | Accepts string, rejects number |
| 59–75 | `$contains` on string | Accepts string, rejects number |
| 78–87 | Wrong value type on property | `name: 1` errors when type is `'2'` |
| 90–98 | Dot-prop correct type | `"child.age": 1` accepted |
| 101–110 | Dot-prop wrong type | `"child.age": 'abc'` errors |
| 216–225 | Unknown key rejected | `"child2"` errors |
| 419–428 | Discriminated union optional property | `message` (one-variant-only) accepted as filter key |

## Regression (1 test — KEEP as-is, do not expand)

| Lines | Test | Guards against |
|-------|------|----------------|
| 227–417 | Complex discriminated unions with infinite recursion | `ErrorObject` with `Record<string, JsonValue>` (recursive type) doesn't cause TS infinite instantiation. Also exercises deep dot-props, `$and` in logic, and `Record<string, any>` permissiveness. |

## Consumer ergonomics (3 tests — all KEEP)

| Lines | Test | Verifies |
|-------|------|----------|
| 436–443 | Union not narrowed without guard | `a['name']` fails on raw `WhereFilterDefinition<T>` |
| 445–456 | Narrowing with type guards | `isPartialObjectFilter` → access `a['name']`; `isLogicFilter` → access `a['$or']` |
| 459–470 | Type guards on untyped WFD | `isPartialObjectFilter`/`isLogicFilter` work with `WhereFilterDefinition` (no generic) |

## Known limitations (5 tests — all KEEP as documentation)

| Lines | Test | Issue | Recommendation |
|-------|------|-------|---------------|
| 122–155 | Variable of same type | `keyof MessagingError` variable can't be used as filter value for `'error.type'` (uses `@ts-ignore`; inline literal works) | **Keep** — fundamental TS structural limitation with union-typed variables |
| 157–164 | Top-level array | `WhereFilterDefinition<Obj[]>` has no dot-props; no top-level `$elemMatch` | **Keep** — would require design change |
| 166–171 | Object-or-array union | `WhereFilterDefinition<{objects: Obj \| Obj[]}>` can't express both object-path and array-filter | **Keep** — TS can't represent this union branching |
| 173–195 | Nested objects as partial (not deepEql) | Nested object literal requires full deep equality, no partial matching | **Keep** — design decision documented; notes MongoDB allows partial |
| 197–212 | Permissive records lose type checking | `{[x:string]:any} & {message?:string}` loses narrowing on known keys | **Keep** — fundamental TS limitation with index signatures |

# Test philosophy

Tests should capture the **spirit and intent** of the spec, not be technically fussy. A good taste test: could a developer scan the `describe` blocks and a few tests within each, and quickly get an intuition that the types express the full intent of the spec? If yes, the tests are good.

Categories of type-level assertion to use:
- **Positive acceptance**: Valid filter shapes compile without error.
- **Negative rejection**: Invalid filter shapes produce `@ts-expect-error`.
- **Structural verification** (where it adds clarity): `expectTypeOf` from Vitest for compile-time type assertions.

Use whichever mechanism best captures the intent for each case. Don't over-index on any one approach.

# Constraint

* Do not fix/change/alter any actual types. I must provide my express approval for it.

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Analyse the current types.test.ts and build a mental model of what it's testing. Categorise the existing tests by purpose:
- **Spec coverage**: tests that verify a spec behavior at the type level
- **Regression**: tests that guard against specific TypeScript edge cases (e.g. infinite recursion with complex generics)
- **Consumer ergonomics**: tests about how devs consume the type (e.g. union narrowing with type guards)
- **Known limitations**: tests that document things that *don't* work (using `@ts-ignore` or empty bodies in "TODO - desirable features")

For each category, identify which tests are important to keep and document them under 'The Current types.test.ts important cases'. For "known limitations", recommend whether to keep as documentation, delete, or convert to tracked issues — then let me verify.

For existing TypeScript depth/recursion regression tests: keep them as-is; don't expand this area.

**Result**: Categorised all 17 tests across 4 categories:
- **Spec coverage** (8 tests): basic key/value acceptance, `$gte`/`$contains` type checking, dot-prop paths, unknown key rejection, discriminated union properties. All KEEP.
- **Regression** (1 test): complex discriminated unions with recursive `ErrorObject` type — guards against infinite TS instantiation. KEEP as-is.
- **Consumer ergonomics** (3 tests): union not narrowed without guard, narrowing via `isPartialObjectFilter`/`isLogicFilter`, type guards on untyped WFD. All KEEP.
- **Known limitations** (5 tests): variable-typed filter values, top-level arrays, object|array unions, nested partial objects, permissive records. All KEEP as documentation — all represent fundamental TS limitations or design decisions, not bugs.

Findings documented above under "The Current types.test.ts important cases" and "The WhereFilterDefinition spec".

# [x] Phase 2

Generate an implementation plan for how types.test.ts will be written from the ground up to verify that the types fully capture the intent of the spec.

## Type probe results — `ValueComparisonFlexi<T>` per type

Empirically verified via tsc. These are what the types _actually do_, which tests should verify:

| Operator | string | number | boolean | object |
|----------|--------|--------|---------|--------|
| Exact `T` | ✅ | ✅ | ✅ | ✅ |
| Range ($gt etc) | ✅ | ✅ | ❌ | ❌ |
| $contains | ✅ | ❌ | ❌ | ❌ |
| $regex | ✅ | ❌ | ❌ | ❌ |
| $ne | ✅ | ✅ | ❌ (never) | ❌ (never) |
| $in | ✅ | ✅ | ❌ (never[]) | ❌ (never[]) |
| $nin | ✅ | ✅ | ❌ (never[]) | ❌ (never[]) |
| $not | ✅ | ✅ | ✅ | ✅ |
| $exists | ✅ | ✅ | ✅ | ✅ |
| $type | ✅ | ✅ | ✅ | ✅ |

**Known type gap**: `ValueComparisonNot<T>` unconditionally includes `ValueComparisonContains` and `ValueComparisonRegex` in its inner union. So `{ $not: { $contains: 'x' } }` compiles for any T (boolean, number, object) even though it's semantically wrong for non-strings. Tests should document this gap.

## Implementation plan — `describe` block hierarchy

Shared test type used throughout:
```ts
type TestObj = {
  name: string;
  age: number;
  active: boolean;
  contact: { city: string; zip: number };
  tags: string[];
  scores: number[];
  addresses: { street: string; primary: boolean }[];
};
```

### `describe('WhereFilterDefinition types')`

#### `describe('1. Filter forms')`

##### `describe('1a. Partial Object Filter')`
- ✅ accepts top-level key with correct value type (`{ name: 'Andy' }`)
- ✅ accepts multiple keys (implicit $and) (`{ name: 'Andy', age: 30 }`)
- ❌ rejects unknown key (`{ unknown: 'x' }` → `@ts-expect-error`)
- ❌ rejects wrong value type (`{ name: 1 }` → `@ts-expect-error`)
- ✅ accepts discriminated union optional property _(from Phase 1: keep)_

##### `describe('1b. Logic Filter')`
- ✅ accepts `$and` with array of sub-filters
- ✅ accepts `$or` with array of sub-filters
- ✅ accepts `$nor` with array of sub-filters
- ✅ sub-filters are themselves `WhereFilterDefinition<T>` (can nest logic inside logic)
- ✅ accepts multiple logic operators on one object (`{ $and: [...], $nor: [...] }`)

#### `describe('2. Scalar value comparisons — ValueComparisonFlexi<T>')`

##### `describe('string properties')`
- ✅ exact string
- ❌ rejects wrong type (number for string field) → `@ts-expect-error`
- ✅ range operators ($gt, $lt, $gte, $lte) with string value
- ❌ rejects range with wrong type (number for string range) → `@ts-expect-error`
- ✅ $contains with string
- ❌ rejects $contains with wrong type (number) → `@ts-expect-error`
- ✅ $regex with string + $options
- ✅ $ne with string
- ❌ rejects $ne with wrong type → `@ts-expect-error`
- ✅ $in with string array
- ❌ rejects $in with wrong element type → `@ts-expect-error`
- ✅ $nin with string array
- ✅ $not wrapping range
- ✅ $not wrapping $contains
- ✅ $not wrapping $ne
- ✅ $not wrapping $in
- ✅ $not wrapping $regex
- ✅ $exists
- ✅ $type

##### `describe('number properties')`
- ✅ exact number
- ❌ rejects wrong type (string) → `@ts-expect-error`
- ✅ range operators with number
- ❌ rejects range with wrong type (string for number range) → `@ts-expect-error`
- ❌ rejects $contains → `@ts-expect-error`
- ❌ rejects $regex → `@ts-expect-error`
- ✅ $ne with number
- ✅ $in with number array
- ✅ $nin with number array
- ✅ $not wrapping range
- ✅ $exists
- ✅ $type
- ⚠️ documents: `$not` leaks `$contains`/`$regex` (compiles but semantically wrong)

##### `describe('boolean properties')`
- ✅ exact boolean (`true` / `false`)
- ❌ rejects wrong type → `@ts-expect-error`
- ❌ rejects range ($gt etc) → `@ts-expect-error`
- ❌ rejects $contains → `@ts-expect-error`
- ❌ rejects $regex → `@ts-expect-error`
- ❌ rejects $ne (resolves to `never`) → `@ts-expect-error`
- ❌ rejects $in (resolves to `never[]`) → `@ts-expect-error`
- ❌ rejects $nin → `@ts-expect-error`
- ✅ $exists
- ✅ $type
- ⚠️ documents: `$not` leaks `$contains`/`$regex`

##### `describe('object properties')`
- ✅ exact object (deep equality) with correct shape
- ❌ rejects wrong object shape → `@ts-expect-error`
- ❌ rejects range → `@ts-expect-error`
- ❌ rejects $contains → `@ts-expect-error`
- ❌ rejects $regex → `@ts-expect-error`
- ❌ rejects $ne (never) → `@ts-expect-error`
- ❌ rejects $in (never[]) → `@ts-expect-error`
- ✅ $exists
- ✅ $type
- ⚠️ documents: `$not` leaks `$contains`/`$regex`

#### `describe('3. Array comparisons')`

##### `describe('exact array match')`
- ✅ accepts array literal of correct element type (`tags: ['a', 'b']`)
- ❌ rejects array of wrong element type → `@ts-expect-error`

##### `describe('scalar element match')`
- ✅ accepts scalar matching element type (`tags: 'London'`)
- ❌ rejects scalar of wrong type → `@ts-expect-error`

##### `describe('compound object filter on array')`
- ✅ accepts `WhereFilterDefinition<ElementType>` for object arrays (`addresses: { street: 'Main' }`)
- ✅ accepts logic filter ($and/$or) on object array elements

##### `describe('$elemMatch')`
- ✅ object array: accepts `WhereFilterDefinition<T>` inside (`{ $elemMatch: { street: 'Main' } }`)
- ✅ object array: accepts multi-key implicit $and
- ✅ scalar array: accepts scalar value (`{ $elemMatch: 5 }`)
- ✅ scalar array: accepts `ValueComparisonFlexi` (`{ $elemMatch: { $gt: 5 } }`)
- ❌ scalar array: rejects wrong scalar type → `@ts-expect-error`

##### `describe('$all')`
- ✅ accepts array of correct element type (`{ $all: ['a', 'b'] }`)
- ❌ rejects wrong element type → `@ts-expect-error`

##### `describe('$size')`
- ✅ accepts number (`{ $size: 2 }`)
- ❌ rejects non-number → `@ts-expect-error`

#### `describe('4. Dot-prop paths and array spreading')`
- ✅ accepts nested dot-prop path (`'contact.city': 'London'`)
- ❌ rejects wrong type for nested dot-prop (`'contact.city': 1` → `@ts-expect-error`)
- ❌ rejects unknown nested path (`'contact.unknown': 'x'` → `@ts-expect-error`)
- ✅ array-spreading paths get `ArrayFilter` (can use `$elemMatch`, `$all`, etc.)
- `expectTypeOf` structural check: dot-prop for array path is `ArrayFilter`, not `ValueComparisonFlexi`

#### `describe('5. Type guards')`
- ✅ `isPartialObjectFilter` narrows → can access property keys, `@ts-expect-error` on `$and`
- ✅ `isLogicFilter` narrows → can access `$or`/`$and`/`$nor`, `@ts-expect-error` on property key
- ✅ union not narrowed without guard → property access fails _(from Phase 1)_
- ✅ type guards work on untyped `WhereFilterDefinition` (no generic) _(from Phase 1)_

#### `describe('Regression')`
- Keep the complex discriminated unions / infinite recursion test **as-is** _(from Phase 1)_

#### `describe('Known limitations (documentation)')`
- Keep all 5 tests **as-is** _(from Phase 1)_

## Notes for Phase 3

- Use assertion style per test philosophy: `@ts-expect-error` for rejections, simple assignment for acceptances, `expectTypeOf` only where structural verification adds clarity (e.g. confirming array path resolves to ArrayFilter).
- For the `$not` leak, use a comment like `// TYPE GAP: $not unconditionally allows $contains/$regex for all T` with the test showing it compiles (no `@ts-expect-error`).
- Total estimated tests: ~75-85 (including ~17 kept from Phase 1).

**Result**: Plan generated. Hierarchy mirrors spec sections 1–5 plus regression/limitations. Exhaustive per-type operator matrix for `ValueComparisonFlexi<T>` (string, number, boolean, object). Array filtering covers all `ArrayFilter`/`ArrayValueComparison` branches. Type guard narrowing tested in both directions. `$not` type gap documented.

# [ ] Phase 3

Implement the plan above to write a new types.test.ts. Structure:

1. Create shared `TestObj` type at top of file
2. Build describe blocks matching the hierarchy above
3. Migrate all Phase 1 "keep" tests into appropriate sections (regression + known limitations as-is; spec/ergonomics tests reorganised into new hierarchy)
4. Add all new tests from the plan
5. Run `npx vitest run src/where-filter/types.test.ts` — collect any `@ts-expect-error` that TS doesn't actually error on (these indicate type gaps to document in Phase 4)

# [ ] Phase 4

Run the type tests and identify any type errors. DO NOT FIX THEM yet — this is info gathering. For each failure, document:
- What the test expected
- What TypeScript actually does
- Your assessment of whether the type or the spec is likely wrong

Present this to me for manual investigation. Fixes come later after plan approval.