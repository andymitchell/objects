# Other Systems: Sort/Limit/Offset/Pagination Examples

Extracted from source code and documentation of each system. Used as reference material for designing our query system.

---

## TanStack DB

### Sort (`orderBy`)

Chainable, accumulative. Each call adds to the sort order.

```typescript
// Single column ascending (default)
query.from({ users }).orderBy(({ users }) => users.name)

// Descending
query.from({ users }).orderBy(({ users }) => users.createdAt, 'desc')

// Multi-column (chain calls)
query.from({ users })
  .orderBy(({ users }) => users.lastName)
  .orderBy(({ users }) => users.firstName)

// Advanced options (null handling, locale-aware)
query.from({ posts }).orderBy(({ posts }) => posts.title, {
  direction: 'asc',
  nulls: 'last',
  stringSort: 'locale',
  locale: 'en-US',
  localeOptions: { sensitivity: 'base' }
})
```

### Limit & Offset

Both require `orderBy` to be set.

```typescript
query.from({ posts })
  .orderBy(({ posts }) => posts.createdAt, 'desc')
  .offset(page * pageSize)
  .limit(pageSize)
```

### Key Types (IR layer)

```typescript
interface QueryIR {
  from: From; select?: Select; join?: Join;
  where?: Array<Where>; orderBy?: OrderBy;
  limit?: Limit; offset?: Offset; // ...
}
type OrderBy = Array<OrderByClause>
type OrderByClause = { expression: BasicExpression; compareOptions: CompareOptions }
type OrderByDirection = 'asc' | 'desc'
type Limit = number
type Offset = number

type OrderByOptions = {
  direction?: OrderByDirection
  nulls?: 'first' | 'last'
} & StringCollationConfig

type CompareOptions = StringCollationConfig & {
  direction: OrderByDirection
  nulls: 'first' | 'last'
}
```

### Cursor Pagination

TanStack DB has a 3-layer architecture for pagination:

1. **Query Builder** (user-facing): `orderBy`, `limit`, `offset` — no explicit cursor API
2. **Subscription Layer** (`requestLimitedSnapshot`): builds cursor expressions from last-sent row values
3. **Sync/Backend Layer** (`LoadSubsetOptions`): receives cursor + offset separately; backend chooses strategy

**LoadSubsetOptions** — what the backend/sync layer receives:

```typescript
type CursorExpressions = {
  whereFrom: BasicExpression<boolean>     // rows AFTER cursor (exclusive)
  whereCurrent: BasicExpression<boolean>  // rows AT cursor boundary
  lastKey?: string | number               // for deduplication
}

type LoadSubsetOptions = {
  where?: BasicExpression<boolean>   // main filter only (no cursor mixed in)
  orderBy?: OrderBy
  limit?: number
  cursor?: CursorExpressions         // cursor expressions passed SEPARATELY
  offset?: number                    // offset-based alternative
  subscription?: Subscription
}
```

**`buildCursor`** — generates composite WHERE for multi-column orderBy:

For `[col1 ASC, col2 DESC]` with values `[v1, v2]`:
```sql
-- Produces:
OR(
  col1 > v1,
  AND(col1 = v1, col2 < v2)   -- DESC flips to lt
)
```

```typescript
function buildCursor(
  orderBy: OrderBy,
  values: Array<unknown>,
): BasicExpression<boolean> | undefined
```

**Infinite query** (`useLiveInfiniteQuery`): uses `setWindow({ offset, limit })` internally with peek-ahead (+1 item for `hasNextPage`).

**Expression parsing helpers** for backends:

```typescript
function parseLoadSubsetOptions(options?: {
  where?: BasicExpression<boolean>; orderBy?: OrderBy; limit?: number
}): { filters: Array<SimpleComparison>; sorts: Array<ParsedOrderBy>; limit?: number }

interface SimpleComparison { field: FieldPath; operator: string; value?: any }
interface ParsedOrderBy { field: FieldPath; direction: 'asc' | 'desc'; nulls: 'first' | 'last' }
```

### Key Takeaway

TanStack DB does NOT expose cursor pagination in the front-end query builder. Cursor construction is internal — the subscription layer builds cursor expressions from the last-sent row's sort-key values and passes them to the sync layer via `LoadSubsetOptions`. The backend chooses between cursor-based (`cursor.whereFrom`) or offset-based (`offset`) pagination.

---

## RxDB

### Sort

**Mango JSON syntax** (primary API):

```typescript
// Single field
myCollection.find({ selector: {}, sort: [{ age: 'asc' }] })

// Multi-field
myCollection.find({
  selector: {},
  sort: [{ age: 'asc' }, { name: 'asc' }, { _id: 'asc' }]
})

// Nested property
myCollection.find({ selector: {}, sort: [{ 'mainSkill.name': 'asc' }] })
```

Each sort element: one key mapped to `'asc'` or `'desc'`.

**Query Builder plugin** (chained syntax):

```typescript
query.sort('age -name')              // string: prefix '-' for desc
query.sort({ age: 1, name: -1 })    // object: 1=asc, -1=desc
query.sort([['age', 1], ['name', -1]])  // array of tuples
```

**PrimaryKey always appended** to sort for deterministic ordering:

```typescript
// If user provides sort but primaryKey is not in it, append it:
if (!isPrimaryInSort) {
  normalizedMangoQuery.sort.push({ [primaryKey]: 'asc' });
}
```

If no sort provided: RxDB picks one from the best matching schema index, falling back to primaryKey ascending.

### Limit & Skip

```typescript
// JSON syntax
myCollection.find({ selector: {}, sort: [{ age: 'asc' }], skip: 20, limit: 10 })

// Builder syntax
myCollection.find().where('age').gt(18).skip(20).limit(10)
```

`skip` defaults to `0` during normalization. `limit` is optional.

### Key Types

```typescript
type MangoQuerySortDirection = 'asc' | 'desc'
type MangoQuerySortPart<RxDocType> = { [k in StringKeys<RxDocType>]: MangoQuerySortDirection }

type MangoQuery<RxDocType> = {
  selector?: MangoQuerySelector<RxDocType>
  sort?: MangoQuerySortPart<RxDocType>[]
  skip?: number
  limit?: number
  index?: string | string[]
}

// After normalization (sort and skip become required):
type FilledMangoQuery<RxDocType> = {
  selector: MangoQuerySelector<RxDocumentData<RxDocType>>
  sort: MangoQuerySortPart<RxDocumentData<RxDocType>>[]  // required
  skip: number       // required, defaults to 0
  limit?: number
  index?: string[]
}
```

### Cursor Pagination

**No built-in cursor API.** Must be done manually via selector conditions:

```typescript
const page1 = await myCollection.find({
  selector: {}, sort: [{ createdAt: 'desc' }, { id: 'asc' }], limit: 20
}).exec();
const lastDoc = page1[page1.length - 1];
const page2 = await myCollection.find({
  selector: { createdAt: { $lte: lastDoc.createdAt } },
  sort: [{ createdAt: 'desc' }, { id: 'asc' }], limit: 20
}).exec();
```

### Runtime Sort Comparator

```typescript
function getSortComparator<RxDocType>(
  schema: RxJsonSchema<RxDocumentData<RxDocType>>,
  query: FilledMangoQuery<RxDocType>
): DeterministicSortComparator<RxDocType>
```

Iterates sort parts, uses `objectPathMonad` for dot-path access, applies direction.

---

## Triplit

### Sort (`.order()`)

Tuple-based: `[propertyPath, 'ASC' | 'DESC']`. Chainable (accumulates).

```typescript
query.Order('name', 'ASC')
query.Order([['name', 'ASC'], ['createdAt', 'DESC']])
query.Order('name', 'ASC').Order('age', 'DESC')  // accumulates
```

**Types:**

```typescript
type QueryOrder<M, CN> = OrderStatement<M, CN>[]
type OrderStatement<M, CN> = [property: ModelPaths<M, CN>, direction: 'ASC' | 'DESC']
```

### Limit

```typescript
query.Limit(10)
```

Simple numeric. No offset/skip support exists anywhere.

### Cursor Pagination (`.after()`)

Triplit's **only** pagination mechanism. Value-based (not opaque token).

```typescript
query.Order('name', 'ASC').After(['Alice'])
query.Order('name', 'ASC').After(['Alice'], true)  // inclusive=true
```

**Types:**

```typescript
type QueryAfter = [cursor: ValueCursor, inclusive: boolean]
type ValueCursor = [value: QueryValuePrimitive, ...values: QueryValuePrimitive[]]
type QueryValuePrimitive = number | string | boolean | Date | null
```

**Critical constraints:**
- `.after()` **requires** `.order()` — throws `AfterClauseWithNoOrderError`
- Cursor array length **must equal** order clause length (one value per sort field)

**How `satisfiesAfter` works:**

Walks through each order field comparing cursor values. For ASC, entities with values greater than cursor pass. For DESC, entities with values less pass. On exact tie across all fields, `inclusive` boolean decides.

### Client Pagination Helpers

**`subscribeWithPagination`** — page-based:
- Auto-appends `['id', 'ASC']` to order for stable cursors
- Over-fetches by 1 to detect `hasNextPage`/`hasPreviousPage`
- `prevPage()` flips sort direction, sets after to first item, reverses results

**`subscribeWithExpand`** — infinite scroll:
- `loadMore()` increases limit cumulatively (does NOT use cursor advancement)

---

## Dexie.js

### Sort: `orderBy()` vs `sortBy()`

**`Table.orderBy(index)`** — Index-based, fast (B-tree seek):

```typescript
db.friends.orderBy('age')                    // by indexed property
db.friends.orderBy(['customerId', 'orderDate'])  // compound index
```

Can only sort by an **indexed property**. Returns unfiltered Collection sorted by that index.

**`Collection.sortBy(keyPath)`** — In-memory JS sort (O(N log N)):

```typescript
db.friends.where('age').above(25).sortBy('name')  // filter by one, sort by another
```

Loads entire filtered result into memory, then sorts. Supports nested paths (`'address.city'`).

**Key limitation:** IndexedDB can only use one index at a time. Cannot simultaneously filter by one index and sort by another at DB level.

### Limit & Offset

```typescript
db.friends.orderBy('age').limit(10)
db.friends.orderBy('age').offset(20).limit(10)
```

**`offset()` is O(N)** proportional to offset value:
- Simple queries: uses `IDBCursor.advance(N)` — faster but still O(N)
- Complex queries: iterates through items in JS

### Cursor-Based Pagination (Recommended Pattern)

```typescript
// Page 1
let page = await db.friends
  .orderBy('lastName')
  .filter(criterionFunction)
  .limit(PAGE_SIZE)
  .toArray();

// Page 2+
let lastEntry = page[page.length - 1];
page = await db.friends
  .where('lastName').aboveOrEqual(lastEntry.lastName)
  .filter(fastForward(lastEntry, "id", criterionFunction))
  .limit(PAGE_SIZE)
  .toArray();
```

Uses `where(index).aboveOrEqual(lastValue)` to seek directly in B-tree (O(log N)) instead of offset scanning. `fastForward` helper skips duplicates by checking primary key.

### Key Types

```typescript
interface Collection<T, TKey, TInsertType> {
  limit(n: number): Collection<T, TKey, TInsertType>
  offset(n: number): Collection<T, TKey, TInsertType>
  reverse(): Collection<T, TKey, TInsertType>
  sortBy(keyPath: string): PromiseExtended<T[]>
  filter(filter: (x: T) => boolean): Collection<T, TKey, TInsertType>
  // ...
}

interface Table<T, TKey, TInsertType> {
  orderBy(index: string | string[]): Collection<T, TKey, TInsertType>
  where(indexOrPrimaryKey: string): WhereClause<T, TKey, TInsertType>
  // ...
}

interface WhereClause<T, TKey, TInsertType> {
  above(key: any): Collection<T, TKey, TInsertType>
  aboveOrEqual(key: any): Collection<T, TKey, TInsertType>
  below(key: any): Collection<T, TKey, TInsertType>
  between(lower: any, upper: any, includeLower?: boolean, includeUpper?: boolean): Collection
  // ...
}
```

### Performance Summary

| Approach | Complexity | Notes |
|---|---|---|
| `orderBy(index).limit(N)` | O(N) | Best for first page |
| `sortBy(keyPath)` | O(M log M) | Entire result in memory |
| `offset(N)` | O(N) proportional to offset | Gets worse deeper |
| `where(idx).aboveOrEqual(cursor).limit(N)` | O(log M + N) | Best for deep pagination |

---

## Drizzle ORM

### Sort (`orderBy`)

```typescript
import { asc, desc } from 'drizzle-orm';

db.select().from(users).orderBy(users.name)
// SQL: SELECT ... ORDER BY "name"

db.select().from(users).orderBy(desc(users.name))
// SQL: SELECT ... ORDER BY "name" DESC

// Multi-column
db.select().from(users).orderBy(asc(users.name), desc(users.name2))
// SQL: SELECT ... ORDER BY "name" ASC, "name2" DESC
```

### Limit & Offset

```typescript
db.select().from(users).limit(10).offset(10)
// SQL: SELECT ... LIMIT 10 OFFSET 10
```

### Offset-Based Pagination

```typescript
const getUsers = async (page = 1, pageSize = 3) => {
  await db.select().from(users)
    .orderBy(asc(users.firstName), asc(users.id))  // tie-break on unique column
    .limit(pageSize)
    .offset((page - 1) * pageSize);
};
// SQL: SELECT * FROM users ORDER BY first_name ASC, id ASC LIMIT 3 OFFSET 3
```

### Cursor-Based Pagination

**Single column (unique key):**

```typescript
const nextPage = async (cursor?: number, pageSize = 3) => {
  await db.select().from(users)
    .where(cursor ? gt(users.id, cursor) : undefined)
    .limit(pageSize)
    .orderBy(asc(users.id));
};
// SQL (cursor=3): SELECT * FROM users WHERE id > 3 ORDER BY id ASC LIMIT 3
```

**Multi-column (non-unique sort + unique tie-breaker):**

```typescript
const nextPage = async (cursor?: { id: number; firstName: string }, pageSize = 3) => {
  await db.select().from(users)
    .where(cursor
      ? or(
          gt(users.firstName, cursor.firstName),
          and(eq(users.firstName, cursor.firstName), gt(users.id, cursor.id)),
        )
      : undefined)
    .limit(pageSize)
    .orderBy(asc(users.firstName), asc(users.id));
};
// SQL: SELECT * FROM users
//   WHERE (first_name > 'Alex' OR (first_name = 'Alex' AND id > 2))
//   ORDER BY first_name ASC, id ASC LIMIT 3
```

**Cursor direction rules:**
- ASC: `gt(column, cursorValue)` — rows after cursor
- DESC: `lt(column, cursorValue)` — rows before cursor
- Multi-column: `or(gt(col1, v1), and(eq(col1, v1), gt(col2, v2)))`

### Key Types

```typescript
function asc(column: AnyColumn | SQLWrapper): SQL
function desc(column: AnyColumn | SQLWrapper): SQL
limit(n: number | Placeholder): PgSelectWithout<..., 'limit'>
offset(n: number | Placeholder): PgSelectWithout<..., 'offset'>

// PgSelectWithout prevents calling the same clause twice (type-level enforcement)
```

---

## Cross-System Comparison

| Feature | TanStack DB | RxDB | Triplit | Dexie.js | Drizzle |
|---|---|---|---|---|---|
| **Sort syntax** | callback + direction | `[{field: dir}]` array | `[field, dir]` tuple | `orderBy(index)` / `sortBy(path)` | `orderBy(asc(col))` |
| **Multi-column sort** | chain `.orderBy()` | array of sort objects | array of tuples / chain | compound index only | variadic args |
| **Limit** | `.limit(n)` | `limit: n` | `.Limit(n)` | `.limit(n)` | `.limit(n)` |
| **Offset/Skip** | `.offset(n)` | `skip: n` | None | `.offset(n)` (O(N)) | `.offset(n)` |
| **Cursor pagination** | Internal only (subscription layer builds cursor, backend chooses) | None (manual via selector) | `.after(values, inclusive?)` — value-based, 1 per sort field | Manual (`where.aboveOrEqual`) | Manual (`where gt/lt` conditions) |
| **Auto-append PK to sort** | No | Yes (always) | Client helpers do | No | No |
| **Requires order for pagination** | Yes (limit/offset need orderBy) | No | Yes (after requires order) | No | No |
| **Direction values** | `'asc' \| 'desc'` | `'asc' \| 'desc'` | `'ASC' \| 'DESC'` | `'next' \| 'prev'` (internal) | `asc()` / `desc()` functions |
