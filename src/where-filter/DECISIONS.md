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

---

## 3. Operand types exclude `bigint` and `symbol` only

**Context**: Filter operands cross a JSON storage boundary. The runtime gate rejects every non-JSON
carrier — `Date`, `Map`, `Set`, class instances, functions — but the *type* of a bare value or an
equality-family operand (`$eq`/`$ne`/`$in`/`$nin`/`$all`) is derived from the schema, so a `Date` field
yields a `Date`-typed operand that compiles and then fails at runtime.

**Decision**: Exclude `bigint | symbol` at those operand positions. Do not (yet) apply a recursive
`JsonCompatible<T>` mapping.

**Why**: The shallow exclusion is free at type-check time and catches the two carriers that have no JSON
representation at all. A recursive mapping would close the remaining hole, but conditional types over the
already-large filter unions carry a real risk of degrading editor responsiveness, and a `Date`-typed field
would collapse its operand to `never` — a worse developer experience than a runtime error with a clear
message.

**Future work**: Measure a full `JsonCompatible<T>` under `tsc --extendedDiagnostics` and
`--generateTrace`, on representative deep schemas, before adopting. Until then, the `Date` /
class-instance hole is a documented runtime rejection (see `MONGO-DIVERGENCES.md`, operand domain).

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
