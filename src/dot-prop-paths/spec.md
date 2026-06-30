# Shape-ambiguity detector — decisions

The decisions behind `shape-ambiguity.ts` (`findShapeAmbiguousPaths`, `findMultiScalarUnionPaths`). One decision per heading: the verdict, why, and a worked example where the reasoning is subtle. Framework-agnostic — these are facts about Zod schemas and SQL representability, with no consumer concepts baked in.

### Why this detector exists

This library evaluates one query language two ways: a value-driven JS matcher that duck-types the runtime value, and a schema-driven SQL emitter that decides a field's storage shape purely from its Zod schema. They agree only when the schema is unambiguous. The detector finds the schemas where they cannot agree, so a caller demanding cross-backend parity can reject them up front instead of shipping a query that silently means different things in memory and in the database.

It reports two distinct hazards. `findShapeAmbiguousPaths` finds a path the SQL emitter cannot represent at all. `findMultiScalarUnionPaths` finds a path the emitter can represent only by comparing raw JSON rather than a typed column cast. They are reported separately because the consumer's response differs: reject vs. emit-as-JSON.

### The ambiguity is `array + non-array`, not "≥2 shapes"

A path is shape-ambiguous when its possible top-level shapes include **an array together with a non-array** (a scalar or an object). It is **not** flagged merely for spanning two shapes — specifically, `scalar | object` (with no array) is representable and passes.

Why the asymmetry. The only irreversible decision the SQL emitter makes from shape alone is **spread-vs-cast**: an array field must be *spread* (unnested / containment-tested), a non-array field must be *cast* and compared by value. A path that can be either forces the emitter to commit to one, and the commitment is wrong for the other arm — a silent divergence from the value-driven matcher, which simply inspects each value at runtime. `scalar | object` involves no spread decision: neither arm is an array, so the emitter never has to choose between unnesting and casting. It is never *silently* wrong — it either agrees with the matcher or fails loudly at query time (e.g. comparing a JSON object to a scalar raises a database error rather than quietly returning the wrong rows). A loud failure is acceptable; a silent one is not. So we flag `array + scalar` and `array + object`, but not `scalar + object` — array-coexistence, not the symmetric object-coexistence.

`scalar | object` is also legitimately in use. An array element declared `union([string, number, object{…}])` is exactly a `scalar | object` shape, and it is exercised by many passing SQL tests. The rejected "≥2 of {scalar, array, object}" rule would have failed it. The behavioural SQL guards (`prepareWhereClauseForPg`/`Sqlite` tests, "scalar|object is never silently wrong") stand as the executable proof of this decision: they assert the emitter agrees with the matcher or fails loudly for `scalar | object`, in both arm orders and both dialects.

### A path's shape is judged across all its alternatives at once

The shapes reaching a path are gathered from every alternative that can land there — every union arm, **and the same field across sibling object arms** — before the rule is applied. Judging a union node locally (each arm in isolation) was the defining bug across earlier rounds.

Worked example. In `union([ object{ v: string }, object{ v: array(string) } ])`, both arms are objects, so a node-local check sees only "object" and descends each arm separately, seeing `v` as a string under one arm and an array under the other but never together. Gathering the alternatives that reach path `v` — `string` from the first arm, `array(string)` from the second — surfaces the `array + scalar` collision and flags `v`. The same gathering reaches the multi-scalar detector: `union([ object{ a: string }, object{ a: number } ])` reports `a` as a nested multi-scalar path.

### An array container and its element are classified separately

A path that holds an array is one call; the array's nameless element is a separate call at the same path. They are never merged into one shape-set.

Why. If a container and its element shared a shape-set, every `array(scalar)` would look like `array + scalar` and be flagged — a false positive on the most common field there is. Keeping them separate means a plain `array(string)` is `{array}` at the path and `{scalar}` at the element, neither a collision. A genuine collision still surfaces: when two arms are both arrays, their elements are gathered together (e.g. `array(string) | array(object)` yields a `scalar + object` element set), and when the arms are an array and a non-array, the collision is at the container path itself.

Gathering every array arm's element together has one further consequence worth naming: `array(string) | array(number)` is not a shape-ambiguity (no path is both array and non-array), but its shared element path *is* multi-scalar — a `string[]` and a `number[]` whose elements must be compared as raw JSON rather than through one element-column cast. So `findMultiScalarUnionPaths` reports it. This is the parity-correct outcome: a value-driven array-containment match against such a field would otherwise diverge from a single-typed cast.

### Shape classification of each Zod kind

Each kind contributes one category to the shape-set: string / number / boolean / enum / non-null literal → **scalar**; array / **tuple** → **array**; object / record / **discriminated union** → **object**; null / undefined / void / null-literal → **null**; everything else (lazy, bigint, date, custom) → **other** (opaque, contributes nothing).

Tuple and discriminated union are the deliberate ones. A tuple *is* an array for representability, and a discriminated union *is* an object; classifying them as opaque "other" silently hid real collisions — a `tuple | object` field, or a `discriminatedUnion | array` field, would have passed. They are classified by category but their **contents are not descended**: a bare tuple or discriminated union is a single category and is therefore not over-flagged, and the rule still fires only when one of them coexists with a conflicting shape. A non-null literal classifies by its runtime value (`literal("x")` is scalar, `literal(5)` is scalar), which is why the next decision treats a null literal specially.

### `null` is not a shape category

Null, undefined, void, and a null-valued literal contribute nothing to the array/scalar/object decision.

Why. `array | null`, `scalar | null`, and `object | null` are all representable: a nullable field has one concrete shape plus absence, and the emitter handles absence uniformly. Treating null as a fourth shape would wrongly flag every nullable array as ambiguous. So `literal(null) | array(string)` is the supported nullable-array (passes), while `literal("x") | array(string)` is a real `scalar + array` collision (flagged) — the literal's value, not its kind, decides.

### Multi-scalar is a separate, weaker hazard

A path whose shapes are ≥2 distinct scalar kinds with no array and no object (e.g. `string | number`, or `boolean | number | string | null`) is reported by `findMultiScalarUnionPaths`, not as a shape-ambiguity.

Why separate. This path *is* representable — but only as raw JSON, not a single typed column cast. A first-arm cast (say `::boolean`) would loosely coerce the other scalars and cast-error on arbitrary strings, diverging from the matcher's strict `===`. So the emitter must compare it as a JSON value. A single scalar kind plus null (`boolean | null`) keeps its faithful typed cast and is excluded. The two detectors are mutually exclusive: a shape-ambiguous path is filtered out of the multi-scalar results, because it is rejected before emission is even attempted.

### Framework-agnostic

The detector names only schema and SQL-representability concepts — scalar, array, object, spread, cast, JSON. It carries no notion of who is asking or why. Any consumer needing JS↔SQL parity reuses it as-is; none of their vocabulary leaks in.

### Known limitations

- **Record values and tuple/discriminated-union contents are not descended.** A `record(string, union([string, array]))`, or a tuple position that is itself ambiguous, is not inspected — the container is classified, its interior is opaque. This matches the SQL emitter, which does not address dynamic record keys or fixed tuple slots by dot-prop path.
- **`scalar | object` is caught at query time, not construction time.** By decision it is not flagged, so a consumer relying on the detector to pre-reject everything unrepresentable will instead see a loud database error if a non-conforming row is queried. That is the accepted trade for not rejecting a legitimately-used shape.
- **`lazy` is opaque.** A `lazy(() => …)` schema contributes "other" and is not unwrapped, avoiding unbounded recursion on self-referential schemas; an ambiguity reachable only through a lazy boundary is not detected.
