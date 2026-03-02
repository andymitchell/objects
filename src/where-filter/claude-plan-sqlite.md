# Goal

Convert a Where Clause from one syntax into a direct SQLite WHERE clause that operates over a single JSON column in a table.

# Relevant Files

@types.ts
@standardTests.ts
@consts.ts
@typeguards.ts
@postgresWhereClauseBuilder.ts
@convertDotPropPathToPostgresJsonPath.ts
@matchJavascriptObject.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts).

It can be turned into a declarative SQL WHERE clause that runs on a single JSON column in a table (currently only Postgres).

It is proven to work in @standardTests.ts, which is used by `postgresWhereClauseBuilder.test.ts to build a table and run the tests.

The documentation for postgresWhereClauseBuilder is currently underspecified.

# How It Works

## Overview

`WhereFilterDefinition` → `IPropertyMap.generateSql()` → parameterised Postgres WHERE clause.

A `WhereFilterDefinition<T>` is a serialisable JSON query (loosely MongoDB-inspired) that can be evaluated against JS objects (`matchJavascriptObject`) or compiled into SQL. The Postgres pipeline converts it into a WHERE clause operating over a single JSONB column.

## Key Data Structures

### WhereFilterDefinition (types.ts)

Two forms (union):

1. **PartialObjectFilter** — keys are dot-prop paths, values are value comparisons:
   - Scalar equality: `{ 'name': 'Andy' }` → `= $1`
   - Range ops (`gt`, `lt`, `gte`, `lte`): `{ 'age': { gte: 18 } }` → `>= $1`
   - Contains (substring): `{ 'name': { contains: 'And' } }` → `LIKE $1`
   - Deep object/array equality: `= $1::jsonb`
   - Array element matching: `elem_match`, compound filters, scalar indexOf
2. **LogicFilter** — keys are `AND`/`OR`/`NOT`, values are arrays of sub-`WhereFilterDefinition`.

Multiple keys on one filter object are implicitly AND'd (rewritten as `{AND: [{k1:v1}, {k2:v2}]}`).

### TreeNodeMap (dot-prop-paths/zod.ts)

`convertSchemaToDotPropPathTree(zodSchema)` recursively walks a Zod schema and produces:
- A tree of `TreeNode` objects (with parent/children links)
- A flat `TreeNodeMap`: `Record<dotPropPath, TreeNode>`

Each `TreeNode` holds: `name`, `dotprop_path`, `kind` (ZodKind: ZodString, ZodNumber, ZodArray, etc.), `schema` (sub-schema for arrays/objects), `descended_from_array`, `optional_or_nullable`.

This map is critical for:
- **Type-correct SQL casting** — knowing the ZodKind at each path determines the Pg cast (`::text`, `::numeric`, `::boolean`, `::jsonb`)
- **Array detection** — knowing which paths cross through arrays, triggering `jsonb_array_elements` spreading
- **Optional/nullable guards** — wrapping comparisons in `IS NOT NULL AND ...`
- **Security** — rejecting unknown paths (prevents SQL injection via crafted dot-prop paths)

## Pipeline

### 1. Entry: `postgresWhereClauseBuilder(filter, propertyMap)`

Validates the filter via `isWhereFilterDefinition` (Zod parse), creates an empty `statementArguments[]`, delegates to the recursive `_postgresWhereClauseBuilder`. Returns `{whereClauseStatement, statementArguments}`.

### 2. Recursive engine: `_postgresWhereClauseBuilder(filter, args, propertyMap)`

- **0 keys** → `''` (match all)
- **>1 keys** → rewrite as `{AND: [{k1:v1}, {k2:v2}, ...]}`
- **LogicFilter** → recurse each sub-filter, join:
  - `AND` → `(sub1 AND sub2)`, empty → `1 = 1`
  - `OR` → `(sub1 OR sub2)`, empty → `1 = 0`
  - `NOT` → `NOT (sub1 OR sub2)`
- **Single key (PartialObjectFilter)** → `propertyMap.generateSql(dotPropPath, filterValue, args)`

### 3. Dialect layer: `BasePropertyMap.generateSql(dotPropPath, filter, args)`

Two major branches based on whether the path crosses arrays:

**No arrays** → `generateComparison(dotPropPath, filter, args)` directly.

**Arrays in path** → uses `spreadJsonbArrays` to build a FROM clause, then wraps in EXISTS:
- **Array literal comparison** → `col = $N::jsonb`
- **elem_match with WhereFilterDefinition** → recurse with a new `PropertyMapSchema` scoped to the array element's sub-schema; wraps in `EXISTS (SELECT 1 FROM spread WHERE subClause)`
- **elem_match with scalar string** → uses Pg `?` operator (jsonb contains key)
- **Compound filter** (plain object keys on array) → splits keys, each tested independently using `COUNT(DISTINCT CASE WHEN ... THEN 1 END)` per key; only satisfied if all keys appear ≥1 time. This mirrors the JS behaviour where different array elements can satisfy different keys.
- **Scalar on array** → comparison against spread output identifier

### 4. Leaf SQL: `BasePropertyMap.generateComparison()`

Generates the final SQL fragment for a single comparison:

| Filter type | SQL output |
|---|---|
| `contains` | `col LIKE $N` (with `%value%`) |
| Range ops | `col > $N`, `col >= $N`, etc. (AND'd if multiple) |
| Scalar | `col = $N` |
| Plain object | `col = $N::jsonb` |
| Array | `col = $N::jsonb` |
| `undefined` | `col IS NULL` |

If the TreeNode is `optional_or_nullable`, wraps as `(col IS NOT NULL AND <comparison>)`.

### 5. JSONB path accessor: `convertDotPropPathToPostgresJsonPath(col, path, nodeMap)`

Converts a dot-prop path into a Postgres JSONB accessor with type casting.

Example: `convertDotPropPathToPostgresJsonPath('data', 'contact.name', nodeMap)`
→ `(data->'contact'->>'name')::text`

Rules:
- Intermediate segments use `->` (returns JSONB)
- Final segment uses `->>` for scalars (returns text) or `->` for ZodArray/ZodObject (keeps JSONB)
- Appends a cast: `::text`, `::numeric`, `::boolean`, `::bigint`, `::jsonb`
- Validates path exists in TreeNodeMap; rejects unknown paths

### 6. Array spreading: `spreadJsonbArrays(column, treeNodePath)`

When a dot-prop path crosses through arrays, each array layer is expanded using `jsonb_array_elements()`.

Example for path `children.grandchildren.name` (two array crossings):
```sql
jsonb_array_elements(recordColumn->'contact'->'children') AS recordColumn1
CROSS JOIN jsonb_array_elements(recordColumn1->'family'->'grandchildren') AS recordColumn2
```

Returns `{sql, output_column, output_identifier}`:
- `sql` — the full FROM clause with CROSS JOINs
- `output_column` — final alias (e.g. `recordColumn2`)
- `output_identifier` — `recordColumn2 #>> '{}'` (extracts scalar text from JSONB)

### 7. Parameterised arguments

All user-provided values go into `statementArguments[]` as `string | number | boolean | null`. SQL references them as `$1`, `$2`, etc. Objects/arrays are `JSON.stringify`'d first. This prevents SQL injection and works with standard ORMs (pg, Drizzle, etc.).

### 8. PropertyMap variants

- `PropertyMapSchema<T>` — takes a Zod schema, calls `convertSchemaToDotPropPathTree` internally
- `PropertyMap<T>` — takes a pre-built `TreeNodeMap` directly

Both extend `BasePropertyMap` which holds the core `generateSql`/`generateComparison` logic.

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1



Analyse @postgresWhereClauseBuilder.ts and @convertDotPropPathToPostgresJsonPath.ts (and zod.ts with types like TreeNodeMap), and build up a mental model of how it currently works. You'll also need to look at `WhereFilterDefinition` in @types.ts

Hint: it needs a dialect-specific (e.g. Pg) IPropertyMap to know how to express the `WhereFilterDefinition` as criteria for a JSONB column in Pg. convertDotPropPathToPostgresJsonPath does something similar but for nesting to a type-cast deep value. 
It uses statement arguments that fit most ORMs (e.g Drizzle). 

Write your analyse to this file under `How It Works`.



# [x] Phase 2

Added concise JSDoc to:

- **postgresWhereClauseBuilder.ts** — `postgresWhereClauseBuilder` (entry point), `IPropertyMap` (dialect abstraction), `BasePropertyMap` (Pg JSONB impl), `countArraysInPath`, `getSqlIdentifier`, `generatePlaceholder`, `generateSql`, `generateComparison`, `PropertyMapSchema`, `PropertyMap`, `_postgresWhereClauseBuilder` (recursive engine), `spreadJsonbArrays`, `isPreparedStatementArgument`
- **convertDotPropPathToPostgresJsonPath.ts** — `convertDotPropPathToPostgresJsonPath` (with examples)
- **dot-prop-paths/zod.ts** — `ZodKind`, `TreeNode`, `TreeNodeMap`, `convertSchemaToDotPropPathKind`, `convertSchemaToDotPropPathTree` (with example), `getZodKindAtSchemaDotPropPath`, `getZodSchemaAtSchemaDotPropPath`

# [x] Phase 3

Created implementation plan: @claude-plan-sqlite-impl.md

Covers:
- SQLite JSON syntax reference (json_extract, json_each, placeholder style, key differences from Pg)
- Architecture: extract shared dialect-agnostic recursive engine to `whereClauseEngine.ts`, new `SqliteBasePropertyMap` implementing `IPropertyMap`, new `convertDotPropPathToSqliteJsonPath`, new `spreadJsonArraysSqlite`
- Test harness using `better-sqlite3` in-memory DB, running all `standardTests`
- 5 sub-phases: 3a (extract engine), 3b (JSON path converter), 3c (property map + builder), 3d (tests), 3e (exports) 