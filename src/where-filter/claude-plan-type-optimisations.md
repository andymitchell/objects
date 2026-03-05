
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

# How to measure type performance

# Baseline Performance and Problem Areas


# Implementation Plan

# Implementation Plan Critique from Gemini
_To be filled in_


# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Analyse how the `WhereFilterDefinition` is constructed - a mental map of it.

Output to `The WhereFilterDefinition spec`.


# [x] Phase 2

Analyse why the `WhereFilterDefinition` might be slow. Consider all different types of schema (deep nested; recursive; schemas with `WhereFilterDefinition` properties inside them - this is very likely a problem, etc) that might be problematic. 

Make you state that these are just ideas, they're not conclusive. 

Output to `Why the WhereFilterDefinition is slow - possible reasons`

# [ ] Phase 3

Research the best way to measure TypeScript type performance so you have a means to test and get rapid feedback to iterate on. 

Output to `How to measure type performance`. 

# [ ] Phase 4

Establish what a baseline good performance for a `WhereFilterDefinition` should be - so fast you'd never notice. 

Then find real situations using the `How to measure type performance` where it's objectively slow. E.g. schemas that are deep nested; recursive; schemas with `WhereFilterDefinition` properties inside them - this is very likely a problem, etc. 

Output these to `Baseline Performance and Problem Areas`

# [ ] Phase 4


Generate a plan to optimise performance. It's almost certainly a loop of looking at `Baseline Performance and Problem Areas`, hypothesising ways to improve performance, testing it, and accepting improvements (trying to find the true maxima rather than local - HOW?).

In every attempt to improve (e.g. every loop cycle), verify `types.test.ts` still passes type checking; and so does every file in the repo. 

# [ ] Phase 5a 
Pass plan to Gemini for feedback. Output me the current implementation plan, and additional context it needs (e.g. relevant types, spirit of library... anything the plan references that another LLM would need to know), and a request to conscisely critique that you can act on. 

# [ ] Phase 5b

Gemini responded as seen in the `Implementation Plan Critique from Gemini` section. Analyse it and decide what you agree with (do the change) or disagree with (talk to me about it and we'll decide). 
Output the final decisions as a new subsection under `Implementation Plan Critique from Gemini`, and update the `Implementation Plan`. 


# [ ] Phase 6

Implement the `Implementation Plan`

