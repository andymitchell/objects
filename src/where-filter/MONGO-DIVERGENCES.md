# WhereFilterDefinition: intentional divergences from MongoDB

WhereFilterDefinition is a **subset** of MongoDB's query language. Every valid filter is also valid MongoDB syntax — with the exceptions listed below, where our semantics intentionally differ from MongoDB's.

These are not missing features (subset gaps). These are cases where the same syntax produces **different results** compared to MongoDB.

---

## 1. `$type` checks the field, not array elements

**MongoDB**: When a field is an array, `{ field: { $type: 'string' } }` returns `true` if *any element* is a string.

**WhereFilterDefinition**: `$type` checks the field's own runtime type. An array field has type `'array'`, not the type of its elements. Use `{ field: { $type: 'array' } }` to match arrays.

**Rationale**: SQL implementations (`jsonb_typeof` / `json_type`) check the column's type, not element types. Iterating elements for `$type` would require a different SQL pattern and is not needed for current use cases.

**Test**: `$type "string" on array of strings: fails (checks field type, not element types)`

---

## 2. `$all` with empty array matches everything

**MongoDB**: `{ field: { $all: [] } }` either throws an error or returns no matches.

**WhereFilterDefinition**: Returns `true` (JavaScript `Array.every([])` evaluates to `true`).

**Rationale**: Consistent with JavaScript semantics. This is a degenerate edge case unlikely to appear in practice.

**Test**: `$all with empty list: passes (every on empty = true)`

---

## 3. `$regex` case-sensitivity on SQLite

**MongoDB**: `$regex` is case-sensitive by default. Use `{ $options: 'i' }` for case-insensitive.

**WhereFilterDefinition (JS + Postgres)**: Same as MongoDB — case-sensitive by default.

**WhereFilterDefinition (SQLite)**: `$regex` is translated to `LIKE`, which is case-**insensitive** for ASCII characters in SQLite. Non-ASCII characters are case-sensitive. This means `{ $regex: 'andy' }` will match `'Andy'` on SQLite but not on JS/Postgres/MongoDB.

**Rationale**: SQLite lacks native regex support. LIKE is the best-effort translation. Full regex would require loading an extension.

**Test**: `$regex case-sensitive default: fails`

---

## 4. `$type 'null'` on missing fields

**MongoDB**: `{ field: { $type: 'null' } }` matches documents where the field is explicitly `null`, and also matches missing fields (since MongoDB treats missing as equivalent to null for `$type: 'null'`).

**WhereFilterDefinition (JS)**: Missing optional fields are `undefined`, which our implementation treats the same as `null` for `$type: 'null'` — so the JS engine matches, consistent with MongoDB.

**WhereFilterDefinition (SQL)**: A missing JSON path returns SQL `NULL` from `jsonb_typeof` / `json_type`, which is not the string `'null'`. SQL implementations may return `false` for missing fields with `{ $type: 'null' }`.

**Rationale**: SQL `NULL` semantics differ fundamentally from JSON null. There is no efficient portable SQL workaround.

**Test**: `$type "null" on missing optional field`

---

## 5. `$type 'bool'` on SQLite

**MongoDB**: Uses BSON type name `'bool'`.

**WhereFilterDefinition (JS + Postgres)**: Maps `'bool'` correctly.

**WhereFilterDefinition (SQLite)**: `json_type()` returns `'true'` or `'false'` for boolean values, not `'boolean'`. The SQLite engine maps these to match `$type: 'bool'`, but this mapping is an implementation detail that could produce edge-case divergences.

**Test**: `$type "bool": passes on boolean field`

---

## 6. `$size` on spread dot-prop paths (SQL)

**MongoDB**: `$size` checks the length of the array at the resolved path.

**WhereFilterDefinition (JS)**: When a dot-prop path crosses through multiple arrays (spreading), the JS engine correctly evaluates `$size` against each leaf array.

**WhereFilterDefinition (SQL)**: SQL implementations use `CROSS JOIN` / `json_each` for array spreading, which may flatten intermediate arrays. `$size` might evaluate against the flattened result rather than individual leaf arrays.

**Rationale**: Correctly composing `$size` with array spreading in SQL is complex. This is documented as a known divergence.

**Test**: `$size on spread dot-prop path: passes when leaf array matches`

---

## 7. NaN, Infinity, -Infinity in stored data become JSON null

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

**MongoDB**: Value-driven and duck-typing. A scalar equality `{ owner: 'a' }` also matches a document whose `owner` is the array `['a', 'b']` (array containment), and `$in` matches an array by intersection — the match depends on the runtime value, never a declared schema.

**WhereFilterDefinition (JS)**: `matchJavascriptObject` is value-driven too — it duck-types the runtime value and so conforms with MongoDB (an array under a scalar filter matches by containment).

**WhereFilterDefinition (SQL — Postgres + SQLite)**: The SQL emitter is **schema-driven** — it decides whether a field is a scalar (text-compare) or an array (spread via `jsonb_array_elements` / `json_each`) purely from the declared Zod schema, never the row. The JS and SQL results are therefore identical **only when the data conforms to a concrete schema** (scalar-data + scalar-schema, or array-data + array-schema). They diverge when:

- **Data does not conform** — e.g. a row `{ owner: ['a','b'] }` under a schema declaring `owner: z.string()`. JS matches `{ owner: 'a' }` by array containment; the scalar-bound SQL does not.
- **The schema is shape-ambiguous** — e.g. `owner: z.union([z.string(), z.array(z.string())])` (`scalar | array`). The emitter cannot decide whether to text-compare or spread, so `prepareWhereClause` returns `{ success: false, errors: [{ kind: 'schema_ambiguous', … }] }` rather than guessing (`findShapeAmbiguousPaths` detects it at translator construction).

**Resolution**: Pass `universalSchemaConformance: { schema }` to `matchJavascriptObject` to hold the JS matcher to the same lowest-common-denominator contract — it rejects a shape-ambiguous schema and validates the object against the schema first (throwing rather than duck-typing non-conforming data), so JS and SQL agree by construction. `objectValidatedAgainstSchema: true` skips the per-object check (perf bypass); the shape-ambiguity check always runs.

**Rationale**: A schema-driven engine (SQL, or any backend bound to declared columns) fundamentally cannot duck-type per row. A `scalar | array` field is also a genuine footgun — it silently turns a scalar equality into an array-containment match — so rejecting it (rather than picking an arm) is the safe lowest-common-denominator.

**Tests**: "10. Schema conformance (value-driven JS vs schema-driven SQL)" in `standardTests.ts`; `matchJavascriptObject.test.ts` "universalSchemaConformance …"; `prepareWhereClause.test.ts` "schema-driven rejection of shape-ambiguous schemas".
