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

**Outcome (implemented)**: Adopted. `mingo` runs as `WF-P14` in the JS reference consumer only
(`standard-tests/mingo/`), comparing the reference matcher against an independent MongoDB implementation over
25,000 generated filters. It needs its own generator: the main fuzz profile is confined to operators all three
engines agree on, which excludes precisely the constructs where this package parts company with MongoDB, so
reusing it would have produced a green that proved nothing. Disagreements are shrunk to a minimal reproducer
before being grouped by shape — a logic node disagrees because one arm does, and reporting the whole tree both
buries the cause and lets an accepted divergence claim a bug riding along in a sibling arm.

The residual set after triage was four shapes, under the threshold above. Two were accepted divergences already
documented (`#2`, `#15`); two were real Mongo-conformance **bugs**, and the oracle is the reason they are known.
Both are fixed (see the Release notes), and their `PENDING_BUGS` entries are deleted — the deletion is the
regression test, since nothing is left to excuse the disagreement if it returns.

The oracle earns its keep by reproducing the divergences that *are* accepted. That is its calibration: a run
surfacing none of them would mean the generator never reached the interesting language, not that we conform.

**`mingo` is not itself a faithful oracle, and the blind spots are recorded** (`MINGO_QUIRKS`). It does not
traverse arrays for `$type`, so it shares divergence #1 and cannot witness it. More dangerously, it
mis-evaluates a path crossing two arrays, answering `false` where `mongod` answers `true` — **this package
agrees with MongoDB and mingo is the outlier**. Such paths are excluded from the oracle's generator rather than
filtered from its output, because an oracle that cannot evaluate a construct must not be asked about it;
filtering afterwards would be an ignore-list concealing the oracle's own defect. The coverage that costs is
carried by example tests and by the `mongo-truth` corpus instead (decision 12).

See `standard-tests/mingo/MINGO-ORACLE.md` for how the oracle works and what to do when it disagrees.

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

## 10. The escaped-dot path grammar is not unified across the JS and SQL readers

**Context**: A dot-prop path escapes a literal dot in a key as `\.`. The SQL path reader
(`parseDotPropPathSegments`) recognises only that escape; the JS matcher reads paths through the `dot-prop`
package, which additionally decodes `\\`, `\[` and `\]`. The two readers therefore disagree on a path that
uses those extra escapes, and a key that itself contains a backslash cannot be named at all (see
`MONGO-DIVERGENCES.md`).

**Decision**: Leave the two readers as they are; document the divergence rather than remove it.

**Why**: The affected keys are pathological — a field name literally containing `\`, `[` or `]` — and the
common `\.` escape already agrees across both readers. Unifying the grammar changes how the JS matcher reads
every path, so it is a behaviour change that warrants its own red-first work, not a documentation pass.

**Future work**: Route the JS matcher through the SQL reader instead of `dot-prop`: have `matchJavascriptObject`
split paths with `parseDotPropPathSegments`, and evaluate a spread leaf's captured `value` directly
(`evaluatePredicate(leaf.value, …)`) rather than re-parsing the emitted `path` string back through
`getProperty`. That makes one grammar authoritative and removes a lossy parse→render→parse round trip; the
`path` field on the spread result would then serve only `getArrayScopeItemAction`.

---

## 11. `$exists`/`$type` in a scalar `$elemMatch` body are not made element-wise

**Context**: In a scalar `$elemMatch` body, `$exists` and `$type` are field-level operators — they describe a
field's presence or runtime type, not any single element. `parseElemMatchScalarPredicate`
(`ast/parseFieldPredicate.ts`) routes any body mentioning a field-level operator to a per-element deep-equal,
so the whole body is compared as a literal object against each element. No scalar element equals such an
object, so the filter matches nothing: `{ tags: { $elemMatch: { $exists: true } } }` and
`{ tags: { $elemMatch: { $type: 'string' } } }` are both `false` on `['a']`, and mixing in a scalar predicate
does not change that — `{ tags: { $elemMatch: { $exists: true, $eq: 'a' } } }` is `false` too, where a
first-operator-wins reading would have returned `true`. MongoDB instead reads the body element-wise and
matches. Every engine agrees on the current behaviour (see `MONGO-DIVERGENCES.md` #15).

**Decision**: Keep the inert semantics and document them as a divergence. The behaviour is strictly
conservative — it can only under-match relative to MongoDB, never match more.

**Why**: An element-level `$exists`/`$type` is low value — `$exists` on an element is nearly always true (an
enumerated element exists), and an element's `$type` is expressed more directly by matching the element
itself. Making it conformant is another cross-engine behaviour change touching every engine, not warranted
for an operator combination with so little practical use.

**Alternative (Mongo-conformant, element-wise)**: applying `$exists`/`$type` per element on all engines would
require defining the element semantics precisely — `$exists: true` matches any present element (so any
element of a non-empty array), `$exists: false` matches no element, `$type: X` matches an element whose JSON
type is `X`, and a mixed body ANDs the element predicates; dropping the `FIELD_LEVEL_OPERATORS` carve-out in
`parseElemMatchScalarPredicate` so such a body is parsed as a per-element predicate rather than a deep-equal;
teaching `evaluatePredicate`'s scalar-`$elemMatch` arm to evaluate those operators against each element; and
mirroring the same in both SQL translators' leaf-array `$elemMatch` emission. It is a behaviour change, so it
needs red-first tests — flipping §18.30/18.31 (false→true) and the §18.34 mixed pin, sabotage proofs, and a
≥1000-iteration fuzz whose `$elemMatch` generator and `slowLeafScopeEval` cover `$exists`/`$type` bodies
(guarding the missing-field/leaf-scope confound) — plus a consumer release note.

---

## 12. How to handle the 2 where-filter test oracles (Mingo and matchJavascriptObject) disagreeing

**Context**: The suite runs two oracles. `matchJavascriptObject` — the reference matcher — is what every engine
is measured against, so it decides *engine agreement*. `mingo`, an independent implementation of the MongoDB
query language, is run against that reference as a secondary oracle (`WF-P14`), so it decides *MongoDB
conformance*. When they disagree, one of them is wrong about MongoDB, and it is not always the one you expect:
of the findings the oracle produced, one was **mingo** being wrong while this package was right. Acting on it
would have "fixed" behaviour that already conformed.

**Decision**: **Neither oracle is authoritative. A real `mongod` is.** On a disagreement, add the case to
`standard-tests/mongo-truth/` and run it (`npm run test:mongo-truth`) *before* changing any code. Then file the
finding in exactly one of three registers — never a fourth:

- **`KNOWN_DIVERGENCES`** — `mongod` agrees with mingo, and we differ *deliberately*. It must cite a numbered
  `MONGO-DIVERGENCES.md` entry. This is a decision.
- **`PENDING_BUGS`** — `mongod` agrees with mingo, and we differ *by accident*. This is a debt. Pin it with a
  test describing the wrong answer, so a fix arrives with a test to invert. **Delete the entry when it is
  fixed — never re-explain it.** The deletion is its regression test: with nothing left to claim the
  disagreement, a regression surfaces immediately as an unexplained shape rather than being quietly reabsorbed
  as accepted behaviour.
- **`MINGO_QUIRKS`** — `mongod` agrees with **us**, and mingo is the outlier. The oracle is blind here, and
  saying so is the point: silence must not be mistaken for conformance.

Two rules keep the apparatus honest:

1. **A construct mingo evaluates incorrectly is excluded from the generator, never filtered from its output.**
   Filtering afterwards would bury the oracle's own defect inside the list of *our* divergences, which is how a
   blind spot becomes mistaken for conformance. Excluding at the source keeps the ignore list honestly about us
   — and the coverage that costs must be stated and carried by an example test.
2. **An ignore predicate must be minimal.** Each one needs a test proving it fires on its own construct *and*
   stays silent on its neighbours, plus a sabotage proving an unrelated defect still reds the run. An
   over-broad predicate is the single failure that would make the whole apparatus decorative: it files a real
   bug under an accepted divergence, and the suite goes green.

**Why**: an oracle exists to catch a misunderstanding *shared* by everything else. Its value is entirely in the
disagreements it produces, so the disagreements must be triaged against something neither oracle can influence.
A large ignore list, or a register that blurs "decision" into "debt", is indistinguishable from having no oracle
at all — it produces reassurance instead of evidence.

---

## 13. Fix an over-match; document an under-match

**Context**: This package reads an array-descended path differently from MongoDB (divergence #16), and such a
reading is never neutral — it either returns rows MongoDB excludes, or excludes rows MongoDB returns. The two
are not equally bad, and a rule was needed for deciding which departures to fix and which to write down.

**Decision**: **An over-match is a bug and gets fixed. An under-match may be a documented divergence.** A filter
is a caller's statement about which rows they will accept, so returning one they excluded is unsound — no amount
of documentation makes it safe. Returning fewer rows than MongoDB would is a loss of recall: a caller can see it,
work around it, and nothing downstream is corrupted by it.

**Why**: it is the only line that stays stable under composition. Leaf scope (#16) is conservative on its own —
`∃leaf. (P ∧ Q)` implies `(∃leaf. P) ∧ (∃leaf. Q)`, so it can only under-match. But **negation inverts the
sign**: `¬` of an under-match is an over-match. So the conservatism argument is only available to a package whose
negations are handled at the level they deny — which is why `$ne`, `$nin` and `$not` are lifted out of the leaf
fold (#16) and why a comparison operator was made element-wise (retiring #13) rather than left as a "conservative"
under-match that `$not` turned into a spurious match.

This is the same argument decision 11 uses to keep #15: it is inert, so it can only under-match. That argument is
sound **only** while nothing negates it, and it is worth re-checking whenever an operator's reach changes.

---

## 14. An array field's type carries the same comparison vocabulary as the gate

**Context**: A value operator on an array field reads element-wise (#13), and the runtime gate — which is
schema-blind — admits the whole value vocabulary on any field. The schema-derived type did not: an array field
was offered only the array operators, so `{ tags: { $eq: 'a' } }` was a compile error while
`{ tags: { $not: { $eq: 'a' } } }` compiled, because `$not` was in the array-element union and its argument
union is written in terms of the element type. The type forbade the sound form and permitted the form that was
unsound before #13 was fixed.

**Decision**: A SCALAR-element array takes the full value-operator payload vocabulary, parameterised by the
ELEMENT type, plus the bare element as a containment test — the same set the gate admits and every engine
answers. An OBJECT-element array does not take the comparison family (`$eq`/`$ne`/range/`$regex`); it keeps
the compound object filter, `$elemMatch`, and the meta operators.

**Why**: coherence in both directions. A caller who can write a filter in TypeScript can serialise it as JSON
and get the same answer, and a filter arriving as JSON has a TypeScript spelling — the type is no longer a
strict, arbitrarily-shaped subset of the language the engines actually run.

The object-element exclusion is a soundness constraint, not a semantic one. An object element's filter arm is
`PartialObjectFilter`, whose keys are all optional, and TypeScript disables the excess-property check on a
union the moment a key is known in ANY member. Adding `$eq` beside that arm would therefore admit
`{ addresses: { $eq: 5 } }` and any other unchecked operand — the type would get *weaker* by gaining an
operator. The gate rejects an object operand for those operators regardless (#8), so no expressible filter is
lost: an object element is filtered with a sub-document filter or `$elemMatch`.

**Consequence**: boolean elements became expressible for the first time, which surfaced a latent Postgres
defect. Postgres reads an array element (and a leaf below an array) through a text projection — `#>> '{}'` —
and has no `text = boolean` operator, so a boolean operand made the statement fail to execute at all. It was
already known that `$in`/`$nin` had to compare a boolean against the RAW jsonb rather than that projection;
what was missed is that this is a property of the **operand**, not of the operator, so `$eq` and a bare
boolean needed it just as much. Postgres now decides *any* boolean-operand comparison against the raw jsonb
element, on every path that spreads an array.

---

## 15. `$elemMatch` is answered by the value at the path, never by the set of values the path reaches

**Context**: A dot-prop path that descends through an array yields one leaf per element — `'items.k'` over
`[{k:'a'},{k:'b'}]` reaches `'a'` and `'b'`. Both SQL engines held an `$elemMatch` body against those leaves
one at a time, so `{ 'items.k': { $elemMatch: { $eq: 'a' } } }` matched. MongoDB and the JS matcher answer
`false`: `$elemMatch` requires the value AT the path to itself be an array, and a scalar is not one.

**Decision**: `$elemMatch` matches only when the value at the path IS an array and one of ITS OWN elements
satisfies the body. A scalar leaf answers nothing — the same reading `$elemMatch` on any non-array gets.

**Why**: the set of leaves a path reaches is not an array, and treating it as one silently answers a different
question — "does SOME element's leaf satisfy the body" instead of "does one element of this array satisfy it".
That reading is strictly wider, so it returned rows MongoDB excludes: an over-match, which decision 13 classes
as a bug to fix rather than a divergence to document. It also made `$elemMatch` indistinguishable from the
plain element-wise reading on such a path, when the two asking different questions is the entire point of the
operator (a nested-array leaf like `'groups.tags'`, whose value genuinely IS an array, was answering correctly
throughout, and still does).

**The array test reads the STORED value, not the declared schema.** The schema-driven emitters know the leaf
is scalar and could have emitted a constant `false`, which is cheaper. They do not, because a row may hold
array data under a scalar-declared field, and the value-driven matcher answers such a row from what is there.
Deciding it from the schema would part company with the matcher exactly when the data does not conform — and
since `$elemMatch` can sit under `$nor`, an under-match there inverts into an over-match. Testing the value
keeps all four engines on the same answer for any data, conforming or not, and narrows the value-driven/
schema-driven gap recorded in MONGO-DIVERGENCES.md rather than widening it.

The verdicts are pinned against a real `mongod` (`standard-tests/mongo-truth`), not asserted from reading the
MongoDB manual.

---

## Release notes

Behaviour visible to consumers of `WhereFilterDefinition` changes as follows. The semantics of existing
filters are not; the exported types widen (below) without rejecting anything they previously accepted.

- **Multiple operators in one payload are conjunctive everywhere.** `{ n: { $ne: 9, $gt: 5 } }` requires
  both. Previously the first operator won inside `$not` and inside a scalar `$elemMatch`, on every engine.
- **`$not` negates its operand on a missing field** (decision 5). `{ n: { $not: { $ne: 5 } } }` no longer
  matches a row where `n` is absent.
- **A range comparison against a wrong-typed stored value returns `false`** instead of throwing (JS) or
  failing the statement (SQL) — decision 1.
- **A raw dotted filter key never borrows a literal-dot field of the same spelling.** `{ 'x.y': … }` reads as
  nested `x`→`y`; a schema declaring the literal-dot key `"x.y"` no longer answers the raw path from that
  field on the SQL engines — it resolves as a missing field, matching the JS matcher. Each reading of a
  colliding path (raw `a.b` vs escaped `a\.b`) now resolves independently. As a consequence, `a.b.c` on a
  schema with a record `a` and a literal-dot sibling `"a.b"` now resolves through the record.
- **An untrusted filter path naming an inherited property no longer crashes SQL compilation.** A record path
  such as `data.<key>.constructor` or `…__proto__` resolves as a missing field (as the JS matcher already
  treats it) rather than reading a non-schema value as a schema and throwing during compilation.
- **A comparison operator on an array field now reads element-wise** (retires divergence #13).
  `{ tags: { $eq: 'a' } }` matches `['a']`, where it previously compared against the whole array and returned
  `false`. `$ne` is its complement — `{ tags: { $ne: 'a' } }` no longer matches `['a', 'b']`, because an
  element does equal `'a'`. Each bound of a range is applied across the elements independently, so
  `{ scores: { $gt: 2, $lt: 4 } }` matches `[1, 5]`; `$elemMatch` remains the way to require ONE element to
  satisfy the whole body, and answers `false` on that same array. This also closes a silent over-match: because
  `$not` complements its operand, an operator that could not reach an element made its own negation match
  everything, so `{ tags: { $not: { $eq: 'a' } } }` used to return `['a']`.
- **A negation on a path that descends through an array now denies the whole path** (divergence #16).
  `{ 'items.k': { $ne: 'b' } }` no longer matches `{ items: [{k:'a'}, {k:'b'}] }` — one element's `k` IS `'b'`,
  so the row is excluded, as MongoDB excludes it. The same holds for `$nin` and `$not`. "Some element differs"
  is a different query, and `$elemMatch` is how to ask it: `{ items: { $elemMatch: { k: { $ne: 'b' } } } }`
  still matches.
- **`$type: 'null'` no longer matches a missing field** (retires divergence #4). It requires the field to be
  present and hold `null`. Plain equality is unchanged and still matches a missing field, so `{ age: null }`
  and `{ age: { $type: 'null' } }` now differ — as they do in MongoDB. The JS matcher was the outlier here;
  the SQL engines already answered this way.
- **A value operator on a scalar leaf below an array now compiles on the SQL engines.**
  `{ 'items.k': { $ne: 'z' } }` and `{ 'items.v': { $gt: 4 } }` previously could not be expressed there and
  were answered `false` regardless of the data (and a range could fail to compile at all).
- **`$elemMatch` on a scalar leaf below an array no longer matches** (decision 15). On the SQL engines,
  `{ 'items.k': { $elemMatch: { $eq: 'a' } } }` matched `{ items: [{k:'a'}] }` by holding the body against each
  element's leaf. It now answers `false`, as MongoDB and the JS matcher always did — the value at `items.k` is
  a string, and `$elemMatch` reads only an array. A leaf that IS an array (`{ 'groups.tags': { $elemMatch: … } }`)
  is unaffected and still matches from its own elements. This narrows a result set: a caller relying on the old
  reading wants the element-wise form, `{ 'items.k': 'a' }` or `{ 'items.k': { $eq: 'a' } }`.
- **Comparing a BOOLEAN against an array element, or against a leaf below an array, now answers on Postgres**
  rather than failing the statement (`operator does not exist: text = boolean`). `{ flags: { $eq: true } }`,
  `{ flags: true }`, `{ flags: { $elemMatch: { $eq: true } } }` and `{ 'items.done': true }` were affected;
  `$in`/`$nin` already answered. JS and SQLite were unaffected throughout (decision 14).

Each of these moves an engine *toward* MongoDB's semantics; none is a new divergence.

Leaf scope is the exception, and is called out here because it is easy to misread as a conformance fix: **a
compound filter on a nested-array path must be satisfied within a single leaf array** (`{ 'groups.tags': { $all:
['a', 'b'] } }` does not match a row whose `'a'` and `'b'` live in different `groups`). That moved `$size`
toward MongoDB but moves a multi-term condition *away* from it. It is a deliberate trade, recorded as divergence
**#16**, not a fix.

A type-only widening (no runtime or semantic change — every filter below already ran, and already answered
this way, when it arrived as JSON): **an array field of scalars now accepts the full value-operator vocabulary
in TypeScript**, parameterised by the element type — `{ tags: { $eq: 'a' } }`, `{ tags: { $ne: 'a' } }`,
`{ tags: { $gte: 'a', $lt: 'z' } }`, `{ tags: { $regex: '^a' } }`, `{ scores: { $gt: 5 } }` — as does a boolean
array (`{ flags: { $eq: true } }`, `{ flags: true }`). Nothing that compiled before stops compiling. An array
of OBJECTS is unchanged: it takes a compound object filter or `$elemMatch`, not the comparison family
(decision 14).

Separately, a type-only tightening (no runtime or semantic change): with `exactOptionalPropertyTypes` enabled
(decision 2), `{ field: { $gt: undefined } }` and `{ $or: undefined }` no longer type-check, and a bare
`bigint`/`symbol` operand is now a compile error (decision 3) — each was previously accepted by the type and
rejected only at the runtime gate. One gap remains: a present-`undefined` operator *beside* a defined one
(`{ $gte: 18, $ne: undefined }`) still compiles, and the runtime gate still rejects it.
