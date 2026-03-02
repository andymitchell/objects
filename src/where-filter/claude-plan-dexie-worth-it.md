# Status: REJECTED

Not worth pursuing. Dexie's performance gains depend on predefined indexes declared in the schema — unlike Pg/sqlite where `json_extract`/`jsonb` can query any path at runtime. Most WhereFilterDefinition features (`contains`, `$elemMatch`, NOT, array spreading, deep nesting, object equality) have no index-backed Dexie equivalent and would fall back to a full scan. The narrow subset that could hit indexes (simple equality/range on pre-indexed top-level fields) doesn't justify maintaining a third query dialect with its own query planner. IndexedDB datasets are also orders of magnitude smaller than server-side tables, reducing the motivation. Baseline `getAll()` + `matchJavascriptObject` is simple, correct, and sufficient.

# Goal

To assess if it's worth giving Dexie (IndexedDb) it's own specialised implementation of a WhereFilterDefinition for greater performance, similar to how we convert it to a Pg/sqlite WHERE string to optimise there (basically by avoiding having to read every object in and analyse it one by one). 

# Relevant Files

@types.ts
@schemas.ts
@standardTests.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts
@postgresWhereClauseBuilder.ts
@sqliteWhereClauseBuilder.ts
@whereClauseEngine.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts).

It's inspired by MongoDb. 

We have converters to optimise how it can be used to query a JSON column in a Postgres/sqlite table that give considerable performance improvements. 

I'm skeptical that it'll have the same advantage for IndexedDb (compared to the baseline of getAll followed by `matchJavascriptObject`); but I know Dexie has some performance gains over IndexedDb, and perhaps that would work. 

It must be traded off against any maintenance burden issues though. 

# Understanding Dexie's performance gain in querying over vanilla IndexedDb

## IndexedDB Native Querying Capabilities

IndexedDB has very limited native querying. The only filtering mechanism is **IDBKeyRange** on indexed properties:

- `IDBKeyRange.only(value)` — exact match
- `IDBKeyRange.lowerBound(value)` / `upperBound(value)` — open-ended range
- `IDBKeyRange.bound(lower, upper)` — closed range

**What IndexedDB cannot do natively:**
- No AND/OR/NOT boolean logic
- No `contains` / substring matching
- No regex or pattern matching
- No nested property querying (must be a declared index)
- No querying into array elements
- Indexes only work on string, number, Date, or Array<string|number|Date> — not booleans, null, undefined, or objects

For anything beyond a single-field range/equality on an indexed property, the standard approach is `getAll()` followed by JS-side filtering — which is exactly what `matchJavascriptObject` does. **Confirmed: `getAll()` + `matchJavascriptObject` is the most efficient standard approach for running a WhereFilterDefinition on IndexedDB.**

An alternative (cursor iteration with manual filtering) avoids materialising all objects but is generally slower than `getAll()` due to per-record IPC overhead.

## Dexie's Query Enhancements Over Vanilla IndexedDB

Dexie adds a richer query API on top of IndexedDB's limited primitives:

### WhereClause methods (all index-backed)
`equals()`, `above()`, `aboveOrEqual()`, `below()`, `belowOrEqual()`, `between()`, `anyOf()`, `anyOfIgnoreCase()`, `startsWith()`, `startsWithAnyOf()`, `startsWithAnyOfIgnoreCase()`, `noneOf()`, `notEqual()`, `inAnyRange()`

### Compound indexes
Schema: `'[field1+field2]'` — enables multi-criteria queries that hit a single B-tree. Only the **last** field in a compound index can use a range; all preceding fields must be equality.

### MultiEntry indexes
Schema: `'*arrayField'` — indexes each primitive element of an array individually. Enables `where('tags').equals('foo')` to match any record whose `tags` array contains `'foo'`. Only works for arrays of primitives (string/number/Date), **not** arrays of objects.

### OR queries
`table.where('field').equals('a').or('field').equals('b')` — Dexie runs multiple indexed queries and merges results.

### Collection.filter()
Post-query JS filtering. Equivalent in performance to `getAll()` + manual filter — it's a convenience wrapper, not an optimisation.

### Nested dot-notation
Dexie can index simple nested paths like `'data.name'`, but only for top-level → one-level nesting. It **cannot** index into arrays of objects or deeply nested structures.

## Gap Analysis: WhereFilterDefinition vs Dexie's Capabilities

| WhereFilterDefinition Feature | Dexie Index Support | Notes |
|-------------------------------|---------------------|-------|
| Equality on top-level field | YES | `where('field').equals(val)` |
| Range (`gt`/`gte`/`lt`/`lte`) on single field | YES | `above()`, `below()`, `between()` |
| Range on multiple fields simultaneously | PARTIAL | Compound index, but range only on last field |
| `contains` (substring) | NO | No index-backed substring search |
| AND across arbitrary properties | PARTIAL | Requires predefined compound index |
| OR logic | YES | Dexie merges multiple indexed queries |
| NOT logic | NO | No index-backed negation |
| Dot-prop nested paths (e.g. `'contact.name'`) | PARTIAL | Simple nesting OK if pre-indexed; no array spreading |
| Array element matching (scalar in array) | PARTIAL | MultiEntry index, but only for primitive arrays |
| `$elemMatch` (atomic multi-criteria on array element) | NO | No index-backed equivalent |
| Array spreading across nested arrays | NO | Fundamental limitation of B-tree indexes |
| Deep object equality | NO | Objects not indexable |

## Key Problem: Schema Must Be Known Ahead of Time

The Pg/sqlite converters work because SQL's `json_extract` / `jsonb` operators can query **any** path at runtime — no predefined indexes required. Dexie's performance gains come entirely from **predefined indexes declared in the schema**. A generic converter would need to:

1. Know which Dexie indexes exist at query time
2. Map WhereFilterDefinition operators to the subset that can hit those indexes
3. Fall back to `filter()` (= full scan) for everything else

This makes a generic "WhereFilterDefinition → Dexie query" converter fundamentally different from the SQL converters, which can handle arbitrary paths.

## Assessment

**The performance gain from a Dexie converter would be narrow and situational:**

- Only benefits queries on pre-indexed, top-level (or one-level nested) fields
- Only for equality, range, anyOf, or primitive array membership
- `contains`, `$elemMatch`, NOT, deep nesting, array spreading, and object equality all fall back to full-scan `filter()`
- Most real-world WhereFilterDefinition queries use combinations of these features

**Maintenance burden would be significant:**
- A third query dialect to maintain alongside Postgres and SQLite
- Unlike SQL where the engine handles optimisation, a Dexie converter must also handle query planning (which parts hit indexes, which fall back to filter)
- Index schema awareness adds coupling between the converter and the Dexie DB setup

**Verdict: The juice is probably not worth the squeeze.** The sweet spot for Dexie performance is when you design your schema and queries together. A generic converter from WhereFilterDefinition adds complexity for marginal gains on a narrow subset of queries. The baseline `getAll()` + `matchJavascriptObject` is simple, correct, and performant enough for typical IndexedDB dataset sizes (which are orders of magnitude smaller than server-side Pg/sqlite tables).

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Verify that to run a WhereFilterDefinition query on IndexedDb, the most efficient standard thing to do is getAll() and our own `matchJavascriptObject`. Look at IndexedDb docs to see the standard practice for querying. 

Analyse the Dexie docs to understand how it does more efficient querying. 

Output the results of both studies into `Understanding Dexie's performance gain in querying over vanilla IndexedDb`. 

# [ ] Phase 2

If there are potential performance gains to a converter, write a plan to convert a WhereFilterDefinition into something Dexie can use to efficiently query a collection. 

Add this plan to the document as Phase 3 and halt - I will check it. 
