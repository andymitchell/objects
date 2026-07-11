# WhereFilterDefinition: design decisions

A decision register for choices that shape the public contract of `WhereFilterDefinition` and its three
engines (pure-JS matcher, SQLite/JSON, Postgres/JSONB). Each entry states the context, the decision, and
why — so a future maintainer can tell a deliberate trade-off from an accident.

Semantic departures from MongoDB live in `MONGO-DIVERGENCES.md`. This file records decisions *about* the
implementation: which behaviour is authoritative, what we deliberately do not support, and what remains
open. Where a decision changes observable behaviour for consumers, it is repeated in **Release notes**
at the foot of this file.

---

## 1. Range comparisons type-bracket instead of erroring

**Context**: A range operator (`$gt`/`$gte`/`$lt`/`$lte`) can be applied to a field whose *stored* value is
of a different type than the operand — for example `{ price: { $gt: 5 } }` against a row where `price`
holds the string `"cheap"`. Historically the JS matcher threw, and both SQL emitters manufactured a
deliberate runtime error so the statement would fail at execution time and mirror the throw.

**Decision**: The row simply does not match. All three engines return `false`. The JS throw is removed and
the manufactured SQL errors are deleted.

**Why**: This is MongoDB's own semantics — comparison operators *type-bracket*: a value of the wrong BSON
type is not comparable, so it does not match, and the query still returns the other rows. It also removes
a portability hazard: there is no non-brittle way to raise a mid-predicate error in both SQLite and
Postgres, so "erroring" was never uniform across engines.

Malformed *operands* (a range operand that is not a comparable scalar) are unaffected — those are still
rejected at the validity gate, because they indicate a broken filter rather than a non-matching row.

---

## 2. `exactOptionalPropertyTypes` is enabled repo-wide

**Context**: With this compiler option off, `{ $gt: undefined }` type-checks against `{ $gt?: number }`,
so the type system permits filters that the runtime gate rejects. TypeScript offers no other way to ban an
explicit `undefined` on an optional property.

**Decision**: Enable `exactOptionalPropertyTypes` globally rather than scoping it to this module.

**Why**: A scoped `tsconfig` would leave the rest of the repo free to hand this module a filter it cannot
accept, which defeats the point of the pin. Enabling it globally surfaces every place a value is widened
to include `undefined` implicitly. Sites where the stricter equality changes an assertion outcome are
investigated individually rather than suppressed — each such site is a real question about whether the
property means "absent" or "present and undefined".

**Outcome (implemented)**: Enabling the flag induced 44 type errors, all resolved without suppression and
with no runtime behaviour change (the full suite stays green).

- *The `isTypeEqual<z.infer<Schema>, HandWrittenType>` assertions that broke (`WriteError`,
  `WriteOutcomeOk`/`WriteOutcomeFailed`/`WriteOutcome`, `WriteResult`) were NOT real bugs.* Under the flag a
  Zod `.optional()` infers `key?: T | undefined`, but the hand-written twin declared `key?: T`. The schema is
  the source of truth (`z.infer`), so each hand-written optional was widened to `| undefined` to re-align —
  a type-honesty change, not a behaviour change. Fields touched: `WriteError.message`/`serialised_schema`/
  `where_path`/`data_path`; `WriteOutcome*.affected_items`/`tested_item`/`unrecoverable`/`back_off_until_ts`/
  `blocked_by_action_uuid`; `WriteResult.error`.
- *The remaining errors were mechanical `| undefined` widenings* on issue and config types
  (`NonJsonValueIssue`, `WhereFilterValidationIssue`, `WritePayloadSchemaIssue`, both SQL `EmitContext`s,
  `TreeNode`, `WriteToItemsArrayOptions`, the query `StandardTestConfig.ddl`, the write-adapter `options`),
  each of which is legitimately present-and-undefined at a construction site, plus two test fixtures that
  passed an explicit `undefined` (dropped).
- *`constrainDeltaToFilter` was fixed at the construction site, not by widening the type.* Widening
  `ObjectsDeltaApplicable`'s optionals would break its `Required<ObjectsDeltaApplicable> extends ObjectsDelta`
  alignment assertion, so instead `created_at` is copied only when present and the `upsert` read is hoisted to
  a narrowed const — behaviour-identical (`isObjectsDeltaFast` classification is unaffected).
- *The present-undefined type gap partly closed.* `{ $gt: undefined }` and `{ $or: undefined }` are now
  compile errors, matching the runtime gate. A residual gap remains: a present-undefined operator *beside* a
  defined one (`{ $gte: 18, $ne: undefined }`) still compiles, because the payload matches the union member
  its defined operator satisfies and the extra key is not excess-checked away. The runtime gate still rejects
  it (§25).

---

## 3. Data operand types are narrowed to the JSON-serialisable subset (`JsonCompatible<T>`)

**Context**: Filter operands cross a JSON storage boundary. The runtime gate rejects every non-JSON
carrier — `Date`, `RegExp`, `Map`, `Set`, functions, `bigint`, `symbol`, class instances — but the *type* of a
data operand is derived from the schema, so without a matching type-level narrowing a carrier-typed field yields
an operand that compiles and then fails at runtime.

**Decision**: At the data operand positions — the bare value (`ValueComparisonFlexi`) and `$all` elements
(`ArrayValueComparisonAll`) — narrow the operand type with a recursive `JsonCompatible<T>` mapping that collapses
any non-JSON carrier to `never`, recursing into objects and arrays so a carrier nested inside an object operand is
rejected too.

**Why**: This mirrors the runtime serialisable-subset gate at compile time, turning a class of runtime failures
into compile errors — including the nested case a shallow top-level exclusion cannot reach. The equality-family
operands (`$eq`/`$ne`/`$in`/`$nin`) already collapse non-scalars to `never` through their own conditional
narrowing, so they are left unchanged; `JsonCompatible` over their pre-narrowed scalar value would be a no-op.

**Cost**: The recursive mapping is affordable. It touches only per-path *value* narrowing — where most leaves are
scalars that short-circuit after a couple of conditionals — not the expensive dot-prop *path* enumeration, so it
adds well under 1% of total type instantiations both repo-wide and on worst-case deep / wide / carrier-bearing
schemas, and is not a hot type under `tsc --generateTrace`. `tsc --extendedDiagnostics` instantiation and type
counts are input-deterministic, which makes this measurable to a fraction of a percent.

**Limitations** (residual holes, all backstopped by the runtime gate):
- A *structurally-plain* class instance is indistinguishable from a plain object in the type system, so only the
  runtime gate rejects it. (A class instance carrying methods is caught, because a method property maps to `never`.)
- Recursion is depth-capped; beyond the cap a carrier passes through unchanged. The cap keeps self-referential and
  pathologically deep schemas from exceeding the instantiation-depth limit.
- Tuples are treated as arrays — positional structure is flattened to the element union.

**Outcome**: `JsonCompatible<T>` is applied at `ValueComparisonFlexi` (bare value) and `ArrayValueComparisonAll`
(`$all`). Compile pins (`types.test.ts`) fix a bare `bigint`, a `bigint` `$all` element, a bare `Date`, and a `Date`
nested inside an object operand as errors, and pin that a `Date`-typed field is still reachable via `$exists`. The
one behavioural trade-off is that a `Date`-typed field's bare operand is a compile error rather than a
compile-then-runtime failure — stricter, and no path-value consumer relies on the former leniency.

---

## 4. `$size` bounds are enforced at runtime, not in the type

**Context**: `$size` takes a non-negative integer. The runtime schema enforces `int >= 0`; the TypeScript
type is plain `number`.

**Decision**: Keep the type as `number` and document the runtime constraint.

**Why**: TypeScript cannot express "non-negative integer" as a checkable type for arbitrary numeric
expressions. A branded type would push the burden onto every caller for a constraint the gate already
enforces with a clear error.

---

## 5. `$not` negates its operand, including on a missing field

**Context**: `{ field: { $not: { $ne: 5 } } }` applied to a row where `field` is absent. Two readings are
possible: short-circuit to `true` because the field is missing, or negate the inner predicate's own result
on the missing field.

**Decision**: `$not` uniformly returns the negation of its inner predicate. On a missing field,
`{ $not: { $ne: 5 } }` is `false` (because `$ne` matches a missing field), and `{ $not: { $exists: false } }`
is `false`.

**Why**: This is MongoDB's semantics. All three engines previously short-circuited `$not` on a missing field
to `true` regardless of the operand, so they agreed with each other and disagreed with MongoDB. Negation
that does not distribute over its operand is not negation, and it breaks the complement law
(`{$not: X}` matches exactly the rows `X` does not) that the differential fuzz suite enforces.

---

## 6. Record-value arrays are an acknowledged unsupported path

**Context**: A path may descend through a `z.record(...)` into a value schema that contains an array — for
example `data.<key>.tags` where `data` is `Record<string, { tags: string[] }>`. The SQL array-spreading
builders take schema tree nodes, which do not exist for a dynamic record key.

**Decision**: Non-array leaves beneath a record resolve and compile normally. A path that crosses an array
*inside* a record value returns a typed unsupported-path error, surfaced to callers as a refusal to
compile — never a crash and never a silent non-match.

**Why**: The correct fix threads a segment-level representation through the spread builders, which is a
self-contained piece of work with no current consumer. Refusing loudly keeps the engines uniform in the
meantime.

**Future work**: Teach the array-spreading builders to accept resolved path segments rather than schema
tree nodes, which lifts the restriction. Note also that multi-scalar union detection does not currently
descend into record value schemas, so a union-typed leaf beneath a record is not detected.

---

## 7. `mingo` is adopted as a secondary fuzz oracle only if it stays quiet

**Context**: The differential fuzz suite compares each engine against our own reference matcher. A shared
misunderstanding of MongoDB semantics would be invisible to it. `mingo` is an independent MongoDB query
implementation with no dependencies.

**Decision**: Add `mingo` as a development dependency and run it as a secondary oracle in the JS reference
consumer. Disagreements are deduplicated by filter *shape* (operators and structure, operands stripped).
If fewer than five distinct shapes disagree, triage each and keep the oracle permanently in CI. If five or
more do, produce the report and stop for a human decision rather than encoding a large ignore list.

**Why**: A secondary oracle is only worth its maintenance cost if its residual disagreement set is small
enough to be understood entry by entry. A large ignore list is indistinguishable from no oracle at all.

---

## 8. The equality family's operand domain is narrower than `$all`'s

**Context**: `$all` and a bare exact-array accept the full JSON value domain, so an operand may itself be an
array or an object — `{ matrix: { $all: [[1, 2]] } }`. `$eq`, `$ne`, `$in` and `$nin` accept only strings and
finite numbers (`$eq` also booleans and null), even where the field's element type is structural. The
TypeScript types are more permissive than the runtime gate at these positions.

**Decision**: Keep the narrower domain for now. It is pinned by test, so a widening must be deliberate.

**Why**: The asymmetry is not load-bearing — it is where the gate's per-operator operand schemas were
tightened at different times. Widening `$in`/`$nin`/`$eq`/`$ne` to structural operands is an expansion of the
accepted filter language, not a bug fix, and every engine would need its structural-comparison path wired
through those operators. Deciding it under a behavioural-fix effort would smuggle an API change into a
conformance change.

**Future work**: Unify the operand domain across the equality family when the operator metadata becomes a
single registry, so each operator's operand schema is declared once rather than restated per payload.

---

## 9. Schema path resolution ignores inherited object properties

**Context**: A dot-prop path is resolved against a schema's flat path map — a plain object keyed by path. A
plain object inherits `__proto__`, `constructor`, `hasOwnProperty`, `toString` and the rest from
`Object.prototype`, so a bracket lookup for one of those keys returns a truthy value even though no schema
declares it. A path such as `__proto__` or `constructor` would then resolve as a known field, and an engine
would try to address it.

**Decision**: Every path-map lookup is guarded by an own-property check, so an inherited key resolves as
unknown. A record key that a row genuinely holds — even one spelled `__proto__` — still resolves as value
data; only resolution *through inheritance* is refused.

**Why**: Resolving an inherited key as a declared field is a resolver-level version of prototype pollution —
it reports a path no schema holds as known. The in-memory matcher already refuses such paths by an explicit
denylist; the resolver, being the single place that decides what a path means, must not undercut it. Guarding
the lookup is a total fix — it covers every inherited name rather than an enumerated few — and makes every
engine deny a disallowed path with the same verdict, rather than one engine silently declining it.

---

## Release notes

Behaviour visible to consumers of `WhereFilterDefinition` changes as follows. The exported types are
unchanged; the semantics of existing filters are not.

- **Multiple operators in one payload are conjunctive everywhere.** `{ n: { $ne: 9, $gt: 5 } }` requires
  both. Previously the first operator won inside `$not` and inside a scalar `$elemMatch`, on every engine.
- **`$not` negates its operand on a missing field** (decision 5). `{ n: { $not: { $ne: 5 } } }` no longer
  matches a row where `n` is absent.
- **A range comparison against a wrong-typed stored value returns `false`** instead of throwing (JS) or
  failing the statement (SQL) — decision 1.
- **A compound filter on a nested-array path must be satisfied within a single leaf array.**
  `{ 'groups.tags': { $all: ['a', 'b'] } }` no longer matches a row whose `'a'` and `'b'` live in
  different `groups` entries.

Each of these moves an engine *toward* MongoDB's semantics; none is a new divergence.
