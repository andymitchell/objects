# WhereFilterDefinition: intentional divergences from MongoDB

WhereFilterDefinition is a **subset** of MongoDB's query language. Every valid filter is also valid MongoDB syntax — with the exceptions listed below, where our semantics intentionally differ from MongoDB's.

The entries below are of three kinds, and each states which it is:
- a **silent semantic divergence** — the same syntax runs but yields a different result than MongoDB;
- a **loud-rejection subset gap** — an input MongoDB/BSON accepts is refused up front (at the validity gate, or as a typed compile-time refusal) rather than silently mis-evaluated, so every engine stays uniform across the JSON storage boundary;
- a **single-engine storage limit** — a value one engine cannot persist that the others round-trip.

Entries are numbered for stable reference: the capability manifests (`standard-tests/manifests/`) cite them by number, so a number is never reused or renumbered. A retired entry leaves its number as a gap.

Every "**MongoDB**:" claim below is executable. `standard-tests/mongo-truth/` restates each one as a query against a real `mongod` and asserts both answers — MongoDB's and this package's — so an entry cannot quietly become fiction. Run it with `npm run test:mongo-truth`. It is opt-in because it downloads and boots a server; nothing else in the suite does.

## When a divergence-tracking test fails

Every entry below carries a **Slug** line — a stable kebab-case identifier — and is pinned by
`divergence-tracking/<slug>.test.ts` (a retired entry's file pins that the behaviour now *conforms*).
A red test there means a documented claim has stopped holding — do **not** edit the test to green. Instead:
1. The failing file's header names the entry's slug; find the entry here by that slug.
2. Check recent history for the change that moved behaviour: `git log --oneline -- src/where-filter/`.
3. Check what MongoDB actually does: `npm run test:mongo-truth` boots a real `mongod` (the `mongodb` dev dependency).
4. Present the case to the maintainer to decide: a regression (fix the code) or a deliberate change
   (update or retire the entry **and** its test in the same commit).

---

## 1. `$type` checks the field, not array elements

**Slug**: `type-checks-field-not-elements`

**MongoDB**: When a field is an array, `{ field: { $type: 'string' } }` returns `true` if *any element* is a string.

**WhereFilterDefinition**: `$type` checks the field's own runtime type. An array field has type `'array'`, not the type of its elements. Use `{ field: { $type: 'array' } }` to match arrays.

**Rationale**: SQL implementations (`jsonb_typeof` / `json_type`) check the column's type, not element types. Iterating elements for `$type` would require a different SQL pattern and is not needed for current use cases.

**Test**: `$type "string" on array of strings: fails (checks field type, not element types)`

---

## 2. `$all` with empty array matches everything

**Slug**: `all-empty-array-matches-everything`

**MongoDB**: `{ field: { $all: [] } }` either throws an error or returns no matches.

**WhereFilterDefinition**: Returns `true` (JavaScript `Array.every([])` evaluates to `true`).

**Rationale**: Consistent with JavaScript semantics. This is a degenerate edge case unlikely to appear in practice.

**Test**: `$all with empty list: passes (every on empty = true)`

---

## 3. `$regex` case-sensitivity on SQLite

**Slug**: `sqlite-regex-like-case-insensitive`

**MongoDB**: `$regex` is case-sensitive by default. Use `{ $options: 'i' }` for case-insensitive.

**WhereFilterDefinition (JS + Postgres)**: Same as MongoDB — case-sensitive by default.

**WhereFilterDefinition (SQLite)**: `$regex` is translated to `LIKE`, which is case-**insensitive** for ASCII characters in SQLite. Non-ASCII characters are case-sensitive. This means `{ $regex: 'andy' }` will match `'Andy'` on SQLite but not on JS/Postgres/MongoDB.

**Rationale**: SQLite lacks native regex support. LIKE is the best-effort translation. Full regex would require loading an extension.

**Test**: `$regex case-sensitive default: fails`

---

## 4. (retired)

**Slug**: `type-null-on-missing-field`

`$type: 'null'` once matched a missing field on the JS engine, where MongoDB requires the field to be present and hold `null`. The engines disagreed with each other and the JS one was wrong; it now answers `false`, as the SQL engines always did, so this is no longer a divergence. The number is kept as a gap rather than reused.

---

## 5. `$type 'bool'` on SQLite

**Slug**: `sqlite-bool-type-mapping`

**MongoDB**: Uses BSON type name `'bool'`.

**WhereFilterDefinition (JS + Postgres)**: Maps `'bool'` correctly.

**WhereFilterDefinition (SQLite)**: `json_type()` returns `'true'` or `'false'` for boolean values, not `'boolean'`. The SQLite engine maps these to match `$type: 'bool'`, but this mapping is an implementation detail that could produce edge-case divergences.

**Test**: `$type "bool": passes on boolean field`

---

## 6. (retired)

**Slug**: `size-on-spread-dotprop-paths`

`$size` on spread dot-prop paths once diverged on SQL. The leaf-scope fix made every engine evaluate `$size` against each individual leaf array, so this is no longer a divergence. The number is kept as a gap (see the note above) rather than reused.

---

## 7. NaN, Infinity, -Infinity in stored data become JSON null

**Slug**: `nan-infinity-stored-as-json-null`

**MongoDB**: BSON natively supports NaN, Infinity, and -Infinity as Doubles; they survive insert→query round-trips. `{age: {$gt: 1e308}}` matches Infinity; `{age: {$exists: true}}` matches NaN.

**WhereFilterDefinition (JS)**: NaN/Infinity preserved in-memory; conforms with MongoDB.

**WhereFilterDefinition (SQL — Postgres + SQLite)**: JSON spec (RFC 7159) excludes NaN and Infinity. `JSON.stringify(NaN)` returns `"null"`; same for `Infinity`/`-Infinity`. Consumer code that serializes via `JSON.stringify` before insert (the standard path) loses the distinction at the boundary, and the SQL impl cannot recover the original semantic.

**Specific impacts**:
- `{age: {$exists: true}}` on stored NaN/Infinity: returns `true` — matches MongoDB outcome by coincidence (JSON null is treated as present after the `$exists` fix).
- `{age: {$gt: 1e308}}` on stored Infinity: returns `false` — diverges from MongoDB (stored value is JSON null; `null > 1e308` is `NULL` in SQL).
- Filter-side `{$eq|$ne|$gt|$lt|$gte|$lte: NaN}`: matches MongoDB. The SQL builders short-circuit `NaN` filter values to constant SQL booleans (`1=0` / `1=1`) without binding `NaN` as a parameter.

**Rationale**: Conforming would require encoding NaN/Infinity as JSON sentinel objects (e.g. `{"$$nan":true}`, `{"$$inf":"+"}`) and wrapping every numeric SQL comparison in `CASE WHEN` to detect them. Cost: ~2–3× SQL text per numeric op + a breaking storage-format change (existing JSON-`null` data is ambiguous about whether it was originally null vs NaN/Infinity, and stays as null forever). NaN/Infinity in stored data are typically code smells; consumers should reject them at input via `z.number().finite()` rather than expecting the SQL impl to preserve them.

**Tests**: see "Numeric edge values (NaN, Infinity, -0)" sub-block in `standardTests.ts`.

---

## 8. Value-driven JS matcher vs schema-driven SQL emitter (non-conforming or shape-ambiguous data)

**Slug**: `value-driven-js-vs-schema-driven-sql`

**MongoDB**: Value-driven and duck-typing. A scalar equality `{ owner: 'a' }` also matches a document whose `owner` is the array `['a', 'b']` (array containment), and `$in` matches an array by intersection — the match depends on the runtime value, never a declared schema.

**WhereFilterDefinition (JS)**: `matchJavascriptObject` is value-driven too — it duck-types the runtime value and so conforms with MongoDB (an array under a scalar filter matches by containment).

**WhereFilterDefinition (SQL — Postgres + SQLite)**: The SQL emitter is **schema-driven** — it decides whether a field is a scalar (text-compare) or an array (spread via `jsonb_array_elements` / `json_each`) purely from the declared Zod schema, never the row. The JS and SQL results are therefore identical **only when the data conforms to a concrete schema** (scalar-data + scalar-schema, or array-data + array-schema). They diverge when:

- **Data does not conform** — e.g. a row `{ owner: ['a','b'] }` under a schema declaring `owner: z.string()`. JS matches `{ owner: 'a' }` by array containment; the scalar-bound SQL does not.
- **The schema is shape-ambiguous** — e.g. `owner: z.union([z.string(), z.array(z.string())])` (`scalar | array`). The emitter cannot decide whether to text-compare or spread, so `prepareWhereClause` returns `{ success: false, errors: [{ kind: 'schema_ambiguous', … }] }` rather than guessing (`findShapeAmbiguousPaths` detects it at translator construction).

**Resolution**: Pass `universalSchemaConformance: { schema }` to `matchJavascriptObject` to hold the JS matcher to the same lowest-common-denominator contract — it rejects a shape-ambiguous schema and validates the object against the schema first (throwing rather than duck-typing non-conforming data), so JS and SQL agree by construction. `objectValidatedAgainstSchema: true` skips the per-object check (perf bypass); the shape-ambiguity check always runs.

**Rationale**: A schema-driven engine (SQL, or any backend bound to declared columns) fundamentally cannot duck-type per row. A `scalar | array` field is also a genuine footgun — it silently turns a scalar equality into an array-containment match — so rejecting it (rather than picking an arm) is the safe lowest-common-denominator.

**Tests**: "10. Schema conformance (value-driven JS vs schema-driven SQL)" in `standardTests.ts`; `matchJavascriptObject.test.ts` "universalSchemaConformance …"; `prepareWhereClause.test.ts` "schema-driven rejection of shape-ambiguous schemas".

---

## 9. Operand domain is the portable (JSON) value subset (non-JSON carriers are rejected)

**Slug**: `non-json-operands-rejected`

**MongoDB / BSON**: BSON's operand and value domain is rich — `Date`, `BinData`, `ObjectId`, `Long`/`Decimal128`, regular expressions as first-class values, etc. `{ createdAt: { $gt: new Date('2020-01-01') } }` and a stored `{ tags: [new Date()] }` are all valid.

**WhereFilterDefinition**: every data and operand position — a bare scalar, an `$eq`/range/`$in` operand, an exact-array element, an `$all` element — accepts only the portable value subset: `string | number | boolean | null` and plain objects/arrays composed of those, plus non-finite numbers (`NaN`/`±Infinity`) as the one documented exception. A non-JSON carrier — `Date`, `bigint`, `Symbol`, `Map`, `Set`, or an explicit `undefined` element — is **rejected at the validity gate** (`isWhereFilterDefinition`): the JS matcher throws ("filter was not well-defined") and the SQL builders rethrow a not-well-defined error. Unlike the silent semantic divergences above, this subset gap **fails loudly**.

Related structural rejections at the same gate: an explicitly-`undefined` *operator* or *logic* value is malformed (`{ age: { $gt: undefined } }`, `{ $or: undefined }`, `{ name: { $regex: 'a', $options: undefined } }`), and an unknown operator riding a known one (`{ age: { $eq: 5, $mod: 3 } }`) is rejected rather than silently ignored. A bare `{ field: undefined }` field value stays valid (it matches nothing — see the Edge Cases table in `WhereFilterDefinition`).

**Rationale**: a filter must survive `JSON.stringify` → parse to a SQL backend losslessly and evaluate identically across JS, SQLite, and Postgres. BSON's richer types have no portable JSON representation, and silent coercion is a cross-engine divergence class in its own right — the JS matcher deep-equals a `Date` object, while SQL's `JSON.stringify` morphs it to an ISO string (and throws outright on a `bigint`). Rejecting the whole class at the gate keeps every engine uniform. Non-finite numbers are the one accepted exception — valid as operands (see #7) but lossy through SQL storage.

**Tests**: "25. Operator-payload strictness, operand domains & multi-operator AND" in `standardTests.ts`; the numeric/carrier rows in the §16/§19 sub-blocks.

---

## 10. A U+0000 (null byte) in stored data cannot round-trip through Postgres

**Slug**: `pg-null-byte-unstorable`

**MongoDB / BSON**: BSON strings are length-prefixed byte sequences, so an embedded U+0000 (`'a\u0000b'`) stores and queries like any other character.

**WhereFilterDefinition (JS + SQLite)**: bind and compare the null byte faithfully — JS holds it in memory; SQLite stores it in JSON TEXT and matches it. Both conform.

**WhereFilterDefinition (Postgres)**: Postgres `text`/`jsonb` cannot represent U+0000 — it rejects the `\u0000` JSON escape at insert time (`unsupported Unicode escape sequence`). A value carrying a null byte therefore cannot be stored, so a filter targeting it can never match. This is a hard platform restriction, not a builder choice.

**Rationale**: the same family as #7 — the storage boundary loses a value the in-memory matcher keeps. Postgres's inability to store U+0000 is a documented platform limit (`text` disallows the byte entirely) with no portable workaround short of a lossy re-encoding plus a breaking storage-format change. Consumers should reject U+0000 at input (cf. #7's `z.number().finite()` guidance for non-finite numbers), rather than expecting the Postgres impl to preserve it.

**Test**: `19.19 a null byte in the value binds and matches` — JS and SQLite assert strict `true`; Postgres is acknowledged against this entry (its store fails, so the value never matches).

---

## 11. A value-normalizing schema is refused by the schema-driven engines

**Slug**: `normalizing-schema-refused`

**MongoDB**: has no schema — it compares stored values as-is.

**WhereFilterDefinition**: a field whose declared Zod schema *normalizes* the value on parse — a `z.coerce.*` flag, or a `transform` / `pipe` / `preprocess` node — makes the value-driven JS matcher and the schema-driven SQL emitters read different values. The matcher compares the raw stored value with strict `===`, while the SQL emitter casts per the declared type: `z.coerce.number()` accepts a stored string `'1'` that a `::numeric` cast equates with `1`, but the matcher's `===` rejects it.

**Resolution**: `findNormalizingPaths` (exported) detects these paths. The SQL translators reject a normalizing path at construction — a typed refusal, never a silent mismatch — and `matchJavascriptObject` under `universalSchemaConformance` throws on one too, so a consumer opting into universal conformance is held to the same lowest-common-denominator boundary rather than getting engine-dependent results. `.refine()`, `.default()`, `.catch()` and other transparent wrappers are **not** normalizations — they validate or supply a fallback without rewriting a present, conforming value — and are descended through.

**Rationale**: a schema-driven backend cannot reproduce an arbitrary JS parse transform in SQL. This is the same value-driven-vs-schema-driven boundary as #8, one level deeper; refusing loudly keeps the engines uniform.

**Enforced by**: `findNormalizingPaths` (SQL translator construction; `matchJavascriptObject`'s `universalSchemaConformance` check).

---

## 12. An array inside a record value is a typed unsupported path

**Slug**: `record-value-array-unsupported`

**MongoDB**: resolves any path against the runtime value, regardless of declared shape.

**WhereFilterDefinition**: a path that crosses an array *inside* a `z.record(...)` value — e.g. `data.<key>.tags` where `data` is `Record<string, { tags: string[] }>` — cannot be emitted by the schema-driven SQL array-spreading builders, which key off schema-tree nodes that a dynamic record key does not have. Rather than crash or silently return no match, the builders return a typed unsupported-path error, surfaced to callers as a refusal to compile. Non-array leaves beneath a record resolve and compile normally.

**Rationale / status**: a design decision, not a permanent limitation — see `DECISIONS.md` #6 ("Record-value arrays are an acknowledged unsupported path"), which records the loud-refusal contract and the future work to lift it.

---

## 13. (retired)

**Slug**: `operator-on-array-compared-whole`

A comparison operator on an array field (`$eq`, `$ne`, ranges, `$regex`) once compared against the array value as a whole, so `{ tags: { $eq: 'a' } }` was `false` on `['a']`. It now reads element-wise, as MongoDB does, and this is no longer a divergence. The number is kept as a gap rather than reused.

The behaviour was not merely a conservative under-match, which is why it went: `$not` complements its operand, so an operator that could not reach an element made its own negation match everything — `{ tags: { $not: { $eq: 'a' } } }` returned `['a']`, a document the caller had excluded. Negating an under-match over-matches.

---

## 14. Escaped-dot path grammar diverges between the JS and SQL readers

**Slug**: `escaped-dot-path-grammar-split`

**MongoDB**: field names are opaque strings — there is no dot-escaping grammar to diverge.

**WhereFilterDefinition**: a dot-prop path escapes a literal dot in a key as `\.`, so `rows.a\.b` names the two keys `rows` and `a.b`. The SQL path reader (`parseDotPropPathSegments`) recognises only `\.`; the JS matcher's reader (the `dot-prop` package) additionally decodes `\\`→`\`, `\[` and `\]`. So a path using one of those extra escapes — e.g. `rows.a\\.b` — is read differently by the two engines, and a data key ENDING in a backslash cannot have its children named by any path, escaped or not (the trailing backslash fuses with the joining dot).

Both readers agree on the common `\.` case; they diverge only on the backslash/bracket escapes the JS reader adds.

The compile-time path unions (`DotPropPathsUnion` and family) render keys in the canonical
(`parseDotPropPathSegments`) grammar: a dotted key is offered as `a\.b`, which both readers decode
identically. But for a key that itself contains a backslash followed by a dot (e.g. the key `a\.b`,
four characters), the canonical spelling the types offer is `a\\.b` — which the SQL reader decodes back
to the key while the JS reader decodes `\\` first and reads two different keys. So the typed surface can
now hand the JS reader a spelling it misreads; the split is no longer confined to hand-written paths. A
key ENDING in a backslash is offered as a leaf only, since no spelling can address its children.

**Rationale / status**: the divergence is narrow and the affected keys are pathological (a key literally containing `\`, `[` or `]`). Unifying the two readers is deferred — see `DECISIONS.md` #10 ("The escaped-dot path grammar is not unified …") for what it would require. Pinned at `dot-prop-paths/dotPropPathSegments.test.ts` ("a key holding a backslash cannot be named by any path, escaped or not").

---

## 15. `$exists` and `$type` in a scalar `$elemMatch` body describe no element, so the body matches nothing

**Slug**: `exists-type-in-elemmatch-body`

**MongoDB**: `$elemMatch` reads its body element-wise, and every operator inside it — including `$exists` and `$type` — applies to each element. `{ tags: { $elemMatch: { $exists: true } } }` matches any non-empty array, and `{ tags: { $elemMatch: { $exists: true, $eq: 'a' } } }` matches `['a']`.

**WhereFilterDefinition**: `$exists` and `$type` are field-level operators with no per-element meaning, so a scalar `$elemMatch` body that mentions either is compared as a literal object against each element (a per-element deep-equal). No scalar element equals such an object, so the whole filter is **`false`**:
- `{ tags: { $elemMatch: { $exists: true } } }` is `false` on `['a']` (§18.30).
- `{ tags: { $elemMatch: { $type: 'string' } } }` is `false` on `['a']` (§18.31).
- Mixing one with a scalar predicate does not rescue it: `{ tags: { $elemMatch: { $exists: true, $eq: 'a' } } }` is `false` on `['a']` (§18.34), even though the `$eq: 'a'` alone would match.

This is the same field-vs-element split as divergence #1 (`$type` checks the field, not array elements), one level down inside `$elemMatch`. Both the JS matcher and the SQL emitters agree, so it is a uniform divergence, not a cross-engine gap. It is strictly conservative — it can only under-match relative to MongoDB, never match more.

**Rationale / status**: element-level `$exists`/`$type` is low value, and making it MongoDB-conformant is a further cross-engine behaviour change, not a documentation pass — see `DECISIONS.md` #11 ("`$exists`/`$type` in a scalar `$elemMatch` body are not made element-wise") for exactly what it would require.

**Tests**: §18.30, §18.31 (solo); §18.34 (mixed with `$eq`).

---

## 16. A positive condition on a nested-array path binds to a single leaf

**Slug**: `positive-condition-single-leaf`

**MongoDB**: a dotted path flattens across every array on it into one *candidate set*, and each operator in the field condition is applied to that set **independently**, the results conjoined at the document level. So different candidates may answer different operators: `{ 'groups.subtags': { $all: ['d', 'a'] } }` matches a row whose `'d'` and `'a'` sit in **different** `groups`, and `{ 'items.v': { $gt: 2, $lt: 3 } }` matches `items: [{v: 1}, {v: 5}]` — one element clears the lower bound, another the upper, and no single element clears both.

**WhereFilterDefinition**: the path reaches a *leaf* per array element, and a positive condition must be satisfied by **one** leaf in full. Both examples above are therefore `false` here. To ask MongoDB's question, name the operators separately — `{ $and: [{ 'items.v': { $gt: 2 } }, { 'items.v': { $lt: 3 } }] }` matches, because each arm is answered independently.

This is strictly **conservative**: it can only under-match, never return a row MongoDB would exclude. `∃leaf. (P ∧ Q)` implies `(∃leaf. P) ∧ (∃leaf. Q)`, so every row this package returns, MongoDB returns too.

A **negation is not folded this way**, and that exception is what keeps the divergence conservative. `$ne`, `$nin` and `$not` deny the *whole path* — no leaf may satisfy the condition they wrap — so `{ 'items.k': { $ne: 'b' } }` excludes a row where any element's `k` is `'b'`, exactly as MongoDB does. Folding a negation per leaf would let a clean leaf excuse an offending sibling and **over**-match, which is the one thing the conservatism argument cannot survive.

The same reading applies where a leaf is itself an array: `{ 'groups.tags': { $all: ['a', 'bx'] } }` requires one `tags` array to hold both. `$size` counts a single leaf array, and bare containment asks whether some leaf holds the value — both single-term, so nothing splits and both agree with MongoDB.

**Rationale**: leaf scope is the reading a caller writing `{ 'groups.tags': { $all: [...] } }` almost always means — "one group has all of these" — and pooling every leaf into a flat candidate set silently answers a different question. It is also the only reading the schema-driven SQL emitters can express without a second traversal per operator. The divergence is conservative, so it costs recall, never correctness.

### If you wish to match MongoDB's candidate-set semantics

Flatten the path to a candidate set (each array on the path contributes its elements; a leaf that is itself an array contributes both the array and its elements), then apply each operator to that set independently — positives as `∃candidate`, negations as `¬∃candidate` — and conjoin at the document level. Concretely: `matchPredicateOverLeaves` (`matchJavascriptObject.ts`) stops conjoining positives inside `leaves.some(...)` and instead maps each positive operator over the whole set; `emitTraverseArray` in both SQL translators emits one `EXISTS` per operator over a single shared spread, rather than one `EXISTS` around the whole conjunction; `slowLeafScopeEval` (`standard-tests/fuzz-internals.ts`), which is WF-P13's *independent* oracle, must be rewritten to the same law or it will contradict the engines.

Be clear about what it costs. It **widens** the result set, so it is a breaking change for any caller relying on the leaf reading. It retires divergence **#15** by the same stroke on a one-level array, since `$exists`/`$type` inside a scalar `$elemMatch` body are the same field-vs-element split. And it removes the only thing distinguishing `{ 'groups.tags': { $all: ['a', 'bx'] } }` from `{ $and: [{ 'groups.tags': 'a' }, { 'groups.tags': 'bx' }] }`, which a caller can already write today when that is what they mean.

**Tests**: §4 "a positive predicate on a nested-array path binds to a single leaf array (divergence #16)"; the negation laws in §4 "a value operator reaches a scalar leaf below an array"; `standard-tests/mongo-truth/corpus.ts`.

---

## Not divergences: conformance fixes

Some past behaviours that *did* differ from MongoDB have been fixed toward it, so they are **not** listed above as divergences: multiple operators in one payload are now conjunctive everywhere (including inside `$not` and a scalar `$elemMatch`); `$not` negates its operand on a missing field; a range comparison against a wrong-typed stored value returns `false` rather than throwing; a comparison operator on an array field reads element-wise (retiring #13); `$type: 'null'` requires the field to exist (retiring #4); and a negation on an array-descended path denies the whole path rather than one leaf. See the **Release notes** in `DECISIONS.md`.

Leaf scope itself is **not** in that list. It moved one engine's `$size` toward MongoDB (which is why #6 could retire), but for a multi-term condition it moves *away* — that is divergence #16 above, and it is a deliberate trade, not a fix.
