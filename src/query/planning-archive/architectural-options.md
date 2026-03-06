# Architectural Options

## Context & Constraints

The where-filter module today outputs **one thing**: a WHERE clause (string + parameters). It's completely composable -- the consumer decides what SELECT, FROM, JOIN, etc. to wrap around it. We want the same composability for sort/limit/cursor.

The pieces a query needs in SQL:
1. **WHERE** (filtering) -- already solved by `WhereFilterDefinition` builders
2. **WHERE** (cursor `$after_pk`) -- new; must compose with #1
3. **ORDER BY** -- new; standalone
4. **LIMIT** -- new; standalone (trivial)
5. **OFFSET** -- new; standalone (trivial)

The tension: #1 and #2 are both WHERE clauses that must be **ANDed together**, but they come from different sources (filter definition vs. pagination definition). How do we let the consumer combine them?

The CTE approach for `$after_pk` needs to know table name and primary key (or the JSON Column for the object's ID):
**Subquery/CTE:** `WHERE (sort_cols) > (SELECT sort_cols FROM t WHERE pk = ?)`

## Shared Type Assumptions

```ts
// The query definition type (all fields optional)
type SortDefinition<T> = Array<{ key: DotPropPaths<T>; direction: 1 | -1 }>;

type PaginationDefinition =
  | { $offset: number; $limit?: number }
  | { $after_pk: string; $limit?: number };

type QueryDefinition<T> = {
  $filter?: WhereFilterDefinition<T>;
  $sort?: SortDefinition<T>;
  $pagination?: PaginationDefinition;
};
```

For JS runtime, all approaches are equivalent -- it's always `filter -> sort -> offset/cursor -> limit` as array operations. The differences only matter for SQL output.

---

## Option A: Independent Clause Builders (Primitives Only)

Each builder returns its own clause fragment. The consumer composes them manually.

### API Surface

```ts
// New builders (one per dialect, like where-filter)
function buildOrderByClause<T>(sort: SortDefinition<T>, propertyMap: IPropertyMap<T>)
  : { order_by_clause: string }  // e.g. "data->>'date' DESC, data->>'id' ASC"

function buildLimitClause(limit: number)
  : { limit_clause: string; parameters: PreparedStatementArgument[] }
  // e.g. { limit_clause: "$1", parameters: [20] }

function buildOffsetClause(offset: number)
  : { offset_clause: string; parameters: PreparedStatementArgument[] }

function buildAfterPkWhereClause<T>(
  afterPk: string,
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>,
  tableName: string,
  pkColumn: string
): { where_clause: string; parameters: PreparedStatementArgument[] }
  // e.g. { where_clause: "(data->>'date' < (SELECT ...)  OR ...)", parameters: ['abc-123'] }
```

### Consumer Usage (Postgres)

```ts
// Consumer manually composes everything
const filterResult = postgresWhereClauseBuilder(query.$filter, propertyMap);
const orderBy = buildOrderByClause(query.$sort, propertyMap);

let whereParts: string[] = [];
let params: PreparedStatementArgument[] = [];

if (filterResult.success) {
  whereParts.push(filterResult.where_clause_statement);
  params = filterResult.statement_arguments;
}

if (query.$pagination && '$after_pk' in query.$pagination) {
  const cursor = buildAfterPkWhereClause(
    query.$pagination.$after_pk, query.$sort, propertyMap, 'my_table', "data->>'id'"
  );
  // Must rebase parameters manually
  const rebased = appendSqlParameters(params, {
    sql: cursor.where_clause,
    parameters: cursor.parameters
  });
  whereParts.push(rebased.sql);
  params = rebased.complete_parameters;
}

const sql = `SELECT * FROM my_table
  ${whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : ''}
  ${orderBy.order_by_clause ? 'ORDER BY ' + orderBy.order_by_clause : ''}
  ${limitClause ? 'LIMIT ' + limitClause : ''}`;
```

### Consumer Usage (Drizzle)

```ts
import { sql } from 'drizzle-orm';

const filterResult = postgresWhereClauseBuilder(query.$filter, propertyMap);
const orderBy = buildOrderByClause(query.$sort, propertyMap);
const cursor = buildAfterPkWhereClause(...);

// Drizzle's sql`` template can embed raw SQL fragments
const rows = await db.execute(sql`
  SELECT * FROM my_table
  WHERE ${sql.raw(filterWhere)} AND ${sql.raw(cursorWhere)}
  ORDER BY ${sql.raw(orderBy.order_by_clause)}
  LIMIT ${limit}
`);
// Or with Drizzle's .where():
const rows = await db.select().from(myTable)
  .where(sql.raw(`${filterWhere} AND ${cursorWhere}`))
  .orderBy(sql.raw(orderBy.order_by_clause))
  .limit(limit);
```

### Pros
- **Maximum composability.** Each piece is independent -- consumer can use ORDER BY without LIMIT, or WHERE without ORDER BY, etc.
- **Matches where-filter's philosophy.** Just like `postgresWhereClauseBuilder` returns a WHERE clause fragment, these return ORDER BY / LIMIT / WHERE fragments.
- **Works with any query structure.** Consumer can use these in JOINs, subqueries, CTEs, Drizzle, raw SQL, etc.
- **Easy to understand.** Each function does one thing.

### Cons
- **Consumer must manually combine WHERE clauses.** The `$after_pk` WHERE and the filter WHERE must be ANDed together with correct parameter rebasing. This is error-prone boilerplate that every consumer must write.
- **Parameter management burden.** Consumer must track parameter numbering across filter + cursor. The `rebaseSqlParameters` / `appendSqlParameters` / `concatSqlParameters` utilities help, but it's still manual.
- **No single "do the right thing" function.** For the common case (ICollection.get), every implementation must write the same composition logic.

---

## Option B: Query Clause Bundle (Structured Output)

A single function returns all SQL clause fragments as a structured object, with parameter numbering already resolved internally. The consumer places each fragment in the right position.

### API Surface

```ts
type SqlQueryClauses = {
  /** WHERE clause combining filter + cursor conditions. No 'WHERE' keyword. */
  where: { clause: string; parameters: PreparedStatementArgument[] } | null;
  /** ORDER BY clause. No 'ORDER BY' keyword. */
  order_by: string | null;
  /** LIMIT value. No 'LIMIT' keyword. */
  limit: { clause: string; parameters: PreparedStatementArgument[] } | null;
  /** OFFSET value. No 'OFFSET' keyword. */
  offset: { clause: string; parameters: PreparedStatementArgument[] } | null;
};

// Postgres version
function postgresQueryClauseBuilder<T>(
  query: QueryDefinition<T>,
  propertyMap: IPropertyMap<T>,
  /** Needed for $after_pk subquery */
  tableContext: { table_name: string; pk_column: string }
): SqlQueryClauses;

// SQLite version
function sqliteQueryClauseBuilder<T>(
  query: QueryDefinition<T>,
  propertyMap: IPropertyMap<T>,
  tableContext: { table_name: string; pk_column: string }
): SqlQueryClauses;
```

### Consumer Usage (Postgres)

```ts
const clauses = postgresQueryClauseBuilder(query, propertyMap, {
  table_name: 'my_table',
  pk_column: "data->>'id'"
});

// Consumer just places fragments -- no parameter management
const sql = `SELECT * FROM my_table
  ${clauses.where ? 'WHERE ' + clauses.where.clause : ''}
  ${clauses.order_by ? 'ORDER BY ' + clauses.order_by : ''}
  ${clauses.limit ? 'LIMIT ' + clauses.limit.clause : ''}
  ${clauses.offset ? 'OFFSET ' + clauses.offset.clause : ''}`;
const params = [
  ...(clauses.where?.parameters ?? []),
  ...(clauses.limit?.parameters ?? []),
  ...(clauses.offset?.parameters ?? []),
];
```

### Consumer Usage (Drizzle)

```ts
const clauses = postgresQueryClauseBuilder(query, propertyMap, { ... });

const rows = await db.select().from(myTable)
  .where(clauses.where ? sql.raw(clauses.where.clause) : undefined)
  .orderBy(clauses.order_by ? sql.raw(clauses.order_by) : undefined)
  .limit(clauses.limit ? query.$pagination?.$limit : undefined);
// Or raw:
const rows = await db.execute(sql`
  SELECT * FROM my_table
  ${clauses.where ? sql`WHERE ${sql.raw(clauses.where.clause)}` : sql``}
  ${clauses.order_by ? sql`ORDER BY ${sql.raw(clauses.order_by)}` : sql``}
  ${clauses.limit ? sql`LIMIT ${clauses.limit.clause}` : sql``}
`);
```

### Pros
- **WHERE composition is handled internally.** Filter WHERE + cursor WHERE are ANDed with correct parameter numbering inside the function. Consumer never touches `rebaseSqlParameters`.
- **Still composable at the clause level.** Consumer gets independent fragments and places them -- not locked into a full SELECT statement.
- **Single function call.** Common case is simple.
- **Parameters are pre-resolved.** No manual numbering.

### Cons
- **Slightly less granular.** If a consumer only wants ORDER BY (no filter, no cursor), they still call the full function. Though with all fields optional in QueryDefinition, this is fine -- unused clauses return `null`.
- **Table context required upfront.** The `$after_pk` subquery needs `table_name` and `pk_column`. If no `$after_pk` is used, these are ignored but still required in the type. Could be made optional with a union type.
- **Parameter ordering is implicit.** Consumer must concatenate parameters in the right order (where, limit, offset). A `all_parameters` convenience field could solve this.

---

## Option C: Full Query String Builder

A single function returns the complete SQL query string (SELECT ... WHERE ... ORDER BY ... LIMIT ...).

### API Surface

```ts
function postgresQueryBuilder<T>(
  query: QueryDefinition<T>,
  propertyMap: IPropertyMap<T>,
  tableContext: {
    table_name: string;
    pk_column: string;
    select_columns?: string;  // default '*'
  }
): { sql: string; parameters: PreparedStatementArgument[] };
```

### Consumer Usage

```ts
const result = postgresQueryBuilder(query, propertyMap, {
  table_name: 'my_table',
  pk_column: "data->>'id'"
});
const rows = await pg.query(result.sql, result.parameters);
```

### Pros
- **Simplest consumer code.** One call, one result.
- **No composition errors possible.** The function handles everything.

### Cons
- **Not composable.** Consumer cannot use these fragments in a JOIN, a subquery, or a non-SELECT context (e.g. DELETE ... WHERE ... ORDER BY ... LIMIT). This is a **dealbreaker** for the stated design goal.
- **Doesn't work with Drizzle.** Drizzle builds queries programmatically -- a pre-built SELECT string doesn't compose with Drizzle's API.
- **Violates where-filter's philosophy.** The where-filter module never generates a full query -- it returns a WHERE fragment. Going full-query here would be inconsistent.
- **Inflexible.** Every new use case (different SELECT columns, CTEs, RETURNING clauses) requires new parameters or a new function.

**Verdict: Rejected.** Inconsistent with the codebase's composable philosophy. Listed for completeness.

---

## Option D: Hybrid -- Bundle + Exposed Primitives (Recommended)

Provide both the individual clause builders (Option A) as the core API, **and** a convenience bundle function (Option B) that composes them. The bundle is a thin wrapper -- consumers who need custom composition can use the primitives directly.

### API Surface

```ts
// === Primitives (always available) ===

function postgresSortClauseBuilder<T>(
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>
): string;
// Returns e.g. "data->>'date' DESC, data->>'id' ASC"

function postgresAfterPkClauseBuilder<T>(
  afterPk: string,
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>,
  tableContext: { table_name: string; pk_column: string }
): { clause: string; parameters: PreparedStatementArgument[] };
// Returns WHERE fragment for cursor, self-contained parameters starting at $1

// (limit/offset are trivial -- just "$N" with one parameter -- but exposed for consistency)


// === Bundle (convenience wrapper) ===

type SqlQueryClauses = {
  where: { clause: string; parameters: PreparedStatementArgument[] } | null;
  order_by: string | null;
  limit: { clause: string; parameters: PreparedStatementArgument[] } | null;
  offset: { clause: string; parameters: PreparedStatementArgument[] } | null;
  /** All parameters in correct order, ready for the query executor. */
  all_parameters: PreparedStatementArgument[];
};

function postgresQueryClauseBuilder<T>(
  filter: WhereFilterDefinition<T> | undefined,
  query: { $sort?: SortDefinition<T>; $pagination?: PaginationDefinition },
  propertyMap: IPropertyMap<T>,
  tableContext: { table_name: string; pk_column: string }
): SqlQueryClauses;
```

Note: `$filter` (WhereFilterDefinition) is passed **separately** from sort/pagination. This reflects their conceptual separation: the filter is a predicate on individual objects, while sort/pagination are collection-level operations. The bundle function accepts both and composes their WHERE clauses.

### Consumer Usage -- Simple (ICollection.get)

```ts
const clauses = postgresQueryClauseBuilder(
  query.$filter,
  { $sort: query.$sort, $pagination: query.$pagination },
  propertyMap,
  { table_name: 'items', pk_column: "data->>'id'" }
);

const sql = `SELECT * FROM items
  ${clauses.where ? 'WHERE ' + clauses.where.clause : ''}
  ${clauses.order_by ? 'ORDER BY ' + clauses.order_by : ''}
  ${clauses.limit ? 'LIMIT ' + clauses.limit.clause : ''}
  ${clauses.offset ? 'OFFSET ' + clauses.offset.clause : ''}`;
const rows = await pg.query(sql, clauses.all_parameters);
```

### Consumer Usage -- Custom Composition (extra WHERE conditions)

```ts
// Consumer has their own WHERE conditions (e.g. row-level security)
const filterResult = postgresWhereClauseBuilder(query.$filter, propertyMap);
const sortClause = postgresSortClauseBuilder(query.$sort, propertyMap);

let whereFragments = [];
let params: PreparedStatementArgument[] = [];

if (filterResult.success) {
  whereFragments.push({ sql: filterResult.where_clause_statement,
                         parameters: filterResult.statement_arguments });
}

// Add a custom security WHERE
whereFragments.push({ sql: "data->>'owner_id' = $1", parameters: [currentUserId] });

// Add cursor WHERE if needed
if (query.$pagination && '$after_pk' in query.$pagination) {
  const cursorClause = postgresAfterPkClauseBuilder(
    query.$pagination.$after_pk, query.$sort, propertyMap,
    { table_name: 'items', pk_column: "data->>'id'" }
  );
  whereFragments.push({ sql: cursorClause.clause, parameters: cursorClause.parameters });
}

// Combine all WHERE fragments with concatSqlParameters
const combined = concatSqlParameters(whereFragments, ' AND ');

const sql = `SELECT * FROM items
  WHERE ${combined.sql}
  ORDER BY ${sortClause}
  LIMIT $${combined.parameters.length + 1}`;
```

### Consumer Usage -- Drizzle

```ts
// Option 1: Use bundle, embed as raw SQL
const clauses = postgresQueryClauseBuilder(filter, { $sort, $pagination }, pm, ctx);
const rows = await db.select().from(items)
  .where(clauses.where ? sql.raw(clauses.where.clause) : undefined)
  .orderBy(clauses.order_by ? sql.raw(clauses.order_by) : undefined)
  .limit($pagination?.$limit);

// Option 2: Use primitives for more control
const sortSql = postgresSortClauseBuilder($sort, pm);
const filterResult = postgresWhereClauseBuilder($filter, pm);
// ... compose with Drizzle's sql`` template
```

### Pros
- **Best of both worlds.** Simple path for common case, primitives for custom composition.
- **Consistent with where-filter's pattern.** Primitives mirror `postgresWhereClauseBuilder` / `sqliteWhereClauseBuilder`. Bundle is a new convenience layer.
- **`all_parameters` eliminates the parameter-ordering footgun** from Option B.
- **Filter stays separate.** WhereFilterDefinition is still its own module; the bundle accepts it but doesn't own it.
- **Drizzle-friendly.** Clause fragments can be embedded into Drizzle's `sql` builder.

### Cons
- **Larger API surface.** More exports. But the primitives are simple and have clear single-responsibility.
- **Table context still required for bundle.** Same as Option B -- can be optional when `$after_pk` is absent.

---

## Comparison Table

| Criterion | A (Primitives) | B (Bundle) | C (Full Query) | D (Hybrid) |
|---|---|---|---|---|
| Composability | Best | Good | Poor | Best |
| Simple common case | Manual | Good | Best | Good |
| WHERE composition | Manual | Internal | Internal | Both |
| Parameter safety | Manual | Good | Best | Best (all_parameters) |
| Drizzle compat | Good | Good | Poor | Good |
| Consistency with where-filter | Best | Good | Poor | Best |
| API surface size | Small | Small | Small | Medium |


## [x] Task: Add Option E

---

## Option E: Dual-Mode Builders with Internal Primitives (Recommended)

Takes the best of each option: Option A's primitives become **internal** helpers. The public API is two builder functions — one for tables storing JSON objects (our primary use case), one for traditional relational tables — each accepting WHERE clauses as composable inputs. A flattening helper covers the happy path.

Dialect (`'pg' | 'sqlite'`) is a runtime parameter, not a function-name prefix.

### Design Principles

1. **Option A primitives are internal.** Consumers never import `buildOrderByClause` or `buildAfterPkWhereClause` directly.
2. **WHERE composition is the builder's job.** Filter WHERE, cursor WHERE, and any custom WHERE clauses are all collected internally and combined via `concatSqlParameters`. The consumer never rebases parameters.
3. **Two table modes.** `WhereFilterDefinition` operates exclusively on JSON columns. But ordering/pagination should work for both JSON-column tables and traditional relational tables. Two functions, two `TableInfo` variants.
4. **Table name is a function parameter, not baked into types.** `TableInfo` is a plain argument object.
5. **Filter accepts both raw and high-level forms.** Pass a `WhereFilterDefinition<T>` (converted internally via the appropriate dialect's where-clause builder) or a pre-built `PreparedWhereClauseStatement`. Either works.
6. **Dialect is a parameter.** `'pg' | 'sqlite'` as first argument — no duplicated function names per dialect.

### Revised Types

```ts
type SqlDialect = 'pg' | 'sqlite';

type SortDefinition<T> = Array<{ key: DotPropPaths<T>; direction: 1 | -1 }>;

type PrimaryKeyValue = string | number;

/**
 * Optional sorting and slicing of a collection.
 * All fields optional — omit entirely for unordered full results.
 */
type SortAndSlice<T> = {
  /** Sort keys. Falls back to DDL's default_order_by when omitted. */
  sort?: SortDefinition<T>;
  /** Max items to return. */
  limit?: number;
  /** Skip this many items (offset-based pagination). */
  offset?: number;
  /** Return items after this primary key value (cursor-based pagination). */
  after_pk?: PrimaryKeyValue;
};
```

Existing system types used as-is:

```ts
type PreparedStatementArgument = string | number | boolean | null;
type PreparedWhereClauseStatement = {
  whereClauseStatement: string;
  statementArguments: PreparedStatementArgument[];
};
```

### Result Types

```ts
/** Canonical type — full prepared query output (WHERE + ORDER BY + LIMIT + OFFSET). */
type PreparedQueryStatement = {
  /** Combined WHERE clause (filter + cursor + additional). No 'WHERE' keyword. */
  where_statement: PreparedWhereClauseStatement | null;
  /** ORDER BY clause. No 'ORDER BY' keyword. */
  order_by_statement: string | null;
  /** LIMIT clause. No 'LIMIT' keyword. */
  limit_statement: PreparedWhereClauseStatement | null;
  /** OFFSET clause. No 'OFFSET' keyword. */
  offset_statement: PreparedWhereClauseStatement | null;
};

/** Alias — nicer DX when working with prepareTableSortAndSlice (where "query" overpromises). */
type PreparedSortAndSliceStatement = PreparedQueryStatement;

type QueryError = { type: string; message: string };

type PreparedQueryResult =
  | ({ success: true } & PreparedQueryStatement)
  | { success: false; errors: QueryError[] };

/** Alias — pairs with prepareTableSortAndSlice. */
type PreparedSortAndSliceResult = PreparedQueryResult;
```

### Table Info Variants

```ts
/** Base — only needed when after_pk is used (for the CTE subquery). */
type TableInfo = {
  tableName: string;
};

/** JSON-column table: objects stored as JSON in a single column. */
type TableInfoJsonObject<T extends Record<string, any>> = TableInfo & {
  objectColumnName: string;
  ddl: DDL<T>;         // Provides primary_key for after_pk resolution
  schema: z.ZodSchema<T>; // Needed to convert WhereFilterDefinition → PreparedWhereClauseStatement
};

/** Traditional relational table: columns map directly to fields. */
type TableInfoRelational = TableInfo & {
  pkColumnName: string; // Column name of the primary key
};
```

### Public API — Prepare Functions

```ts
/**
 * Prepare SQL clauses for a table storing JSON objects.
 *
 * Accepts filter as WhereFilterDefinition (converted internally) or
 * pre-built PreparedWhereClauseStatement. Cursor (after_pk), filter,
 * and additionalWhereClauses are all ANDed together internally.
 */
function prepareObjectsTableQuery<T extends Record<string, any>>(
  dialect: SqlDialect,
  table: TableInfoJsonObject<T>,
  filter?: WhereFilterDefinition<T> | PreparedWhereClauseStatement,
  sortAndSlice?: SortAndSlice<T>,
  additionalWhereClauses?: PreparedWhereClauseStatement[]
): PreparedQueryResult;

/**
 * Prepare SQL clauses for a traditional relational table.
 *
 * Sort keys map to column names directly (no JSON path extraction).
 */
function prepareTableSortAndSlice<T extends Record<string, any>>(
  dialect: SqlDialect,
  table: TableInfoRelational,
  sortAndSlice: SortAndSlice<T>,
  whereClauses?: PreparedWhereClauseStatement[]
): PreparedSortAndSliceResult;
```

### Public API — Flattening Helper

```ts
type FlattenedQuerySql = {
  /** "WHERE x = $1 ORDER BY y DESC LIMIT $2 OFFSET $3" */
  sql: string;
  /** All parameters in correct positional order. */
  parameters: PreparedStatementArgument[];
};

/**
 * Flatten a successful PreparedQueryStatement into a single SQL
 * fragment + parameter array. Useful for the common case of appending
 * to a "SELECT * FROM table" string.
 */
function flattenPreparedQueryStatementToSql(
  result: PreparedQueryStatement
): FlattenedQuerySql;
```

### Internal Implementation (Option A Primitives)

Internally, each builder delegates to the same primitives from Option A. These are **not exported**:

```ts
// internal: generates "data->>'date' DESC, data->>'id' ASC"
function _buildOrderByClause<T>(
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>
): string;

// internal: generates WHERE fragment for cursor pagination
function _buildAfterPkWhereClause<T>(
  afterPk: PrimaryKeyValue,
  sort: SortDefinition<T>,
  propertyMap: IPropertyMap<T>,
  tableName: string,
  pkExpression: string  // e.g. "data->>'id'" or "id"
): PreparedWhereClauseStatement;

// internal: generates "$N" or "?" with parameter depending on dialect
function _buildLimitClause(limit: number, paramOffset: number): PreparedWhereClauseStatement;
function _buildOffsetClause(offset: number, paramOffset: number): PreparedWhereClauseStatement;
```

The public builders compose these internally:

```ts
// Simplified pseudocode for prepareObjectsTableQuery
function prepareObjectsTableQuery<T>(dialect, table, filter, sortAndSlice, additionalWhereClauses) {
  const whereParts: PreparedWhereClauseStatement[] = [];

  // 1. Convert filter → PreparedWhereClauseStatement
  if (filter) {
    if (isWhereFilterDefinition(filter)) {
      const whereBuilder = dialect === 'pg' ? postgresWhereClauseBuilder : sqliteWhereClauseBuilder;
      const result = whereBuilder(filter, table.schema, table.objectColumnName);
      if (!result.success) return { success: false, errors: [...] };
      whereParts.push({ whereClauseStatement: result.where_clause_statement,
                         statementArguments: result.statement_arguments });
    } else {
      whereParts.push(filter); // already a PreparedWhereClauseStatement
    }
  }

  // 2. Build cursor WHERE (if after_pk present)
  if (sortAndSlice?.after_pk !== undefined) {
    const pkExpression = `${table.objectColumnName}->>'${table.ddl.lists['.'].primary_key}'`;
    const cursorWhere = _buildAfterPkWhereClause(
      sortAndSlice.after_pk, sortAndSlice.sort ?? defaultSort,
      propertyMap, table.tableName, pkExpression
    );
    whereParts.push(cursorWhere);
  }

  // 3. Append additional WHERE clauses
  if (additionalWhereClauses) whereParts.push(...additionalWhereClauses);

  // 4. Combine all WHERE parts with concatSqlParameters
  const combinedWhere = whereParts.length
    ? concatSqlParameters(whereParts.map(p => ({ sql: p.whereClauseStatement, parameters: p.statementArguments })), ' AND ')
    : null;

  // 5. Build ORDER BY, LIMIT, OFFSET
  const orderBy = sortAndSlice?.sort ? _buildOrderByClause(sortAndSlice.sort, propertyMap) : null;
  const limit = sortAndSlice?.limit !== undefined ? _buildLimitClause(sortAndSlice.limit, paramOffset) : null;
  const offset = sortAndSlice?.offset !== undefined ? _buildOffsetClause(sortAndSlice.offset, paramOffset) : null;

  return {
    success: true,
    where_statement: combinedWhere ? { whereClauseStatement: combinedWhere.sql,
                                        statementArguments: combinedWhere.parameters } : null,
    order_by_statement: orderBy,
    limit_statement: limit,
    offset_statement: offset,
  };
}
```

### Consumer Usage — ICollection.get (JSON Column)

The primary use case. A store's `.get()` method needs filter + ordering in one call:

```ts
class PostgresJsonCollection<T> implements ICollection<T> {
  async get(
    filter?: WhereFilterDefinition<T>,
    sortAndSlice?: SortAndSlice<T>
  ): Promise<T[]> {
    const result = prepareObjectsTableQuery(
      'pg',
      {
        tableName: this.tableName,
        objectColumnName: 'data',
        ddl: this.ddl,
        schema: this.schema,
      },
      filter,
      sortAndSlice
    );
    if (!result.success) throw new QueryError(result.errors);

    // Flatten for simple raw SQL
    const { sql: clausesSql, parameters } = flattenPreparedQueryStatementToSql(result);
    const rows = await this.pg.query(
      `SELECT data FROM ${this.tableName} ${clausesSql}`,
      parameters
    );
    return rows.map(r => r.data);
  }
}

// Usage:
await collection.get(
  { name: { $eq: 'Smith' } },
  { sort: [{ key: 'age', direction: 1 }], limit: 20 }
);

// Paginated:
await collection.get(
  { status: { $eq: 'active' } },
  { sort: [{ key: 'created_at', direction: -1 }], limit: 20, after_pk: 'last-seen-uuid' }
);
```

### Consumer Usage — Custom WHERE Clauses (Row-Level Security)

```ts
async getForUser(
  userId: string,
  filter?: WhereFilterDefinition<T>,
  sortAndSlice?: SortAndSlice<T>
): Promise<T[]> {
  const result = prepareObjectsTableQuery(
    'pg',
    { tableName: 'items', objectColumnName: 'data', ddl: this.ddl, schema: this.schema },
    filter,
    sortAndSlice,
    [{ whereClauseStatement: "owner_id = $1", statementArguments: [userId] }]
  );
  if (!result.success) throw new QueryError(result.errors);

  const { sql, parameters } = flattenPreparedQueryStatementToSql(result);
  return this.pg.query(`SELECT data FROM items ${sql}`, parameters);
}
```

### Consumer Usage — Relational Table

```ts
const result = prepareTableSortAndSlice(
  'pg',
  { tableName: 'users', pkColumnName: 'id' },
  { sort: [{ key: 'email', direction: 1 }], limit: 50 },
  [{ whereClauseStatement: "active = $1", statementArguments: [true] }]
);
if (!result.success) throw new QueryError(result.errors);

const { sql, parameters } = flattenPreparedQueryStatementToSql(result);
const rows = await pg.query(`SELECT * FROM users ${sql}`, parameters);
```

### Consumer Usage — Drizzle ORM

```ts
const result = prepareObjectsTableQuery('pg', table, filter, sortAndSlice);
if (!result.success) throw new QueryError(result.errors);

// Option 1: Use flattened SQL
const { sql: clausesSql, parameters } = flattenPreparedQueryStatementToSql(result);
const rows = await db.execute(
  sql`SELECT data FROM items ${sql.raw(clausesSql)}`
);

// Option 2: Use individual clauses for more control
const rows = await db.select().from(items)
  .where(result.where_statement
    ? sql.raw(result.where_statement.whereClauseStatement)
    : undefined)
  .orderBy(result.order_by_statement
    ? sql.raw(result.order_by_statement)
    : undefined)
  .limit(sortAndSlice?.limit);
```

### Consumer Usage — Manual Clause Composition (Rare)

For consumers who need clause-level access (e.g. embedding ORDER BY in a subquery), the `PreparedQueryStatement` fields are all individually accessible:

```ts
const result = prepareObjectsTableQuery('pg', table, filter, sortAndSlice);
if (!result.success) throw new QueryError(result.errors);

// Use just the ORDER BY in a window function
const sql = `SELECT *, ROW_NUMBER() OVER (ORDER BY ${result.order_by_statement}) AS rn
  FROM items
  ${result.where_statement ? 'WHERE ' + result.where_statement.whereClauseStatement : ''}`;
```

### Pros
- **Best ergonomics for the common case.** `prepareObjectsTableQuery` + `flattenPreparedQueryStatementToSql` covers 90% of usage in two calls.
- **WHERE composition is fully internal.** Filter, cursor, and custom clauses are all ANDed with parameter rebasing handled by `concatSqlParameters`. Consumer never touches parameter numbering.
- **Dual-mode: JSON column + relational.** `WhereFilterDefinition` is scoped to JSON columns. Ordering works for both table types via separate functions with appropriate `TableInfo` variants.
- **Dialect as parameter, not naming.** One `prepareObjectsTableQuery` and one `prepareTableSortAndSlice` — not four functions.
- **Filter accepts both forms.** Pass `WhereFilterDefinition<T>` or `PreparedWhereClauseStatement` — the builder handles either. This lets advanced consumers pre-build filters while simple consumers pass the definition directly.
- **Additional WHERE clauses composable.** Custom security filters, tenant isolation, soft-delete checks — just pass `PreparedWhereClauseStatement[]`. No manual parameter rebasing.
- **Clause-level access preserved.** The result type exposes individual clauses for consumers who need fine-grained control (subqueries, CTEs, window functions).
- **Option A primitives stay clean.** Internal helpers are simple, testable, and hidden from the public API.
- **Flattening helper for happy path.** `flattenPreparedQueryStatementToSql` eliminates boilerplate for the most common usage pattern.

### Cons
- **`TableInfoJsonObject` has fields only needed for optional features.** `ddl` and `tableName` are only required when `after_pk` is present; `schema` is only required when filter is a `WhereFilterDefinition`. These could be made optional with a discriminated union, but that adds type complexity.
- **Filter union type.** `WhereFilterDefinition<T> | PreparedWhereClauseStatement` requires a runtime type guard (`isWhereFilterDefinition`). Straightforward but adds a branch.

---

## Comparison Table

| Criterion | A (Primitives) | B (Bundle) | C (Full Query) | D (Hybrid) | **E (Dual-Mode)** |
|---|---|---|---|---|---|
| Composability | Best | Good | Poor | Best | **Best** |
| Simple common case | Manual | Good | Best | Good | **Best** |
| WHERE composition | Manual | Internal | Internal | Both | **Internal + custom** |
| Parameter safety | Manual | Good | Best | Best | **Best (internal concat)** |
| Drizzle compat | Good | Good | Poor | Good | **Good** |
| Consistency with where-filter | Best | Good | Poor | Best | **Good** |
| JSON + relational support | N/A | N/A | N/A | N/A | **Both** |
| Custom WHERE clauses | Manual | No | No | Manual | **Built-in** |
| API surface size | Small | Small | Small | Medium | **Small (2 builders + 1 helper)** |
| Happy-path helper | No | No | Yes | No | **Yes (flatten)** |

**Recommendation: Option E.** It directly addresses the primary consumer pattern (`ICollection.get` with filter + ordering), handles WHERE composition internally (including cursor and custom clauses), supports both JSON-column and relational tables, and provides a flattening helper for the common case while preserving clause-level access for advanced usage.

