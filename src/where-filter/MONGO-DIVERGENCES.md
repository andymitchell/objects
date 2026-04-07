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
