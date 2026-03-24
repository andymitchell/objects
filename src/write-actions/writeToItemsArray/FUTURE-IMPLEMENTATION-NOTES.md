# writeToItemsArray — Removed DDL Fields

These capabilities were removed from `DDL.ListRules` to keep DDL implementation-agnostic. Each writer implementation can re-introduce them as implementation-specific config.

## write_strategy

**What it was:** Chose how create/update payloads are applied to items. Two modes:
- `{ type: 'lww' }` — Last-write-wins merge (default, still the default).
- `{ type: 'custom', strategy: WriteStrategy<T> }` — User-provided `create_handler` / `update_handler`.

**Current status:** Moved to `WriteToItemsArrayOptions.write_strategy`. The `WriteStrategy<T>` interface and LWW implementation are unchanged — only the config location moved from DDL to options.

## pre_triggers

**What was planned:** Pre-commit hooks that run on an item before it's accepted into the array. Signature: `(replacement: T, existing?: T) => T`. Throwing would halt the write.

**Never implemented** — only TODO comments existed.

**If re-implementing:** Consider:
- Sync vs async triggers
- Error semantics (throw to halt vs return error value)
- Ordering guarantees when multiple triggers are registered
- Whether triggers can transform the item or only validate

## growset

**What it was:** Soft-delete / tombstone pattern. Config: `{ delete_key: keyof T }` — the property that marks an item as deleted instead of removing it.

**Was a stub** — `convertWriteActionToGrowSetSafe` returned the action unchanged.

**If re-implementing:** A real grow-only set needs:
- **Delete → mark:** Convert delete actions into updates that set the `delete_key`
- **Visibility filtering:** Exclude tombstoned items from query results by default
- **Undelete:** Clear the `delete_key` to restore an item
- **Compaction:** Eventually purge old tombstones to bound storage growth
- **Cross-implementation semantics:** SQL can handle this via views/WHERE clauses; in-memory needs explicit filtering

## Why removed from DDL

DDL describes the shape and constraints of data — it should be portable across implementations (in-memory arrays, SQL, etc.). These three fields are inherently about *how a specific writer applies changes*, which varies by implementation. A SQL backend would use ON CONFLICT clauses, database triggers, and soft-delete columns — forcing it through these abstractions adds no value.
