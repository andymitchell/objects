# Goal

Have extremely flexible (minimal, lightweight, composable) responses to applying write actions (as seen in `applyWritesToItems`). 

# Context 

The responses from applying write actions (@./types.ts) have become messy and brittle. Often consuming clients have to map them slightly to make them work in their location, which feels like a code smell. 

# Current Response Type Summary

## Type Hierarchy

```
WriteActionsResponse<T>                          [types.ts:211]
├── WriteActionsResponseOk                       [types.ts:182]  {status:'ok'}
└── WriteActionsResponseError<T>                 [types.ts:190]  {status:'error'} & SerializableCommonError
    ├── .successful_actions: SuccessfulWriteAction<T>[]
    ├── .failed_actions: FailedWriteAction<T>[]
    └── .message (from SerializableCommonError)

ApplyWritesToItemsResponse<T>                    [applyWritesToItems/types.ts:230]
├── WriteActionsResponseOk & {changes, successful_actions}
└── WriteActionsResponseError<T> & {changes}

ApplyWritesToItemsChanges<T>                     [applyWritesToItems/types.ts:207]
  extends ObjectsDelta<T>  {insert:T[], update:T[], remove_keys:PrimaryKeyValue[], created_at}
  + changed: boolean
  + final_items: T[]
  + referential_comparison_ok: boolean

SuccessfulWriteAction<T>                         [types.ts:166]
  .action: WriteAction<T>
  .affected_items?: WriteActionAffectedItem[]    (PK only, no full item)

FailedWriteAction<T>                             [types.ts:130]
  .action: WriteAction<T>
  .error_details: WriteCommonError[]
  .unrecoverable?: boolean
  .back_off_until_ts?: number
  .blocked_by_action_uuid?: string
  .affected_items?: FailedWriteActionAffectedItem<T>[]

FailedWriteActionAffectedItem<T>                 [types.ts:90]
  extends WriteActionAffectedItem {item_pk}
  + item: T
  + error_details: WriteCommonError[]

WriteCommonError                                 [types.ts:98]  discriminated union on 'type'
  'custom'              {message?}
  'schema'              {issues: ZodIssue[], tested_item?, serialised_schema?}
  'missing_key'         {primary_key}
  'update_altered_key'  {primary_key}
  'create_duplicated_key' {primary_key}
  'permission_denied'   {reason: literal union}

CombineWriteActionsWhereFiltersResponse<T>       [types.ts:175]
  {status:'ok', filter} | SerializableCommonError & {status:'error', failed_actions}
```

## How `applyWritesToItems` Builds Responses

**Success path** (applyWritesToItems.ts:440-444):
- Returns `{status:'ok', successful_actions, changes}`.
- `changes` always contains `final_items`, `insert`, `update`, `remove_keys`, `changed`, `referential_comparison_ok`, `created_at`.
- `successful_actions` tracks every action that ran, with just the `item_pk` of affected items.

**Error path** (applyWritesToItems.ts:404-438):
- Halts on first failure; all subsequent actions marked as `blocked_by_action_uuid`.
- If `atomic`: rolls back, returns empty `changes` and empty `successful_actions`.
- If non-atomic: returns partial `changes` and partial `successful_actions`.
- `failed_actions` is always populated on error path.
- `message` is hardcoded "Some write actions failed."
- Extends `SerializableCommonError` via `WriteActionsResponseError`.

**Key internal machinery:**
- `WriteActionFailuresTracker` — accumulates failures; errors duplicated at _both_ action-level and item-level (`FailedWriteAction.error_details` AND `FailedWriteActionAffectedItem.error_details`).
- `SuccessfulWriteActionesTracker` — accumulates successes per-action keyed by UUID.
- For `array_scope` recursion: nested `_applyWritesToItems` call, failures merged via `failureTracker.mergeUnderAction`.

## Where Response Types Are Used

**External public surface**: All types exported via `src/write-actions/index.ts` → `src/index.ts` (`export *`).

**Internal consumers only (no external consumers found)**:
- `applyWritesToItems.ts` — builds and returns `ApplyWritesToItemsResponse<T>`
- `combineWriteActionsWhereFilters.ts` — builds and returns `CombineWriteActionsWhereFiltersResponse<T>`
- `WriteActionFailuresTracker.ts` — constructs `FailedWriteAction` / `FailedWriteActionAffectedItem`
- `applyWritesToItems.test.ts` — consumes responses extensively
- `write-action-schemas.ts` — Zod schemas mirroring all response types

**Legacy/old types** in `index-old-types.ts`:
- Contains an older parallel type system with different names: `WriteActionFailures`, `WriteActionFailuresErrorDetails`, `WriteActionFailureAffectedItem`, `WriteActionError`, `WriteActionSuccess`, `AppliedWritesOutput`, `AppliedWritesOutputResponse`.
- This is evidence of prior organic evolution of the type system.

## Consumer Access Patterns (from tests)

**The "guard + throw" pattern** (repeated 70+ times):
```ts
expect(result.status).toBe('ok');
if (result.status !== 'ok') throw new Error("noop");
// now TS narrows to ok branch
result.changes.final_items ...
```

**Error detail drilling** (deep chaining):
```ts
result.failed_actions[0]!.affected_items![0]!.error_details[0]!.type
```

**Checking what succeeded on partial failure:**
```ts
result.successful_actions[0]!.action.uuid
result.successful_actions[0]!.affected_items![0]!.item_pk
```

## Asymmetries and Structural Oddities

1. **Error details duplicated**: `FailedWriteAction.error_details[]` AND `FailedWriteActionAffectedItem.error_details[]` both carry `WriteCommonError[]`. The tracker pushes the same error into both. Unclear which the consumer should use.

2. **Asymmetric affected items**: `SuccessfulWriteAction.affected_items` has only `{item_pk}` — no full item. `FailedWriteActionAffectedItem` has `{item_pk, item, error_details[]}`. Consumers of successful actions can't inspect what the item became.

3. **`successful_actions` on ok branch**: `WriteActionsResponseOk` does NOT include `successful_actions`. Only `ApplyWritesToItemsResponse` adds it on the ok branch. This means the base `WriteActionsResponseOk` is information-poor.

4. **`changes` is always present**: Both ok and error branches of `ApplyWritesToItemsResponse` include `changes`, but the union structure forces narrowing before accessing. It's not on the base `WriteActionsResponse` at all — only added by `ApplyWritesToItemsResponse`.

5. **`CombineWriteActionsWhereFiltersResponse`**: Has a different shape to `WriteActionsResponse` — it uses `SerializableCommonError & {status:'error', failed_actions}` as a flat intersection rather than `WriteActionsResponseError`. Inconsistent.

6. **`SerializableCommonError` is locally redeclared** (types.ts:8-17) instead of imported from `@andyrmitchell/utils/serialize-error` (commented out).

7. **`referential_comparison_ok`**: Computed internally from `!mutate || isDraft(items)`. It's a property of the invocation options, not of the result data — its presence on the response is an implementation leak.

## Zod Schema Coverage

`write-action-schemas.ts` provides runtime schemas for all response types:
- `WriteActionsResponseSchema` (discriminated union on `status`)
- `WriteActionsResponseOkSchema` / `WriteActionsResponseErrorSchema`
- `WriteCommonErrorSchema` (discriminated union on `type`)
- `FailedWriteActionSchema` / `SuccessfulWriteActionSchema` (with `make*` generic factories)
- `WriteActionSchema` (with `make*` factory for typed payloads)
- All have `isTypeEqual` assertions confirming schema↔type alignment

# Use Cases, Pros and Cons of Response Types

## Consumer Use Cases

### Happy Path — "All actions succeeded"

**What devs want to do:**
1. **Get the final state** — by far the dominant access: `result.changes.final_items`. Used 30+ times in tests; passed directly as input to subsequent calls.
2. **Get the delta** — `insert`, `update`, `remove_keys` — to sync downstream (e.g. emit to a CRDT, update a cache, send over the wire as `ObjectsDelta`).
3. **Check if anything changed** — `result.changes.changed` (exists in type but rarely accessed; consumers usually just check `final_items` directly).
4. **Audit which actions ran** — `result.successful_actions[n].action.uuid` and `.affected_items[n].item_pk`. Used occasionally to correlate actions with effects.

**Current friction:**
- Must narrow via `if (result.status !== 'ok') throw` before accessing any of the above. 35+ instances of boilerplate in tests alone.
- `successful_actions` lives on a different type layer than `changes`, so consumer must know which level each field lives at.

### Error Path — "Something went wrong"

**What devs want to do:**
1. **Determine error category** — Is it a schema violation? Permission denied? Duplicate key? Consumer drills into `failed_actions[0]!.error_details[0]!.type` to answer this.
2. **Decide if recovery is possible** — check `unrecoverable`, `back_off_until_ts`, `blocked_by_action_uuid`.
3. **Log/report the failure** — the store's `WriteActionsLifecycleReporter` takes the entire response, logs it, and emits events. It accesses `failed_actions` and `successful_actions` directly.
4. **Inspect the offending item** — `failed_actions[n].affected_items[n].item` to show the user what was wrong.
5. **Generate a user-facing error** — needs `message` + the specific error type.
6. **Handle partial success** (non-atomic) — need both `successful_actions` and `failed_actions` to understand what applied and what didn't. The store's `ActionOutcomesForUnexpectedError` does exactly this: tracks per-action outcomes keyed by UUID.

**Current friction:**
- Deep drilling: `result.failed_actions[0]!.affected_items![0]!.error_details[0]!.type` — 4 levels of chaining with `!` non-null assertions.
- Error details duplicated at action-level AND item-level — consumer doesn't know which to use.
- The `message` field comes from `SerializableCommonError` and is always the unhelpful hardcoded string `"Some write actions failed."`.

### External Consumer Pattern (store package)

The `@andyrmitchell/store` package is the primary external consumer:
- `WriteResponse<T>` is just a type alias for `WriteActionsResponse<T>`.
- `logWriteActions.ts` constructs `FailedWriteAction` objects manually for unexpected-error scenarios, pushing `{type:'custom', message}` into `error_details`.
- `ActionOutcomesForUnexpectedError` iterates `successful_actions` and `failed_actions` to build a per-action outcome map.
- `ReadModifyWrite.ts` uses `SuccessfulWriteAction` to track what was applied.

Key observation: store consumers work with `WriteActionsResponse<T>` (the base type), NOT `ApplyWritesToItemsResponse<T>`. They never see `changes` or `final_items`. This confirms the base type is the public contract; `ApplyWritesToItemsResponse` is for direct `applyWritesToItems` callers only.

---

## Strengths of Current Type System

1. **Discriminated union on `status`** — clear branching point; TypeScript narrows correctly once you check it.
2. **`WriteCommonError` is well-categorised** — the discriminated union on `type` covers the real error categories (schema, missing_key, permission_denied, etc.) and is extensible.
3. **`ObjectsDelta` composition** — `changes` extends `ObjectsDelta`, which is reused elsewhere for sync/delta operations. Good composability.
4. **Per-action granularity** — tracking success/failure per action (by UUID) enables the store's lifecycle reporting and partial-success handling.
5. **Zod schema coverage** — runtime validation of responses is valuable for serialization boundaries; the `isTypeEqual` assertions keep schemas aligned.
6. **`FailedWriteAction` metadata** — `unrecoverable`, `back_off_until_ts`, `blocked_by_action_uuid` are genuinely useful for retry/recovery logic.

---

## Weaknesses and Problems

### W1: Discriminated union forces narrowing before accessing common data
`changes` is present on both ok and error branches of `ApplyWritesToItemsResponse`, but TypeScript forces narrowing before access. This leads to the 35+ `if (status !== 'ok') throw` boilerplate lines. The `status` field is useful as metadata, but it shouldn't gate access to data that's always present.

**Strong opinion**: Prefer a shape where `status` exists, but data/error can be checked at any time via `result.data?` / `result.error?`.

### W2: Error details duplicated at two levels
`FailedWriteAction.error_details[]` AND `FailedWriteActionAffectedItem.error_details[]` carry the same `WriteCommonError[]`. The `WriteActionFailuresTracker.addErrorDetails` method pushes to both simultaneously. Consumer doesn't know which to use — and in tests, both are asserted identically. This is confusing and wasteful.

### W3: Deep drilling required for error inspection
Accessing a specific error type requires: `result.failed_actions[0]!.affected_items![0]!.error_details[0]!.type` — 4 non-null assertions, 4 levels of nesting. This is unpleasant to write, fragile to read, and forces every consumer to understand the full nesting structure.

**Strong opinion**: The stacking of `FailedWriteAction`/`WriteCommonError` always needs excessive handling code. Not conceptually clean.

### W4: Asymmetric affected-item types
`SuccessfulWriteAction.affected_items` has only `{item_pk}` (no full item). `FailedWriteActionAffectedItem` has `{item_pk, item, error_details[]}`. Plus `WriteActionAffectedItem` as a base. Three types for what is conceptually one thing.

**Strong opinion**: The muddle between `WriteActionAffectedItem` / `FailedWriteActionAffectedItem` smells of organic accretion rather than intentional design.

### W5: `successful_actions` inconsistently placed
`WriteActionsResponseOk` does NOT include `successful_actions`. Only `ApplyWritesToItemsResponse` adds it on the ok branch. This means the base ok type is information-poor — consumers of the base type (like the store) can't tell which actions succeeded on the ok path without assuming "all of them".

### W6: `referential_comparison_ok` is an implementation leak
Computed from `!mutate || isDraft(items)` — this is a property of the *invocation options*, not the *result data*. It belongs on the caller's side, not in the response.

**Strong opinion**: REMOVE from response type entirely.

### W7: `final_items` is always required but shouldn't be
Currently mandatory on `ApplyWritesToItemsChanges`. But future apply functions (e.g. ones that apply deltas without holding the full item list) may not provide it.

**Strong opinion**: `final_items` should be OPTIONAL in the response type. `applyWritesToItems` always provides it, but the type should not force all producers to.

### W8: `CombineWriteActionsWhereFiltersResponse` is dead code
Never called in production code. Has a different shape to `WriteActionsResponse` (flat intersection vs. proper extension). Has tests but no consumers.

**Strong opinion**: Drop it entirely.

### W9: `SerializableCommonError` locally redeclared
The `message`, `cause`, `stack`, `name` fields are redeclared in `types.ts` rather than imported from `@andyrmitchell/utils/serialize-error`. The import is even commented out. This is a maintenance risk — two sources of truth for the same shape.

### W10: Hardcoded `message` field
The error path always sets `message: "Some write actions failed."` — this is never useful to a consumer. It's inherited from `SerializableCommonError` which expects a meaningful message, but the actual error details live in `error_details` arrays. The `message` field is noise.

### W11: Base types too narrow for reuse
`WriteActionsResponseOk` is just `{status: 'ok'}` — no data at all. `WriteActionsResponseError` mixes serialization concerns (`SerializableCommonError`) with domain data (`failed_actions`, `successful_actions`). Neither composes cleanly for different apply functions to extend.

---

## Summary: Design Principles for Phase 3

Based on the use cases and weaknesses above, the new response type system should:

1. **Allow data/error access without narrowing** — `result.data?.final_items`, `result.error?.failed_actions` always available; `status` is informational.
2. **Single error location per action** — no duplication between action-level and item-level. One canonical place for error details.
3. **Flatten the error access path** — reduce from 4 levels of nesting to ~2.
4. **Symmetric affected items** — same shape for success and failure (both get item_pk; both optionally get the full item).
5. **Remove `referential_comparison_ok`** from response.
6. **Make `final_items` optional** in the base changes type.
7. **Drop `CombineWriteActionsWhereFiltersResponse`**.
8. **Import `SerializableCommonError`** from utils rather than redeclaring.
9. **Composable base** — a minimal response type that different apply functions can extend without the base dictating what must be present.

# Implementation Plan

## New Type Design

### Core Principle
Replace the discriminated union (`status:'ok'|'error'`) that gates data access with a flat shape where `ok` is informational and all fields are always accessible via `?.`.

### New Types

```ts
// ─── Error detail (rename WriteCommonError → WriteActionError) ───
// Same discriminated union on 'type', unchanged content.
type WriteActionError = /* same variants as current WriteCommonError */;

// ─── Error with item context (flattens the affected_items→error_details nesting) ───
type WriteActionErrorContext<T> = WriteActionError & {
  item_pk?: PrimaryKeyValue;
  item?: T;
};

// ─── Affected item (unified: replaces WriteActionAffectedItem + FailedWriteActionAffectedItem) ───
type WriteActionAffectedItem<T> = {
  item_pk: PrimaryKeyValue;
  item?: T;              // optional: provided when available (success or failure)
};
// No more error_details on affected items — errors live flat on WriteActionOutcome.

// ─── Per-action outcome (discriminated union on `ok`) ───
// Replaces SuccessfulWriteAction + FailedWriteAction.
// Using a discriminated union preserves TypeScript narrowing:
//   if (!outcome.ok) { outcome.errors[0].type }  — no optional chaining needed after guard.

type WriteActionOutcomeOk<T> = {
  ok: true;
  action: WriteAction<T>;
  affected_items?: WriteActionAffectedItem<T>[];
};

type WriteActionOutcomeFailed<T> = {
  ok: false;
  action: WriteAction<T>;
  affected_items?: WriteActionAffectedItem<T>[];
  errors: WriteActionErrorContext<T>[];       // required — always present on failure
  unrecoverable?: boolean;
  back_off_until_ts?: number;
  blocked_by_action_uuid?: string;
};

type WriteActionOutcome<T> = WriteActionOutcomeOk<T> | WriteActionOutcomeFailed<T>;

// ─── Base result (replaces WriteActionsResponse) ───
// NOT a discriminated union at the top level. `ok` is informational.
// `actions` is the single canonical ordered list; use helper functions
// `getFailedActions()` / `getSuccessfulActions()` for filtered access.
type WriteResult<T> = {
  ok: boolean;
  actions: WriteActionOutcome<T>[];
  error?: { message: string };    // lightweight summary; only present when ok=false
};

// ─── Changes base (minimal contract for any apply function) ───
type WriteChangesBase<T> = ObjectsDelta<T> & {
  changed: boolean;
  // referential_comparison_ok: REMOVED (implementation leak)
};

// ─── applyWritesToItems-specific ───
// Extends WriteChangesBase with `final_items: T[]` (required, not optional).
// Future apply functions can extend WriteChangesBase without final_items.
type ApplyWritesToItemsChanges<T> = WriteChangesBase<T> & {
  final_items: T[];
};

type ApplyWritesToItemsResult<T> = WriteResult<T> & {
  changes: ApplyWritesToItemsChanges<T>;  // always present, no narrowing needed
};
```

### Consumer Access Patterns (new)

```ts
// Happy path — no narrowing needed:
result.changes.final_items    // T[] — always accessible on ApplyWritesToItemsResult
result.changes.insert         // delta

// Quick error check:
if (!result.ok) log(result.error?.message);

// Error drilling — discriminated union narrows after guard, no `!` needed:
const failed = getFailedActions(result);
if (failed.length > 0) {
  failed[0].errors[0].type;       // TS knows `errors` is required (ok:false branch)
  failed[0].errors[0].item;       // offending item, right there
}

// Or inline with find:
const firstFail = result.actions.find((a): a is WriteActionOutcomeFailed<T> => !a.ok);
if (firstFail) firstFail.errors[0].type;  // fully narrowed

// Partial success:
const successes = getSuccessfulActions(result);
const failures  = getFailedActions(result);

// Per-action outcome map (what store's ActionOutcomesForUnexpectedError does):
const map = Object.fromEntries(result.actions.map(a => [a.action.uuid, a]));
```

### Mapping: Old → New

| Old Type | New Type | Notes |
|---|---|---|
| `WriteActionsResponse<T>` | `WriteResult<T>` | No longer discriminated union |
| `WriteActionsResponseOk` | _(eliminated)_ | Just `WriteResult` with `ok:true` |
| `WriteActionsResponseError<T>` | _(eliminated)_ | Just `WriteResult` with `ok:false` |
| `SuccessfulWriteAction<T>` | `WriteActionOutcomeOk<T>` | Discriminated union branch (ok:true) |
| `FailedWriteAction<T>` | `WriteActionOutcomeFailed<T>` | Discriminated union branch (ok:false) |
| `WriteCommonError` | `WriteActionError` | Renamed |
| `WriteActionAffectedItem` | `WriteActionAffectedItem<T>` | Now generic, has optional `item` |
| `FailedWriteActionAffectedItem<T>` | _(eliminated)_ | Merged into `WriteActionAffectedItem<T>` |
| `ApplyWritesToItemsResponse<T>` | `ApplyWritesToItemsResult<T>` | `changes` always present |
| `ApplyWritesToItemsChanges<T>` | Same name | `final_items: T[]` required (extends `WriteChangesBase<T>`), `referential_comparison_ok` removed |
| _(new)_ | `WriteChangesBase<T>` | Minimal base: `ObjectsDelta<T> & { changed }`. No `final_items`. |
| _(new)_ | `WriteActionOutcome<T>` | Union of `WriteActionOutcomeOk<T> \| WriteActionOutcomeFailed<T>` |
| `CombineWriteActionsWhereFiltersResponse<T>` | _(dropped)_ | Dead code |
| `SerializableCommonError` (local) | _(removed)_ | Import from `@andyrmitchell/utils` |

### Helper Utilities (new exports)

```ts
/** Filter for failed action outcomes. Returns narrowed WriteActionOutcomeFailed[]. */
function getFailedActions<T>(result: WriteResult<T>): WriteActionOutcomeFailed<T>[];

/** Filter for successful action outcomes. Returns narrowed WriteActionOutcomeOk[]. */
function getSuccessfulActions<T>(result: WriteResult<T>): WriteActionOutcomeOk<T>[];

/** Flatten all errors across all failed actions. */
function getAllErrors<T>(result: WriteResult<T>): WriteActionErrorContext<T>[];
```

These are the primary ergonomic API for accessing split results. The canonical
`actions` array preserves execution order; helpers provide pre-filtered, narrowed views.

### Zod Schemas (updated)

| Old Schema | New Schema |
|---|---|
| `WriteCommonErrorSchema` | `WriteActionErrorSchema` (same content, rename) |
| `FailedWriteActionSchema` / `SuccessfulWriteActionSchema` | `WriteActionOutcomeSchema` (discriminated union on `ok`) |
| `WriteActionsResponseOkSchema` / `WriteActionsResponseErrorSchema` | _(eliminated)_ |
| `WriteActionsResponseSchema` | `WriteResultSchema` |
| `SerializableCommonErrorSchema` (local) | _(removed, import from utils)_ |
| `FailedWriteActionAffectedItemSchema` | _(eliminated)_ |
| `WriteActionAffectedItemSchema` | Updated: `item_pk` + optional `item` |

### Files to Modify

**1. `src/write-actions/types.ts`** — New type definitions
- Define `WriteActionError` (rename from `WriteCommonError`)
- Define `WriteActionErrorContext<T>`
- Define `WriteActionAffectedItem<T>` (unified, generic)
- Define `WriteActionOutcomeOk<T>`, `WriteActionOutcomeFailed<T>`, `WriteActionOutcome<T>` (discriminated union on `ok`)
- Define `WriteResult<T>`
- Remove: `SerializableCommonError` (local), `WriteActionsResponseOk`, `WriteActionsResponseError`, `WriteActionsResponse`, `SuccessfulWriteAction`, `FailedWriteAction`, `FailedWriteActionAffectedItem`, `CombineWriteActionsWhereFiltersResponse`
- Keep: `WriteAction`, `WriteActionPayload*`, all payload-related types unchanged

**2. `src/write-actions/applyWritesToItems/types.ts`** — Update changes/result types
- Define `WriteChangesBase<T>`: `ObjectsDelta<T> & { changed: boolean }` — minimal base for any apply function
- `ApplyWritesToItemsChanges<T>`: extends `WriteChangesBase<T>` with `final_items: T[]` (required). Remove `referential_comparison_ok`
- `ApplyWritesToItemsResult<T>`: extends `WriteResult<T>` with `changes: ApplyWritesToItemsChanges<T>`
- Remove old `ApplyWritesToItemsResponse`

**3. `src/write-actions/write-action-schemas.ts`** — Update Zod schemas
- `WriteActionErrorSchema` (rename)
- `makeWriteActionOutcomeSchema<T>()` (unified)
- `WriteResultSchema` (new base)
- Remove old ok/error/failed/successful schemas
- Import `SerializableCommonErrorSchema` from `@andyrmitchell/utils` (no longer local)

**4. `src/write-actions/applyWritesToItems/helpers/WriteActionFailuresTracker.ts`** — Produce `WriteActionOutcomeFailed`
- Replace `FailedWriteAction<T>` → `WriteActionOutcomeFailed<T>` internally
- Replace `FailedWriteActionAffectedItem<T>` → `WriteActionAffectedItem<T>`
- Move error details from per-item `error_details[]` to flat `errors: WriteActionErrorContext<T>[]` on the action outcome, with `item_pk`/`item` on each error
- Remove duplication: each error pushed once

**5. `src/write-actions/applyWritesToItems/applyWritesToItems.ts`** — Produce new response shape
- `SuccessfulWriteActionesTracker`: produce `WriteActionOutcomeOk<T>` with `affected_items` including optional `item`
- Success path: return `{ok: true, actions: [...all outcomes], changes: ...}`
- Error path: return `{ok: false, actions: [...all outcomes], error: {message}, changes: ...}`
- Remove `referential_comparison_ok` from `generateApplyWritesToItemsChanges`

**6. `src/write-actions/index.ts`** — Update exports
- Export new types: `WriteResult`, `WriteActionOutcome`, `WriteActionOutcomeOk`, `WriteActionOutcomeFailed`, `WriteActionError`, `WriteActionErrorContext`, `WriteActionAffectedItem`, `WriteChangesBase`, `ApplyWritesToItemsResult`
- Export helpers: `getFailedActions`, `getSuccessfulActions`, `getAllErrors`
- Export new schemas: `WriteResultSchema`, `WriteActionErrorSchema`, `WriteActionOutcomeSchema`
- Re-export deprecated type aliases from `types-deprecated.ts`
- Re-export deprecated schema aliases from `schemas-deprecated.ts`
- Export `convertWriteResultToLegacy` converter function
- Remove `combineWriteActionsWhereFilters` export
- Update `WriteActions` namespace object to use new schema names (keep deprecated aliases available via direct import)

**7. `src/write-actions/combineWriteActionsWhereFilters.ts`** — Delete or mark deprecated

**8. `src/write-actions/types-deprecated.ts`** — Deprecated type aliases (NEW file)
- `WriteCommonError` → `WriteActionError`
- `SuccessfulWriteAction<T>` → `WriteActionOutcomeOk<T>`
- `FailedWriteAction<T>` → `WriteActionOutcomeFailed<T>`
- `FailedWriteActionAffectedItem<T>` → `WriteActionAffectedItem<T>`
- `WriteActionsResponse<T>` → `WriteResult<T>`
- `WriteActionsResponseOk` → stub `{ status: 'ok' }`
- `WriteActionsResponseError<T>` → `WriteResult<T> & { ok: false }`
- `ApplyWritesToItemsResponse<T>` → `ApplyWritesToItemsResult<T>`
- All with `@deprecated` JSDoc pointing to the replacement

**9. `src/write-actions/schemas-deprecated.ts`** — Deprecated schema aliases (NEW file)
- `WriteCommonErrorSchema` → `WriteActionErrorSchema`
- `FailedWriteActionSchema` / `SuccessfulWriteActionSchema` → extracted branches of `WriteActionOutcomeSchema`
- `WriteActionsResponseSchema` → `WriteResultSchema`
- `WriteActionsResponseOkSchema` / `WriteActionsResponseErrorSchema` → stubs or eliminated
- `makeFailedWriteActionSchema` / `makeSuccessfulWriteActionSchema` → deprecated wrappers
- All with `@deprecated` JSDoc

**10. `src/write-actions/convertWriteResultToLegacy.ts`** — Converter function (NEW file)
- `convertWriteResultToLegacy<T>(result: WriteResult<T>)` → old `WriteActionsResponse<T>` shape
- Reconstructs `status`, `message`, `successful_actions`, `failed_actions` (with per-item `error_details`) from the new flat structure
- Exported from `index.ts` for external consumers to use during migration

**11. `src/write-actions/applyWritesToItems/applyWritesToItems.test.ts`** — Update all assertions
- Replace `result.status === 'ok'` → `result.ok`
- Replace `result.failed_actions[n]` → `getFailedActions(result)[n]` (returns `WriteActionOutcomeFailed<T>[]` — narrowed, `errors` is required)
- Replace `result.successful_actions[n]` → `getSuccessfulActions(result)[n]` (returns `WriteActionOutcomeOk<T>[]`)
- Replace `.error_details[n].type` → `.errors[n].type` (no `?.` needed after narrowing via helper or `!a.ok` guard)
- Replace `.affected_items![n]!.error_details[n]!.type` → `.errors[n].type` (flat)
- Remove assertions on `referential_comparison_ok`
- Remove guard+throw boilerplate (data is always accessible)

### Implementation Order

1. Define new types in `types.ts` (remove old types from this file)
2. Update Zod schemas in `write-action-schemas.ts`
3. Update `ApplyWritesToItemsChanges` and `ApplyWritesToItemsResult` in `applyWritesToItems/types.ts`
4. Update `WriteActionFailuresTracker` to produce new shape
5. Update `SuccessfulWriteActionesTracker` to produce new shape
6. Update `applyWritesToItems` to return `ApplyWritesToItemsResult`
7. Add helper functions (`getFailedActions`, `getSuccessfulActions`, `getAllErrors`)
8. Create `types-deprecated.ts` — deprecated type aliases mapping old → new
9. Create `schemas-deprecated.ts` — deprecated schema aliases mapping old → new
10. Create `convertWriteResultToLegacy.ts` — converter function
11. Update `index.ts` exports (new types, new schemas, helpers, deprecated aliases, converter)
12. Delete `combineWriteActionsWhereFilters.ts` and its test
13. Update `applyWritesToItems.test.ts`
14. Run `npm typecheck`, `npm test`, `npm lint` — fix issues

# Breaking Changes Plan

## Extent of Breaking Change

**Within this repo**: All usage is internal to `src/write-actions/`. No files outside that directory import the response types directly. The only exposure is via barrel exports in `src/write-actions/index.ts` → `src/index.ts`.

**External consumers**: The `@andyrmitchell/store` package is the primary external consumer (documented in Phase 2). It uses:
- `WriteActionsResponse<T>` (aliased as `WriteResponse<T>`)
- `FailedWriteAction<T>` (constructed manually in `logWriteActions.ts`)
- `SuccessfulWriteAction<T>` (used in `ReadModifyWrite.ts`)
- `WriteCommonError` (pushed into `error_details`)
- Various schema exports (`WriteActionsResponseSchema`, etc.)

**Severity**: This is a **major** breaking change to the public API. All exported response types are renamed or restructured.

## Backward Compatibility Strategy

### 1. Deprecated Type Aliases

Create deprecated type aliases in `src/write-actions/types-deprecated.ts` that map old names → new types. Follow the existing `@deprecated` JSDoc pattern (seen in `whereClauseEngine.ts`).

```ts
// ─── types-deprecated.ts ───

import type { WriteActionError, WriteActionOutcome, WriteActionOutcomeFailed, WriteActionOutcomeOk, WriteResult } from './types.ts';

/** @deprecated Use `WriteActionError` instead. */
export type WriteCommonError = WriteActionError;

/** @deprecated Use `WriteActionOutcomeOk<T>` instead. */
export type SuccessfulWriteAction<T extends Record<string, any>> = WriteActionOutcomeOk<T>;

/** @deprecated Use `WriteActionOutcomeFailed<T>` instead. */
export type FailedWriteAction<T extends Record<string, any>> = WriteActionOutcomeFailed<T>;

/** @deprecated Eliminated. Use `WriteActionAffectedItem<T>` instead (now generic with optional `item`). */
export type { WriteActionAffectedItem as FailedWriteActionAffectedItem } from './types.ts';

/** @deprecated Use `WriteResult<T>` instead. */
export type WriteActionsResponse<T extends Record<string, any>> = WriteResult<T>;

/** @deprecated Eliminated. Check `result.ok === true` on `WriteResult<T>`. */
export type WriteActionsResponseOk = { status: 'ok' };

/** @deprecated Eliminated. Check `result.ok === false` on `WriteResult<T>`. */
export type WriteActionsResponseError<T extends Record<string, any>> = WriteResult<T> & { ok: false };
```

These aliases will be exported from `src/write-actions/index.ts` alongside the new types, so existing `import { FailedWriteAction } from '@andyrmitchell/objects'` continues to compile (with IDE deprecation warnings).

### 2. Converter Function

A `convertWriteResultToLegacy` function converts the new `WriteResult<T>` shape back to the old `WriteActionsResponse<T>` shape. This lets external consumers migrate incrementally.

```ts
import type { WriteResult, WriteActionOutcomeFailed, WriteActionOutcomeOk } from './types.ts';
import { getFailedActions, getSuccessfulActions } from './helpers.ts';

type LegacyWriteActionsResponse<T extends Record<string, any>> =
  | { status: 'ok' }
  | {
      status: 'error';
      message: string;
      successful_actions: { action: WriteAction<T>; affected_items?: { item_pk: PrimaryKeyValue }[] }[];
      failed_actions: {
        action: WriteAction<T>;
        error_details: WriteActionError[];
        unrecoverable?: boolean;
        back_off_until_ts?: number;
        blocked_by_action_uuid?: string;
        affected_items?: { item_pk: PrimaryKeyValue; item: T; error_details: WriteActionError[] }[];
      }[];
    };

/** Convert new WriteResult<T> to old WriteActionsResponse<T> shape for backward compat. */
function convertWriteResultToLegacy<T extends Record<string, any>>(
  result: WriteResult<T>
): LegacyWriteActionsResponse<T> {
  if (result.ok) {
    return { status: 'ok' };
  }
  return {
    status: 'error',
    message: result.error?.message ?? 'Some write actions failed.',
    successful_actions: getSuccessfulActions(result).map(a => ({
      action: a.action,
      affected_items: a.affected_items,
    })),
    failed_actions: getFailedActions(result).map(a => ({
      action: a.action,
      error_details: a.errors.map(e => {
        const { item_pk, item, ...error } = e;
        return error;
      }),
      unrecoverable: a.unrecoverable,
      back_off_until_ts: a.back_off_until_ts,
      blocked_by_action_uuid: a.blocked_by_action_uuid,
      // Reconstruct per-item error grouping from flat errors array
      affected_items: a.affected_items
        ?.filter(ai => a.errors.some(e => e.item_pk === ai.item_pk))
        .map(ai => ({
          item_pk: ai.item_pk,
          item: ai.item as T,
          error_details: a.errors
            .filter(e => e.item_pk === ai.item_pk)
            .map(e => { const { item_pk, item, ...error } = e; return error; }),
        })),
    })),
  };
}
```

### 3. Schema Backward Compat

Old schema names re-exported with `@deprecated`:

```ts
/** @deprecated Use `WriteActionErrorSchema` instead. */
export const WriteCommonErrorSchema = WriteActionErrorSchema;

/** @deprecated Use `WriteActionOutcomeSchema` instead. */
export const FailedWriteActionSchema = /* extract failed branch from WriteActionOutcomeSchema */;
export const SuccessfulWriteActionSchema = /* extract ok branch */;

/** @deprecated Use `WriteResultSchema` instead. */
export const WriteActionsResponseSchema = WriteResultSchema;
```

### 4. Existing `index-old-types.ts` Precedent

The codebase already has `src/write-actions/index-old-types.ts` with an even older generation of types (`WriteActionFailures`, `AppliedWritesOutput`, etc.) and its own `tsup` entry point. This confirms the pattern of maintaining legacy aliases. The new deprecated aliases can live in `types-deprecated.ts` and be re-exported from `index.ts`.

### 5. Migration Path for `@andyrmitchell/store`

| Store usage | Migration |
|---|---|
| `WriteResponse<T>` (alias for `WriteActionsResponse<T>`) | Change to `WriteResult<T>`. Access `result.ok` instead of `result.status`. |
| `FailedWriteAction<T>` construction in `logWriteActions.ts` | Construct `WriteActionOutcomeFailed<T>` with `ok: false, errors: [...]` instead of `error_details: [...]`. |
| `SuccessfulWriteAction<T>` in `ReadModifyWrite.ts` | Use `WriteActionOutcomeOk<T>`. |
| `ActionOutcomesForUnexpectedError` iterating `successful_actions`/`failed_actions` | Use `result.actions` directly or `getSuccessfulActions()`/`getFailedActions()`. |
| Schema validation at serialization boundaries | Swap schema names. |

### 6. Recommended Rollout

1. Publish `@andyrmitchell/objects` with both new types AND deprecated aliases.
2. Update `@andyrmitchell/store` to use new types (or use `convertWriteResultToLegacy` as a temporary bridge).
3. After store is migrated, remove deprecated aliases in a subsequent major version.

# Project Plan

_Instructions: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [x] Phase 1

Analyse the current type system and how it's used deeply. Write it up your summary/context in `Current Response Type Summary`. Be looking for sufficient information to help identify what is good and should be preserved, and what is bad/brittle (we'll return to this later).

# [x] Phase 2


Identify what a consumer (developer) of this library will want to do: what are their common cases when something goes well, and when something goes poorly (errors to handle, it failed at some point - they may want to do some kind of recovery, or convert it into logs in their system).

Identify strengths and weaknsesses of the current type system.

Additionally, make sure you include some strong opinions I have:
- `referential_comparison_ok` is REMOVED from the response type entirely
- `final_items` is OPTIONAL in the response type. It's always provided by `applyWritesToItems`, but future apply functions may not. 
- The way it stacks `FailedWriteAction`/`WriteCommonError` has proven to be unpleasant in the past, because it always needs a lot of handling code to extract the exact details a consumer needs to evaluate it and act on it. It's not conceptually clean for a developer either. 
- There's further muddle between `WriteActionAffectedItem` `FailedWriteActionAffectedItem` etc. It smells of organic changes rather than clear thinking based on expected use cases.
- CombineWriteActionsWhereFiltersResponse doesn't appear to be used and can be dropped 
- WriteActionsResponse was built on a discriminated union (first check .success before accessing data). I now prefer the style where `success` is present, but data/error can be checked at any time with `.data?` 

Output this to `Use Cases, Pros and Cons of Response Types`

# [x] Phase 3

Write a plan for a much better response type structure that designs a clean system around use cases, considers keeping pros, and tries to drop cons/weaknesses in `Use Cases, Pros and Cons of Response Types`. 

Output to `Implementation Plan`.

# [x] Phase 3a

Some small ammendments to discuss on the `Implementation Plan`...

```markdown
## Final Items ambiguity 
While `final_items` is optional, there should be a firmer type specifically for `applyWritesToItems` that returns it. Don't use omit. Tell me how you'd do this and discuss it prior to updating the plan. 


## Loss of Type Safety on WriteActionOutcome<T>
The Plan: You flattened WriteActionOutcome<T> into a single interface where ok: boolean sits next to optional fields like errors?: WriteActionErrorContext<T>[].
The Problem: By abandoning the discriminated union at the action level, you lose TypeScript's ability to narrow. If a consumer writes if (!action.ok), TypeScript still thinks action.errors might be undefined. They will be forced to write action.errors?.[0] or action.errors!. You are trading the if (status !== 'ok') throw boilerplate for optional-chaining/non-null boilerplate.
The Fix: Use a discriminated union for the Outcome, while keeping the top-level result flat. This is the best of both worlds.

## Merging successful_actions and failed_actions into actions
The Plan: Combine all actions into a single actions: WriteActionOutcome<T>[] array.
The Problem: In your "Consumer Access Patterns", you note that developers often want to check failures or successes separately. Forcing them to run .filter(a => a.ok) every time they need to isolate failures is an ergonomic regression. Furthermore, in non-atomic bulk operations, looping through 10,000 successful actions just to find the 2 failures adds unnecessary runtime overhead.
The Opportunity: Keep the single actions array if order matters, but strongly consider providing successful_actions and failed_actions arrays (or getters) on the top-level WriteResult<T>.


```



I want to discuss each of these points with you. Push back on me if you think it should be challenged. 

# [x] Phase 4

Briefly consider the extent of the breaking change. Would it be possible to create a converter function that converts the new type into the old type format, and still output the old types with DEPRECATED suffixed naming?

Output to `Breaking Changes Plan`

# [ ] Phase 5

Implement the plan in `Implementation Plan`