# SQLite WhereClauseBuilder — Implementation Plan

## SQLite JSON Syntax Reference

### Extraction
- `json_extract(col, '$.path.to.field')` — returns SQL-typed values (TEXT for strings, INTEGER/REAL for numbers, NULL for null/missing). Single function call replaces Pg's `->` / `->>` chain.
- `->>` operator (3.38+) — also extracts SQL-typed values. `json_extract` is preferred for path expressions.
- For objects/arrays, `json_extract` returns JSON text (like Pg's `->` keeping JSONB).

### Array Spreading
- `json_each(col, '$.path')` — table-valued function, returns virtual table with columns: `key`, `value`, `type`, `atom`, etc.
- Replaces Pg's `jsonb_array_elements()`.
- `value` column contains the SQL-typed value (scalar) or JSON text (object/array).
- Chaining: `json_each(je1.value, '$.nested')` — works because `je1.value` is valid JSON text.

### Key Differences from Postgres

| Feature | Postgres | SQLite |
|---|---|---|
| Path accessor | `(col->'a'->>'b')::text` | `json_extract(col, '$.a.b')` |
| Type cast | `::text`, `::numeric`, `::jsonb` | Not needed — `json_extract` returns native SQL types |
| Array spread | `jsonb_array_elements(col->'arr')` | `json_each(col, '$.arr')` |
| Spread output | Alias is usable as JSONB column | Must use `alias.value` to access element |
| Array contains scalar | `col ? $1` (JSONB `?` operator) | `EXISTS (SELECT 1 FROM json_each(col, '$.path') WHERE value = ?)` |
| Object/array equality | `col = $N::jsonb` | `json_extract(col, '$.path') = json(?)` |
| Params | `$1`, `$2` (positional numbered) | `?` (positional anonymous) |
| NULL for missing path | SQL NULL | SQL NULL |
| String comparison | Byte order (via `::text`) | Byte order (native TEXT comparison) — same semantics |

### Placeholder Approach
SQLite uses `?` positional parameters. The arguments array works identically (push values in order), but the placeholder string is always `?` instead of `$N`.

### Object/Array Equality
`json()` normalises JSON text (minifies whitespace). Both sides produce the same representation when key order matches, which holds because `JSON.stringify` preserves insertion order and both stored data and filter go through it.

```sql
json_extract(col, '$.contact') = json(?)
-- where ? = '{"name":"Andy","age":100}'
```

### Nested Array Spreading Example

For path `children.grandchildren.name` (two array crossings):
```sql
json_each(recordColumn, '$.children') AS je1
CROSS JOIN json_each(je1.value, '$.grandchildren') AS je2
-- Then: json_extract(je2.value, '$.name') for field access
```

---

## Architecture

### Shared Engine Extraction

The recursive engine `_postgresWhereClauseBuilder` is dialect-agnostic — it handles AND/OR/NOT logic and delegates leaf SQL to `IPropertyMap.generateSql`. Extract it so both Pg and SQLite share it.

**New file: `whereClauseEngine.ts`**
Moves from `postgresWhereClauseBuilder.ts`:
- `IPropertyMap<T>` interface
- `PreparedWhereClauseStatement`, `PreparedStatementArgument`, `isPreparedStatementArgument` types
- `_whereClauseBuilder()` (renamed from `_postgresWhereClauseBuilder`) — the recursive engine

`postgresWhereClauseBuilder.ts` re-imports and re-exports these (backwards-compatible, no public API change).

### New Files

1. **`convertDotPropPathToSqliteJsonPath.ts`** — dot-prop → `json_extract(col, '$.path')` with ZodKind validation
2. **`sqliteWhereClauseBuilder.ts`** — entry point + `SqliteBasePropertyMap` (implements `IPropertyMap`)
3. **`sqliteWhereClauseBuilder.test.ts`** — test harness using `better-sqlite3`, runs `standardTests`

### Reused (no changes)
- `types.ts`, `consts.ts`, `typeguards.ts`, `schemas.ts` — all filter types and guards
- `dot-prop-paths/zod.ts` — `TreeNodeMap`, `convertSchemaToDotPropPathTree`
- `standardTests.ts` — shared test suite

---

## Implementation Details

### `convertDotPropPathToSqliteJsonPath(columnName, dotPropPath, nodeMap, errorIfNotAsExpected?)`

Converts a dot-prop path to a SQLite JSON extraction expression.

```
convertDotPropPathToSqliteJsonPath('data', 'contact.name', nodeMap)
→ "json_extract(data, '$.contact.name')"

convertDotPropPathToSqliteJsonPath('data', 'contact.locations', nodeMap)
→ "json_extract(data, '$.contact.locations')"
```

Rules:
- Validates path exists in `TreeNodeMap` (rejects unknown paths — SQL injection prevention)
- Validates `errorIfNotAsExpected` ZodKind if provided (e.g. `contains` must be ZodString)
- No explicit CAST needed — `json_extract` returns native SQL types
- For `ZodObject`/`ZodArray` comparison, caller wraps with `json(...)` at comparison site

### `SqliteBasePropertyMap` (implements `IPropertyMap`)

Mirrors `BasePropertyMap` structure but with SQLite-specific SQL generation.

#### `generatePlaceholder(value, statementArguments)`
- Pushes value to args array, returns `'?'` (not `$N`)
- Objects/arrays: `JSON.stringify` first (same as Pg)

#### `generateComparison(dotpropPath, filter, statementArguments, customSqlIdentifier?, testArrayContainsString?)`

| Filter type | SQLite SQL |
|---|---|
| `contains` | `json_extract(col, '$.path') LIKE ?` (with `%value%`) |
| Range ops | `json_extract(col, '$.path') > ?`, etc. |
| Scalar | `json_extract(col, '$.path') = ?` |
| Plain object | `json(json_extract(col, '$.path')) = json(?)` |
| Array literal | `json(json_extract(col, '$.path')) = json(?)` |
| `undefined` | `json_extract(col, '$.path') IS NULL` |
| Array contains string | `EXISTS (SELECT 1 FROM json_each(col, '$.path') WHERE value = ?)` |

Optional/nullable paths: same pattern `(expr IS NOT NULL AND <comparison>)`.

#### `generateSql(dotpropPath, filter, statementArguments)`

Two branches (same as Pg):

**No arrays in path** → `generateComparison` directly.

**Arrays in path** → `spreadJsonArraysSqlite` + EXISTS wrapping:
- **Array literal comparison** (countArraysInPath===1) → direct `generateComparison`
- **elem_match with WhereFilterDefinition** → recurse with sub-PropertyMap scoped to element schema, column = spread `output_column` (`je1.value`)
- **elem_match with scalar string** → `EXISTS (SELECT 1 FROM json_each(col, '$.path') WHERE value = ?)`
- **elem_match with scalar number** → spread + comparison against `output_identifier`
- **Compound filter** (plain object keys on array) → `COUNT(DISTINCT CASE WHEN...)` per key (same pattern as Pg)
- **Scalar on array** → comparison against spread `output_identifier`

#### `spreadJsonArraysSqlite(column, nodesDesc)`

Builds FROM clause using `json_each()` instead of `jsonb_array_elements()`.

```typescript
// Input: column='recordColumn', path through two arrays (children → grandchildren)
// Output:
{
    sql: "json_each(recordColumn, '$.children') AS je1 CROSS JOIN json_each(je1.value, '$.grandchildren') AS je2",
    output_column: "je2.value",     // used as column name for sub-PropertyMap recursion
    output_identifier: "je2.value"  // used for scalar comparison (no #>> needed)
}
```

Algorithm: Walk nodes, accumulate path segments. On each ZodArray node, emit a `json_each(currentSource, '$.accumulated.path')` clause, then reset `currentSource` to `alias.value` and clear accumulated path.

### `sqliteWhereClauseBuilder(filter, propertyMap)`

Entry point. Same signature as `postgresWhereClauseBuilder`:
```typescript
function sqliteWhereClauseBuilder<T>(
    filter: WhereFilterDefinition<T>,
    propertyMap: IPropertyMap<T>
): PreparedWhereClauseStatement
```

- Validates filter via `isWhereFilterDefinition`
- Delegates to shared `_whereClauseBuilder`
- Returns `{whereClauseStatement, statementArguments}`

### `SqlitePropertyMapSchema` / `SqlitePropertyMap`

Same pattern as Pg:
- `SqlitePropertyMapSchema<T>` — takes Zod schema, calls `convertSchemaToDotPropPathTree`
- `SqlitePropertyMap<T>` — takes pre-built `TreeNodeMap`

---

## Test Setup

### Dependencies
Add `better-sqlite3` + `@types/better-sqlite3` as devDependencies.

### `sqliteWhereClauseBuilder.test.ts`

```typescript
import Database from 'better-sqlite3';

// Each test:
// 1. Create in-memory DB + table with TEXT column for JSON
// 2. INSERT the test object as JSON.stringify
// 3. Build WHERE clause via sqliteWhereClauseBuilder
// 4. SELECT with WHERE clause + bound params
// 5. Return rows.length > 0

const matchJavascriptObjectInDb: MatchJavascriptObjectInTesting = async (object, filter, schema) => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test_table (pk INTEGER PRIMARY KEY, recordColumn TEXT NOT NULL)');
    db.prepare('INSERT INTO test_table (recordColumn) VALUES (?)').run(JSON.stringify(object));

    const pm = new SqlitePropertyMapSchema(schema, 'recordColumn');
    let clause;
    try {
        clause = sqliteWhereClauseBuilder(filter, pm);
    } catch(e) {
        // Handle 'unsupported' → undefined, UNSAFE_WARNING → false
    }

    const query = clause.whereClauseStatement
        ? `SELECT * FROM test_table WHERE ${clause.whereClauseStatement}`
        : `SELECT * FROM test_table`;
    const rows = db.prepare(query).all(...clause.statementArguments);
    db.close();
    return rows.length > 0;
};

standardTests({ test, expect, matchJavascriptObject: matchJavascriptObjectInDb });
```

---

## Phases

_Check off as completed. Stop after each phase to ask whether to continue._

### [x] Phase 3a — Extract shared engine

- Create `whereClauseEngine.ts` with the dialect-agnostic recursive engine and shared types
- Update `postgresWhereClauseBuilder.ts` to import from the engine (no public API change)
- Verify existing Pg tests still pass

**Files created/modified:**
- NEW: `src/where-filter/whereClauseEngine.ts`
- MOD: `src/where-filter/postgresWhereClauseBuilder.ts`

### [x] Phase 3b — SQLite JSON path converter

- Implement `convertDotPropPathToSqliteJsonPath`
- Unit test: verify path output for scalar, nested, object, array paths

**Files created:**
- NEW: `src/where-filter/convertDotPropPathToSqliteJsonPath.ts`

### [x] Phase 3c — SQLite property map + builder

- Implement `SqliteBasePropertyMap`, `SqlitePropertyMapSchema`, `SqlitePropertyMap`
- Implement `spreadJsonArraysSqlite`
- Implement `sqliteWhereClauseBuilder` entry point

**Files created:**
- NEW: `src/where-filter/sqliteWhereClauseBuilder.ts`

### [x] Phase 3d — Test harness + pass all standardTests

- Add `better-sqlite3` devDependency
- Create test file with in-memory SQLite, run `standardTests`
- Debug until all tests pass

**Files created/modified:**
- NEW: `src/where-filter/sqliteWhereClauseBuilder.test.ts`
- MOD: `package.json` (devDependency)

### [x] Phase 3e — Exports + cleanup

- Add `sqliteWhereClauseBuilder` exports to `src/where-filter/index.ts`
- Add JSDoc to all new exports
- Verify build passes
