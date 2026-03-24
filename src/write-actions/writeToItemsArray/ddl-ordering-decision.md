# DDL Ordering Decision (2026-03-24)

## Decision

Removed `order_by` (and `ListOrdering` type) from DDL. Collections default to primary-key ordering. Callers control ordering dynamically via `SortAndSlice` from `@andyrmitchell/objects/query`.

## Why

`order_by` mixed a query concern into the data contract. In mainstream data systems (SQL, MongoDB, DynamoDB) the schema defines structure (shape, keys, constraints, permissions) — ordering is a query concern. The DDL's `order_by` was ambiguous: documented as "guidance" but typed as required, creating confusion about whether it was enforced or advisory.

`orderList` (and the `ListOrdering` type it used) was superseded by `sortAndSliceObjects`, which supports multi-key sort, cursor/offset pagination, limits, and identical semantics across in-memory and SQL.

## Breaking change: store repo

The `store` repo reads `ddl.lists['.'].order_by` at runtime (e.g. `MemoryRawStore`, `BaseSqlRawStore`) as the default collection ordering. It also imports `orderList` and `ListOrdering` extensively.

**Follow-up required in store:**
- Replace `orderList` calls with `sortAndSliceObjects`
- Replace `ListOrdering` type with `SortDefinition` (from `@andyrmitchell/objects/query`)
- Stop reading `ddl.lists['.'].order_by` — derive default ordering from PK, or accept it as a constructor/config parameter
