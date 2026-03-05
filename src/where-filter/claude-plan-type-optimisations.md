
# Goal

The `WhereFilterDefinition`, and especially everything it's built from in @../dot-prop-paths/types.ts, should be optimised to run fast on generics. 

Everything in types.test.ts and the standard tests will still pass, and every file in this repo will be checked for types to make sure no problems have been introduced. 

# Relevant Files

@types.ts
@types.test.ts
@standardTests.ts
@../dot-prop-paths/types.ts

# Context 

Currently a complex schema (deeply nested, possibly recursive) as the generic in a `WhereFilterDefinition` can really slow an IDE down to a crawl. 

# Constraint

* Do not alter any tests 


# The WhereFilterDefinition spec

## Type Construction Map

`WhereFilterDefinition<T>` is a union of two branches:

```
WhereFilterDefinition<T>
├── PartialObjectFilter<T>          (types.ts:61)
│   = Partial<{ [P in DotPropPathsIncArrayUnion<T>]: ... }>
│   Keys come from:
│   ├── DotPropPathsUnion<T>                    (dot-prop-paths/types.ts:45)
│   │   = mapped type over Path<T>
│   │   └── Path<T, Depth=6>                    (dot-prop-paths/types.ts:34)
│   │       Recursive: for each key K of T, produces "K" | "K.Path<T[K], Depth-1>"
│   │       Uses Prev tuple for depth decrement. Skips arrays. Depth-guarded at 6.
│   │
│   └── DotPropPathToObjectArraySpreadingArrays<T>  (dot-prop-paths/types.ts:160)
│       Recursive: walks T finding array-of-object properties. Depth-guarded at 8.
│       Produces paths that cross through arrays (e.g. "children.grandchildren").
│
│   Values depend on path type:
│   ├── If path ∈ DotPropPathToArraySpreadingArrays<T>:  (dot-prop-paths/types.ts:148)
│   │   → ArrayFilter<PathValueIncDiscrimatedUnions<T, P>>
│   │     ├── ArrayElementFilter<Element>
│   │     │   ├── WhereFilterDefinition<Element>  ← RECURSIVE if element is Record
│   │     │   ├── Element (scalar match)
│   │     │   └── ArrayValueComparison<Element>
│   │     │       ├── $elemMatch → WhereFilterDefinition<Element> or ValueComparisonFlexi
│   │     │       ├── $all → Element[]
│   │     │       └── $size → number
│   │     └── T (exact array match)
│   │
│   └── Otherwise:
│       → ValueComparisonFlexi<PathValueIncDiscrimatedUnions<T, P>>
│         ├── ValueComparisonString | ValueComparisonRegex  (if string)
│         ├── ValueComparisonRangeNumeric                   (if number)
│         ├── ValueComparisonNe<T>        { $ne: ... }
│         ├── ValueComparisonIn<T>        { $in: [...] }
│         ├── ValueComparisonNin<T>       { $nin: [...] }
│         ├── ValueComparisonNot<T>       { $not: ... }  ← wraps range/contains/ne/in/nin/regex
│         ├── ValueComparisonExists       { $exists: boolean }
│         ├── ValueComparisonType         { $type: ... }
│         └── T (exact match)
│
│   PathValueIncDiscrimatedUnions<T, P>      (dot-prop-paths/types.ts:131)
│   Resolves value at dot-path P in T. Distributes over unions (T extends unknown)
│   for discriminated union support. Walks through arrays with EnsureRecord.
│
└── LogicFilter<T>                  (types.ts:75)
    = { $and?: WhereFilterDefinition<T>[]; $or?: ...; $nor?: ... }
    ← RECURSIVE: each sub-filter is WhereFilterDefinition<T>
```

## Key Dependencies in dot-prop-paths/types.ts

| Type | Line | Purpose | Recursive? | Depth Guard |
|------|------|---------|------------|-------------|
| `Path<T>` | 34 | All dot-prop paths (skips arrays) | Yes | 6 |
| `DotPropPathsUnion<T>` | 45 | Path<T> with trailing-dot removal | No (wraps Path) | via Path |
| `DotPropPathsIncArrayUnion<T>` | 46 | Union of DotPropPathsUnion + DotPropPathToObjectArraySpreadingArrays | No (combines two) | via children |
| `DotPropPathToArraySpreadingArrays<T>` | 148 | Paths that terminate at arrays | Yes | 8 |
| `DotPropPathToObjectArraySpreadingArrays<T>` | 160 | Paths that terminate at object-arrays | Yes | 8 |
| `PathValue<T, P>` | 120 | Resolve value type at path P | Yes | No guard |
| `PathValueIncDiscrimatedUnions<T, P>` | 131 | PathValue distributing over unions | Yes | No guard |
| `RemoveTrailingDot<T>` | 44 | Filters out paths ending in "." | No | N/A |
| `Prev` | 146 | Depth-decrement tuple [never,0,1,...] | No | N/A |

## Recursion Points (potential cost amplifiers)

1. **Path<T, Depth>** — Enumerates every key at every depth level up to 6. For a type with N keys and max depth D, this is O(N^D) in the worst case.
2. **DotPropPathToArraySpreadingArrays / DotPropPathToObjectArraySpreadingArrays** — Similar recursive walk, depth 8.
3. **PartialObjectFilter mapped type** — For each path P in the union, evaluates `IsAssignableTo` + `PathValueIncDiscrimatedUnions` + the full value comparison type. Cost scales with number of paths.
4. **ArrayElementFilter → WhereFilterDefinition** — If an array element is a Record, the entire WhereFilterDefinition is instantiated recursively for that element type.
5. **LogicFilter → WhereFilterDefinition[]** — Recursive, but not deeply nested in practice (same T).
6. **ValueComparisonNot wraps multiple comparison types** — Adds union branches for each path.

## Summary

The type is a **mapped type over a recursively-generated union of dot-prop paths**, where each path's value type is itself computed recursively and then wrapped in a comparison type that can contain further recursive WhereFilterDefinition instantiations (for array elements and logic operators). The combinatorial explosion comes from: (a) path enumeration being exponential in depth, (b) each path requiring full value-type resolution, and (c) array element paths re-instantiating the entire WhereFilterDefinition.

# Why the WhereFilterDefinition is slow - possible reasons

_These are hypotheses, not conclusive findings. They need measurement (Phase 3/4) to confirm._

## 1. Exponential Path Enumeration

`Path<T, Depth=6>` is the root cause of combinatorial explosion. For each key K at depth D, it produces both `K` and `K.Path<T[K], D-1>`. With N keys per level:
- Depth 1: N paths
- Depth 2: N + N² paths
- Depth 6: O(N⁶) paths in the worst case

For a type with 10 keys at each level, that's millions of string literal union members. Even with fewer keys, recursive/generic types force TS to speculatively expand more branches.

**Particularly bad for:** Wide types (many keys per level), deep types (6+ levels of nesting).

## 2. Duplicate Path Computation

`DotPropPathsIncArrayUnion<T>` combines two independently-computed recursive path types:
- `DotPropPathsUnion<T>` (via `Path<T>`)
- `DotPropPathToObjectArraySpreadingArrays<T>` (separate recursion, depth 8)

These walk the same type structure independently. TS may not cache the intermediate results between them, effectively doubling the work.

## 3. Per-Path Value Resolution in PartialObjectFilter

For every path P in the union, `PartialObjectFilter` evaluates:
1. `IsAssignableTo<P, DotPropPathToArraySpreadingArrays<T>>` — a third recursive instantiation to check if P is an array path
2. `PathValueIncDiscrimatedUnions<T, P>` — walks the type again to resolve the value at P
3. The full `ValueComparisonFlexi<...>` or `ArrayFilter<...>` type

This means for M paths, we get M × (conditional check + path walk + comparison type construction). Each of these involves conditional type distribution.

## 4. Recursive WhereFilterDefinition in Array Elements

When a path resolves to an array of objects, `ArrayElementFilter` instantiates `WhereFilterDefinition<Element>` recursively. This triggers the entire path enumeration + value resolution cycle for the element type. For nested array-of-object structures, this compounds exponentially.

**Particularly bad for:** Types with arrays of objects that themselves contain arrays of objects (e.g. `children: { grandchildren: { ... }[] }[]`).

## 5. Discriminated Union Distribution

`PathValueIncDiscrimatedUnions` uses `T extends unknown ? ... : never` to distribute over union members. For a discriminated union with K variants, each path resolution is duplicated K times. Combined with the exponential path enumeration, this is multiplicative.

**Particularly bad for:** Types like `LogEntry<MessagingError>` where the context type is a 6-variant discriminated union (the regression test case).

## 6. `any` / `Record<string, any>` in Generics Prevents Short-Circuiting

When T contains `any` (e.g. `ErrorObject = { [x: string]: JsonValue }` or `Message<TProtocolMap = any>`), TypeScript cannot prune branches in conditional types. Both sides of `T extends string ? A : B` may need evaluation. The `any` poison spreads through `Path`, `PathValue`, and all comparison types.

**Particularly bad for:** The regression test's `Message<TProtocolMap = any>`, `ErrorObject` with index signatures, and any schema using `Record<string, any>` as a property type.

## 7. LogicFilter Re-instantiation

`LogicFilter<T>` contains `WhereFilterDefinition<T>[]` for each of `$and`, `$or`, `$nor`. While the same T is used (no deeper nesting), TS must still resolve the full `WhereFilterDefinition<T>` type to type-check the array contents. This means the entire type is effectively instantiated twice in the union (once for PartialObjectFilter, once confirmed as the type of LogicFilter's array elements).

## 8. RemoveTrailingDot Mapped Type Wrapper

`DotPropPathsUnion` is defined as `{ [K in Path<T>]: RemoveTrailingDot<K> }[Path<T>]` — a mapped type over the full path union, immediately indexed. This creates an intermediate mapped type object with potentially thousands of keys, only to immediately discard it. A simpler conditional distribution might be cheaper.

## 9. No Caching of Type Aliases at Intermediate Levels

TypeScript caches type alias instantiations, but only at exact structural matches. The deeply nested template literal types produced by `Path` are likely unique enough that TS gets few cache hits. Each new combination of generic parameters forces fresh evaluation.

## Summary of Schema Archetypes Most Likely to Be Slow

| Schema Pattern | Why Slow | Severity |
|---|---|---|
| Deep nesting (5+ levels) | Path exponential blowup | High |
| Wide types (10+ keys per level) | Path combinatorics | High |
| Recursive types / index signatures | Prevents depth termination, poisons conditionals | Critical |
| Discriminated unions (many variants) | Multiplicative distribution | High |
| Arrays of objects (nested) | Recursive WhereFilterDefinition instantiation | High |
| `WhereFilterDefinition` as a property type inside T | Infinite recursion potential | Critical |
| Unresolved generics (`T = any`) | Prevents branch pruning | Medium-High |

# How to measure type performance

## Tools

### 1. `tsc --extendedDiagnostics` (quick overview)
```bash
npx tsc --extendedDiagnostics --noEmit
```
Key metrics: `Instantiations`, `Check time`, `Types`, `Memory used`.
Good for before/after comparisons of total project impact.

**Current baseline:** 1,496,436 instantiations, 4.37s check time, 323K types.

### 2. `tsc --generateTrace` + `@typescript/analyze-trace` (detailed)
```bash
rm -rf /tmp/ts-trace && npx tsc --generateTrace /tmp/ts-trace --noEmit --incremental false
npx @typescript/analyze-trace /tmp/ts-trace
```
Produces `trace.json` (Chrome/Perfetto trace) and `types.json` (type ID to display).
- `analyze-trace` shows hot spots automatically
- `trace.json` can be loaded in chrome://tracing or Perfetto for visual inspection
- Custom Python scripts can extract per-file times and hot type IDs (see below)

### 3. Per-file time extraction (Python script)
```python
import json
from collections import defaultdict
with open('/tmp/ts-trace/trace.json') as f:
    data = json.load(f)
file_times = defaultdict(float)
for e in data:
    if e.get('ph') == 'X' and 'dur' in e:
        path = e.get('args', {}).get('path', '')
        if path:
            file_times[path] += e['dur'] / 1000
for path, ms in sorted(file_times.items(), key=lambda x: x[1], reverse=True)[:20]:
    print(f'{ms:>8.1f}ms  {path}')
```

### 4. Type ID lookup
```python
with open('/tmp/ts-trace/types.json') as f:
    types = json.load(f)
type_map = {t['id']: t for t in types}
print(type_map[86]['display'])
```

### 5. Isolated micro-benchmarks
Create a minimal .ts file that only instantiates the type under test, then run tsc on just that file. Compare instantiation counts.

## Workflow

1. **Quick check:** `tsc --extendedDiagnostics` before and after changes -> compare instantiations and check time
2. **Find bottleneck files:** Generate trace -> per-file extraction -> identify which files contribute most
3. **Drill into hot types:** Look up `structuredTypeRelatedTo` source/target IDs in `types.json`
4. **Iterate:** Make change -> re-run diagnostics -> compare

## Sources
- [Performance Tracing - TypeScript Wiki](https://github.com/microsoft/TypeScript/wiki/Performance-Tracing)
- [@typescript/analyze-trace](https://github.com/microsoft/typescript-analyze-trace)
- [Benchmarking TypeScript Type Checking Performance (Spiko)](https://tech.spiko.io/posts/benchmarking-typescript-type-checking/)
- [Fixing TypeScript Performance (Viget)](https://www.viget.com/articles/fixing-typescript-performance-problems)
- [Optimizing TypeScript type checking (Gel Blog)](https://www.geldata.com/blog/an-approach-to-optimizing-typescript-type-checking-performance)

# Baseline Performance and Problem Areas

## Measurement Setup

Used `tsconfig-perf.json` (extends main tsconfig, includes only `_perf_test.ts`) to isolate per-scenario costs.

Empty baseline (no WFD import): 82K instantiations, 0.63s check.

## Per-Scenario Results

| Scenario | Instantiations | Check Time | Delta from empty |
|---|---|---|---|
| 0. Empty (no WFD use) | 82,266 | 0.63s | — |
| 1. Baseline (1 key) | 719,108 | 2.15s | +637K / +1.52s |
| 2. Flat (4 keys) | 719,734 | 2.18s | +626 over #1 |
| 3. Shallow (2 levels) | 719,876 | 2.15s | +768 over #1 |
| 4. Deep (5 levels) | 720,552 | 2.14s | +1,444 over #1 |
| 5. Wide (10+10 keys, 2 levels) | 722,985 | 2.15s | +3,877 over #1 |
| 6. Array of objects | 719,872 | 2.14s | +764 over #1 |
| 7. Nested arrays | 720,453 | 2.16s | +1,345 over #1 |
| 8. Discriminated union (6) | 721,977 | 2.16s | +2,869 over #1 |
| 9. Record<string,any> prop | 721,649 | 2.19s | +2,541 over #1 |
| 10. Unresolved generic | 719,210 | 2.13s | +102 over #1 |
| 11. Complex (regression) | 725,980 | 2.16s | +6,872 over #1 |
| 12. 10 assignments (flat) | 719,819 | 2.63s | +711/+0.48s over #1 |
| 13. 5 different types | 722,789 | 2.25s | +3,681 over #1 |
| 14. Complex + 5 assigns | 725,993 | 2.25s | +6,885 over #1 |
| 15. Wide+deep (5x4 levels) | 723,255 | 2.24s | +4,147 over #1 |

## Key Findings

### 1. Import cost dominates — WFD's transitive imports are the real problem
- Just importing `WhereFilterDefinition` costs **637K instantiations and 1.5s** — almost all from `schemas.ts` (197ms trace time) and its transitive Zod dependencies.
- Per-schema instantiation cost is **tiny** (626–6,872 extra instantiations). Even the complex regression test adds only ~7K.
- Import of `dot-prop-paths/types.ts` alone: 191K instantiations.

### 2. The type itself is not the bottleneck for individual usage
- Check times are nearly identical across all archetypes (~2.15s).
- Multiple assignments (10 assignments) add 0.48s — the assignability checks are the per-use cost.
- Per `--generateTrace`, the `_perf_test.ts` file with 3 complex assignments only takes **13.8ms**.

### 3. Real project cost is accumulation
- Full project: 1,496,436 instantiations, 4.37s check.
- `schemas.ts` alone: 200ms in trace (biggest where-filter contributor).
- `types.test.ts`: 253ms, `standardTests.ts`: 236ms, `sqliteWhereClauseBuilder.test.ts`: 290ms.
- The cost accumulates from many files importing and using WFD.

### 4. Where the IDE sluggishness actually comes from
The **IDE experience** differs from batch compilation. The IDE re-checks the current file on each keystroke. For a file that uses `WhereFilterDefinition<ComplexType>`:
- TS must resolve the full mapped type to provide completions
- Each keystroke inside `{ ... }` triggers re-evaluation of all valid keys
- The **path enumeration** (`DotPropPathsIncArrayUnion`) is the bottleneck here, as the IDE must compute the full key union for autocomplete

This means the batch benchmark understates the problem. The real issue is **incremental/IDE performance** where the type is resolved repeatedly.

## Phase 4b: JsonValue, Recursive Types, and Additional Scenarios

### Per-Scenario Results (Phase 4b)

| # | Scenario | Instantiations | Check Time | Delta from baseline (#0c) |
|---|---|---|---|---|
| 0 | Empty (no WFD) | 82,266 | 0.64s | — |
| 0b | Import only | 718,989 | 2.20s | — |
| 0c | Baseline (1 key) | 719,233 | 2.17s | — |
| 16 | JsonValue schema (6 keys, nested, JsonObject/JsonValue props) | 720,857 | 2.13s | +1,624 |
| 17 | Direct JsonObject as top-level | 719,696 | 2.17s | +463 |
| 18 | Record<string,any> prop | 721,649 | 2.15s | +2,416 |
| 19 | Deep (5 levels) + JsonValue at leaf | 720,833 | 2.12s | +1,600 |
| 20 | Wide (11 keys) + JsonValue/JsonObject props | 720,469 | 2.12s | +1,236 |
| 21 | TreeNode (self-referential: children: TreeNode[]) | 722,265 | 2.16s | +3,032 |
| 22 | Mutual recursion (NodeA -> NodeB[] -> NodeA) | 721,814 | 2.14s | +2,581 |
| 23 | LogEntry<MessagingError> (6 DU variants, Msg generic, index sig) | 745,838 | 2.19s | +26,605 |
| 24 | LogEntry<ErrorObject> (JsonValue in index sig context) | 734,797 | 2.16s | +15,564 |

### Trace Times (per-file, for test file only)

| Scenario | File trace time | Instantiations |
|---|---|---|
| Realistic JsonValue schema (wide+deep, 5 WFD assignments) | 15.2ms | 725,904 |
| LogEntry<MessagingError> (5 WFD assignments) | 56.0ms | 811,719 |
| Extreme combined (wide+deep+JsonValue+DU+arrays, 10 assignments) | 39.2ms | 797,366 |

### Key Findings

#### 5. JsonValue/JsonObject does NOT cause batch compilation blowup
Contrary to the hypothesis, schemas containing `JsonValue` or `JsonObject` (open recursive JSON types) add very few instantiations (1,000-2,000 over baseline). The `Path<T>` type's depth guard at 6 prevents infinite recursion through `JsonObject`'s index signature. **Batch check time is essentially unchanged.**

#### 6. JsonValue DOES cause correctness issues
Schemas containing `JsonValue`/`JsonObject` properties cause `PathValueIncDiscrimatedUnions` to resolve to `never` for many paths. This means:
- Type errors on valid filter assignments (e.g. `{ id: '1' }` fails on a schema with a `JsonObject` property)
- The type is **functionally broken** for schemas with JsonValue/index-sig properties — not slow, but wrong
- This is because `Path<T>` generates paths through the index signature, and the value resolution through `{[K in string]: JsonValue}` produces unexpected types

#### 7. Self-referential and mutually recursive types are well-contained
`TreeNode` (self-ref via `children: TreeNode[]`) and mutual recursion (`NodeA -> NodeB[] -> NodeA`) add only 2,500-3,000 instantiations. The depth guards in `Path<T>` (6) and `DotPropPathToArraySpreadingArrays` (8) effectively prevent blowup.

#### 8. The LogEntry<MessagingError> regression type is the costliest
At +26,605 instantiations and 56ms trace time, this is the most expensive single-schema scenario. The cost comes from the combination of:
- 6-variant discriminated union (multiplicative distribution in `PathValueIncDiscrimatedUnions`)
- Unresolved generic (`Msg<any, any>`) preventing branch pruning
- Index signatures on `ErrorObject` (serializedError property)
- Deep nesting (LogEntry -> context:MessagingError -> message:Msg -> data)

#### 9. The IDE sluggishness from JsonValue is NOT about instantiation cost
Since batch compilation shows minimal impact from JsonValue, the reported IDE hangs with JsonValue-containing schemas are likely caused by:
- **Autocomplete key enumeration**: For `JsonObject` (index sig `{[K in string]: JsonValue}`), `Path<T>` generates paths where K is `string`, creating template literal types like `` `${string}` | `${string}.${string}` `` etc. The IDE must enumerate/display these, which can cause the suggestion UI to hang.
- **Hover/quickinfo resolution**: When hovering over a WFD variable, the IDE tries to fully expand the type, which for JsonObject produces an infinitely-wide mapped type.
- These are IDE presentation issues, not type-checking computation issues.

### Additional Problem Areas Identified

| Schema Pattern | Batch Impact | IDE Impact | Notes |
|---|---|---|---|
| JsonValue/JsonObject properties | Low (1-2K inst) | **High** (autocomplete/hover hang) | Paths through index sig create `string`-based template literals |
| Self-referential types | Low (3K inst) | Low-Medium | Depth guards work well |
| Mutual recursion | Low (2.5K inst) | Low-Medium | Depth guards work well |
| LogEntry<MessagingError> (DU + generic + index sig) | Medium (27K inst) | High | Combines all cost amplifiers |
| LogEntry<ErrorObject> (JsonValue in DU context) | Medium (16K inst) | High | JsonValue + DU multiplication |

## Target Performance

A "fast enough" type should allow the IDE to respond within **100ms** for autocomplete on any reasonable schema. Currently, the schemas in `types.test.ts` are fine, but real-world schemas like the regression test's `LogEntry<MessagingError>` can cause noticeable lag.

# Implementation Plan

Three directives, ordered by impact. Each is independent and can be verified separately.

---

## Directive 1: Move `ObjOrDraft` out of `matchJavascriptObject.ts` (~526K inst saved)

**Problem:** `types.ts` imports `ObjOrDraft` from `matchJavascriptObject.ts`. Even as `import type`, TS loads the full file, pulling in `schemas.ts` → zod and `getPropertySimpleDot.ts` → `dot-prop` → `type-fest` (478K inst from type-fest alone).

**Fix:**
1. Move `ObjOrDraft` definition from `matchJavascriptObject.ts:34` into `types.ts` (with `import type { Draft } from "immer"` — immer adds only ~337 inst)
2. Remove `import type { ObjOrDraft } from "./matchJavascriptObject.js"` from `types.ts`
3. Update `matchJavascriptObject.ts` to import `ObjOrDraft` from `./types.ts` instead of defining it locally
4. Update `matchJavascriptObject.test.ts` to import `ObjOrDraft` from `./types.ts` (currently imports from `matchJavascriptObject.js`)

**Files changed:** `types.ts`, `matchJavascriptObject.ts`, `matchJavascriptObject.test.ts`

**Risk:** Low. Pure type alias move. No runtime change.

---

## Directive 2: Inline `PrimaryKeyValue` in `dot-prop-paths/types.ts` (~93K inst saved)

**Problem:** `dot-prop-paths/types.ts` imports `PrimaryKeyValue` from `../utils/getKeyValue.ts`. That file imports `zod` (runtime), so TS loads zod to resolve the type.

**Fix:**
1. In `dot-prop-paths/types.ts`, replace `import type { PrimaryKeyValue } from "../utils/getKeyValue.js"` with `type PrimaryKeyValue = string | number` (inline, since it's trivial and only used in one place: `PrimaryKeyProperties<T>` at line 56)
2. Leave `getKeyValue.ts` unchanged (it still defines and exports `PrimaryKeyValue` for its own consumers)

**Alternative:** Create `utils/getKeyValue.types.ts` with just the type aliases. But since `PrimaryKeyValue` is trivially `string | number` and only used once in `dot-prop-paths/types.ts`, inlining is simpler and avoids a new file.

**Files changed:** `dot-prop-paths/types.ts`

**Risk:** Very low. Type is `string | number` — no drift risk. If `PrimaryKeyValue` ever changes in `getKeyValue.ts`, a type test in `getKeyValue.ts` (the existing `isTypeEqual` check) would catch the mismatch at compile time.

---

## Directive 3: Skip index-signature keys in `Path<T>` (correctness + IDE fix)

**Problem:** When T has properties typed as `JsonObject` (`{[K in string]: JsonValue}`) or `Record<string, any>`, `Path<T>` generates paths where K is `string` (the full type, not a literal). This produces template literal types like `` `${string}` | `${string}.${string}` ``, causing:
- **Correctness bug**: `PathValueIncDiscrimatedUnions` resolves to `never` for many paths, breaking valid filter assignments
- **IDE hang**: Autocomplete tries to enumerate/display infinite key unions

**Fix:** In `dot-prop-paths/types.ts`, add a utility type and use it to filter out index-signature keys in all three mapped types:

### 3a. Add `ExtractLiteralKeys<K>` utility type
```ts
/** Filters out index-signature keys (string, number, symbol), keeping only literal keys. */
type ExtractLiteralKeys<K> = string extends K ? never : number extends K ? never : symbol extends K ? never : K;
```

### 3b. `Path<T>` (line 34)
```ts
// Before:
[K in keyof T]-?: K extends string | number ? ...

// After:
[K in keyof T as ExtractLiteralKeys<K>]-?: K extends string | number ? ...
```

### 3c. `DotPropPathToArraySpreadingArrays<T>` (line 148)
```ts
// Before:
[K in keyof T]?: K extends string ? ...

// After:
[K in keyof T as ExtractLiteralKeys<K>]?: K extends string ? ...
```

### 3d. `DotPropPathToObjectArraySpreadingArrays<T>` (line 160)
```ts
// Before:
[K in keyof T]-?: K extends string ? ...

// After:
[K in keyof T as ExtractLiteralKeys<K>]-?: K extends string ? ...
```

**Files changed:** `dot-prop-paths/types.ts`

**Risk:** Medium. This intentionally changes behavior for schemas with index signatures. Need to check:
- `types.test.ts` for any `@ts-expect-error` tests on index-sig schemas (lines ~799-801, ~836-837) that may need updating
- Any test that relies on `Record<string, any>` properties generating paths through the index signature

**Note:** This does NOT affect `number extends K` filtering for tuple types — tuples have numeric literal keys (0, 1, 2), not `number` itself.

---

## Expected Outcome

| Metric | Before | After (D1+D2) | After (D1+D2+D3) |
|---|---|---|---|
| Instantiations (import only) | 719K | ~90K | ~90K |
| Check time (import only) | 2.13s | ~0.60s | ~0.60s |
| JsonValue schema correctness | Broken (resolves to `never`) | Broken | Fixed |
| IDE autocomplete on JsonValue schema | Hangs | Hangs | Responsive |

## Verification (after each directive)

1. `npx tsc --noEmit` — full repo type-checks, no new errors
2. `npm test` — all runtime tests pass
3. `npx tsc -p src/where-filter/tsconfig-perf-4b.json --extendedDiagnostics --noUnusedLocals false` — confirm instantiation reduction


# Implementation Plan Critique from Gemini




### 1. Risks & Gaps
*   **Directive 1 (Circular Dependency Risk):** Moving `ObjOrDraft` into `types.ts` and having `matchJavascriptObject.ts` import from it may introduce a circular dependency (e.g., if `matchJavascriptObject.ts` evaluates `WhereFilterDefinition` exported by `types.ts`). While TypeScript permits type-only circular imports, some strict bundlers or lint rules (like `eslint-plugin-import/no-cycle`) may flag it. 
*   **Directive 3 (Symbol Keys):** The proposed index-signature filter (`string extends K ? never : number extends K ? never : K`) misses `symbol` index signatures. While standard dot-paths ignore symbols, standardising the exclusion prevents edge-case crashes.

### 2. Better Alternatives
*   **Directive 2 (DRY Violation):** Inlining `PrimaryKeyValue` creates a duplicated source of truth. Relying on an `isTypeEqual` check elsewhere is brittle if files are refactored.
    *   *Alternative:* Extract `PrimaryKeyValue = string | number` into a new, zero-dependency file (e.g., `utils/primaryKeyType.ts`). Update both `dot-prop-paths/types.ts` and `utils/getKeyValue.ts` to import from this new file.
*   **Directive 3 (Duplicated Mapped Types):** You are pasting the same complex conditional ternary into three different mapped types, which hurts readability.
    *   *Alternative:* Extract the logic into a reusable utility type:
      ```typescript
      type ExtractLiteralKeys<K> = string extends K ? never : number extends K ? never : symbol extends K ? never : K;
      ```
      Then apply it cleanly across all three locations: `[K in keyof T as ExtractLiteralKeys<K>]`.

### 3. Ordering / Dependencies
*   **Optimal Sequence:** The proposed order (D1 → D2 → D3) is mathematically correct but ergonomically backwards. 
    *   *Adjustment:* **Do Directive 3 first.** D3 fixes the infinite template literal union that hangs the IDE. If you implement D1/D2 first, your IDE will still be sluggish while authoring them. Fixing D3 instantly restores IDE responsiveness, making the D1 and D2 refactors faster to author and verify.

### 4. Missing Optimisations
*   **Template Literal Constraint Simplification (Directive 3):**
    Once you apply the `as ExtractLiteralKeys<K>` filter to `Path<T>`, `K` is guaranteed to be a literal `string` or `number` (symbols are stripped).
    *   *Action:* You can safely simplify the right-hand side of `Path<T>` by removing the redundant `K extends string | number ? ... : never` check, reducing compiler workload:
    ```typescript
    // Optimized Path<T>:[K in keyof T as ExtractLiteralKeys<K>]-?: `${string & K}` | `${string & K}.${Path<NonNullable<T[K]>, Prev[Depth]>}`
    ```

## Decisions

| # | Gemini Suggestion | Decision | Rationale |
|---|---|---|---|
| 1 | Circular dependency risk (D1) | **Reject** | `matchJavascriptObject.ts` already imports from `types.ts`. We're removing the reverse direction, not adding a cycle. |
| 2 | Add `symbol extends K ? never` (D3) | **Accept** | Cheap, defensive. Added to `ExtractLiteralKeys`. |
| 3 | New file for `PrimaryKeyValue` instead of inlining (D2) | **Reject** | Over-engineering for `string \| number`. Existing `isTypeEqual` guard catches drift. |
| 4 | Extract `ExtractLiteralKeys<K>` utility type (D3) | **Accept** | Same pattern in 3 places; named utility improves readability. |
| 5 | Do D3 before D1/D2 (ordering) | **Reject** | D1/D2 edits don't touch JsonValue schemas, so IDE hang is irrelevant during authoring. D1+D2 are lowest risk and give biggest measurable win — verify the big numbers first. |
| 6 | Remove `K extends string \| number` guard after filtering (D3) | **Reject** | TS still needs `string & K` in template literals. Micro-optimization with risk of breakage for negligible gain. |

### Changes applied to Implementation Plan

- **Directive 3:** Added `ExtractLiteralKeys<K>` utility type (includes `symbol extends K ? never`). All three mapped types now use it.
- **No ordering change.** D1 → D2 → D3 remains.
- **No new files for D2.** Inlining stays.

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Analyse how the `WhereFilterDefinition` is constructed - a mental map of it.

Output to `The WhereFilterDefinition spec`.


# [x] Phase 2

Analyse why the `WhereFilterDefinition` might be slow. Consider all different types of schema (deep nested; recursive; schemas with `WhereFilterDefinition` properties inside them - this is very likely a problem, etc) that might be problematic. 

Make you state that these are just ideas, they're not conclusive. 

Output to `Why the WhereFilterDefinition is slow - possible reasons`

# [x] Phase 3

Research the best way to measure TypeScript type performance so you have a means to test and get rapid feedback to iterate on.

Output to `How to measure type performance`.

# [x] Phase 4

Establish what a baseline good performance for a `WhereFilterDefinition` should be - so fast you'd never notice. 

Then find real situations using the `How to measure type performance` where it's objectively slow. E.g. schemas that are deep nested; recursive; schemas with `WhereFilterDefinition` properties inside them - this is very likely a problem, etc. 

Output these to `Baseline Performance and Problem Areas`

# [x] Phase 4b

One thing that previously caused a problem with open recursive JSON types:
```ts
type JsonPrimitive = string | number | boolean | null;

  type JsonObject = {[Key in string]: JsonValue};

  type JsonArray = JsonValue[] | readonly JsonValue[];

  type JsonValue = JsonPrimitive | JsonObject | JsonArray;
```

If a schema used this, and was passed as the generic to `WhereFilterDefinition`, it caused major hangs in the IDE (it was also a schema with a lot of keys and deep nested keys as well).

Can you test this and potentially add it to `Baseline Performance and Problem Areas`.

Also, see if it inspires you to think of more problem areas that might be causing issues, and try those too (adding them to `Baseline Performance and Problem Areas`).

**Files created:**
- `src/where-filter/_perf_test_4b.ts` — All Phase 4b scenarios (16-25) in one file for reproducibility
- `src/where-filter/tsconfig-perf-4b.json` — Isolated tsconfig for the perf test

**Results:** Added to `Phase 4b: JsonValue, Recursive Types, and Additional Scenarios` section under `Baseline Performance and Problem Areas`. 

# [x] Phase 5

Generate a plan to optimise performance, targetting the areas most likely to yield big results, which are: 


### Import Cost Analysis

The import chain from `types.ts` pulls in 637K unnecessary instantiations:

```
types.ts
├── dot-prop-paths/types.ts (type-only)
│   └── utils/getKeyValue.ts → zod                       +93K inst
└── matchJavascriptObject.ts (type-only import of ObjOrDraft, but TS loads the whole file)
    ├── schemas.ts → zod                                  (already counted)
    └── dot-prop-paths/getPropertySimpleDot.ts
        └── dot-prop (npm) → type-fest (npm)              +478K inst  ← 78% of total
```

| What | Instantiations | Check time |
|---|---|---|
| Empty baseline | 82K | 0.64s |
| + zod alone | 175K | 0.95s |
| + type-fest (via dot-prop) | 561K | 2.16s |
| Current (types.ts import) | 719K | 2.13s |
| With both import chains broken | 90K | 0.60s |


Output the implementation plan to `Implementation Plan`

# [x] Phase 6a 
Pass plan to Gemini for feedback. Output me the current implementation plan, and additional context it needs (e.g. relevant types, spirit of library... anything the plan references that another LLM would need to know), and a request to conscisely critique that you can act on. 

# [x] Phase 6b

Gemini responded as seen in the `Implementation Plan Critique from Gemini` section. Analyse it and decide what you agree with (do the change) or disagree with (talk to me about it and we'll decide). 
Output the final decisions as a new subsection under `Implementation Plan Critique from Gemini`, and update the `Implementation Plan`. 


# [x] Phase 7

Implement Directives 1 and 2 from the `Implementation Plan`.

**Results (D1+D2 only):**
| Metric | Before | After |
|---|---|---|
| Instantiations (perf benchmark) | 719K | 155K |
| Check time (perf benchmark) | 2.13s | 0.70s |
| Reduction | — | -78% inst, -67% time |

All 746 where-filter + dot-prop-paths tests pass. No new type errors in source files.

**Directive 3 was skipped** — see Phase 8.

**Files changed:**
- `src/where-filter/types.ts` — Moved `ObjOrDraft` definition here (with `import type { Draft } from "immer"`), removed import from `matchJavascriptObject.js`
- `src/where-filter/matchJavascriptObject.ts` — Removed local `ObjOrDraft` definition, imports and re-exports from `types.ts`
- `src/dot-prop-paths/types.ts` — Replaced `import type { PrimaryKeyValue } from "../utils/getKeyValue.js"` with inline `type PrimaryKeyValue = string | number`

# [x] Phase 8

**Goal:** Fix the IDE hang and correctness issues with index-signature types (JsonObject, Record<string, any>) in `Path<T>` — the original Directive 3 — without breaking valid paths through index-signature properties.

## Problem recap

When T has a property typed as `Record<string, number>` (e.g. `pets: Record<string, number>`), `Path<T>` recurses into it and produces template literal paths like `` `pets.${string}` ``. This causes:
1. **IDE hang**: Autocomplete tries to enumerate/display paths containing `${string}`, which produces infinite suggestions
2. **Correctness bug**: `PathValueIncDiscrimatedUnions` resolves to `never` for some paths when index-sig types are present alongside other properties, breaking valid filter assignments

## Constraint: valid paths through index signatures must still work

Paths like `'pets.somePet'` (where `pets: Record<string, number>`) are **valid and must continue to compile without error**. A `Record<string, X>` property should accept any string key in dot-path notation. The original D3 approach (`ExtractLiteralKeys`) filtered these out entirely, which was too aggressive.

## What D3 attempted

Added `ExtractLiteralKeys<T, K>` to filter out index-signature keys (`string extends K ? never : ...`) from `Path<T>`, `DotPropPathToArraySpreadingArrays`, and `DotPropPathToObjectArraySpreadingArrays`. This fixed the IDE hang and correctness bug but broke 5 test lines:
- `dot-prop-paths/types.test.ts:24` — `'pets.somePet': 1` on `Record<string, number>` property (valid, should work)
- `where-filter/types.test.ts:800-801` — paths through `ErrorObject` (index sig) — tests documented these as "Problem" (known bugs where type was too permissive), but they must still compile
- `where-filter/types.test.ts:836-837` — paths through `ErrorObject.serializedError` (index sig)

## Approaches to explore

Keep an open mind — these are starting points, not an exhaustive list:

1. **Tighter depth limits for index-sig recursion**: When `Path<T>` encounters an index-sig type (where `string extends keyof T`), reduce the remaining depth to 1 or 0 instead of continuing with the full depth budget. This would allow `pets.somePet` but prevent `pets.${string}.${string}.${string}...` from exploding.

2. **Cap template literal width**: Instead of filtering keys, detect when a path segment would produce `${string}` and limit how deep the recursion continues from that point. E.g. allow one level of `${string}` in a path but not recursive expansion.

3. **Separate handling in PartialObjectFilter**: Rather than changing `Path<T>` itself, add a post-processing step in `PartialObjectFilter` that filters out paths containing `${string}` segments from the key union used for autocomplete, while still accepting them for assignability.

4. **Lazy evaluation / interface-based mapped types**: Replace the eagerly-computed path union with an interface or branded type that TS resolves lazily on access rather than upfront. This could prevent the IDE from trying to enumerate all paths at once.

5. **Different approach to the correctness bug**: The `never` resolution might be fixable in `PathValueIncDiscrimatedUnions` directly (handling the case where the path goes through an index signature) without changing `Path<T>` at all.

## Verification

Same as Phase 7:
1. `npx tsc --noEmit` — no new errors
2. `npx vitest run src/where-filter/ src/dot-prop-paths/` — all tests pass
3. `npx tsc -p src/where-filter/tsconfig-perf-4b.json --extendedDiagnostics --noUnusedLocals false` — confirm no regression from D1+D2 baseline (155K inst, 0.70s)
4. IDE responsiveness test: open a file using `WhereFilterDefinition<SchemaWithJsonValue>` and verify autocomplete responds within 100ms

## Implementation

**Approach taken:** Configurable index-sig depth (ISD) — a hybrid of approaches 1 and 2. When `Path<T>` encounters an index-signature key (`string extends K`), it recurses with a separate depth counter (`ISD`, default 2) that decrements independently of the main depth. Normal literal keys use the standard depth counter (6) and pass ISD through unchanged.

### How it works in `Path<T, Depth, ISD>`:
- **Literal keys** (e.g. `name`, `age`): recurse with `Path<T[K], Prev[Depth], ISD>` — full depth, ISD preserved
- **Index-sig keys** (`string extends K`): recurse with `Path<T[K], ISD, Prev[ISD]>` — switch to ISD as depth, decrement ISD
- **ISD exhausted** (`ISD extends 0`): produce just `${string & K}`, no recursion

This means for `Record<string, {a: {b: string}}>` with ISD=2:
- Paths generated: `${string}`, `${string}.a`, `${string}.a.b` — 2 levels deep through the index sig ✓
- For recursive types like `JsonObject`: `${string}`, `${string}.${string}` — stops at ISD levels ✓
- For `pets: Record<string, number>`: `pets.${string}` matches `pets.somePet` ✓

### `DotPropPathToArraySpreadingArrays` and `DotPropPathToObjectArraySpreadingArrays`:
These skip index-sig keys entirely (`never`), regardless of ISD. We can't statically determine which index-sig values are arrays, so paths through them default to `ValueComparisonFlexi` rather than `ArrayFilter`.

### ISD threading through the type chain:
ISD is propagated as an optional generic param (default 2) through: `Path` → `DotPropPathsUnion` → `DotPropPathsIncArrayUnion` → `PartialObjectFilter` → `LogicFilter` → `WhereFilterCore` (internal). Recursive types (`ArrayElementFilter`, `ArrayValueComparisonElemMatch`) reference `WhereFilterCore<T, ISD>` to maintain the depth setting through sub-filters.

### Public API:
- `WhereFilterDefinition<T>` — unchanged, uses ISD=2 internally
- `WhereFilterDefinitionDeep<T, IndexSigDepth = 6>` — escape hatch for deeper index-sig paths
- JSDoc on `WhereFilterDefinition` documents the limit and how to use the deep variant

**Results:**
| Metric | Before D1+D2 | After D1+D2 | After D1+D2+D3 (Phase 8) |
|---|---|---|---|
| Instantiations | 719K | 155K | **136K** |
| Check time | 2.13s | 0.70s | **0.75s** |

All 746 tests pass. No new type errors.

**Files changed:**
- `src/dot-prop-paths/types.ts` — `Path`, `DotPropPathsUnion`, `DotPropPathsIncArrayUnion` gain ISD param; index-sig depth control in `Path`; index-sig skip in array-spreading types
- `src/where-filter/types.ts` — Added `WhereFilterCore` (internal), `WhereFilterDefinitionDeep` (public); ISD param threaded through `ArrayValueComparisonElemMatch`, `ArrayValueComparison`, `ArrayElementFilter`, `ArrayFilter`, `PartialObjectFilter`, `LogicFilter`; updated JSDoc
- `src/where-filter/index.ts` — Exports `WhereFilterDefinitionDeep`

