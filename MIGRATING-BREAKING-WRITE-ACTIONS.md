# Migrating Write-Action Response Types

This document describes how to update a codebase that uses `applyWritesToItems` (or any API returning `WriteActionsResponse`) from the old response types to the new ones.

It is written as instructions for an LLM performing the migration, but is equally useful as a human reference.

## Overview of the Change

The response type system was redesigned for ergonomic, flat access. The key changes:

1. **`status: 'ok' | 'error'` discriminated union replaced with flat `ok: boolean`** — data is always accessible without narrowing.
2. **`successful_actions` and `failed_actions` merged into a single `actions` array** — each entry is a discriminated union on `ok`. Use helper functions `getFailedActions()` / `getSuccessfulActions()` for filtered access.
3. **Error details flattened** — old `FailedWriteAction.error_details` + `FailedWriteActionAffectedItem.error_details` duplication replaced by a single `errors: WriteActionErrorContext<T>[]` on `WriteActionOutcomeFailed`.
4. **Affected item types unified** — `WriteActionAffectedItem` and `FailedWriteActionAffectedItem` merged into one generic `WriteActionAffectedItem<T>`.
5. **`referential_comparison_ok` removed** from `ApplyWritesToItemsChanges`.
6. **`CombineWriteActionsWhereFiltersResponse` dropped** (was unused dead code).
7. **`SerializableCommonError` removed** from the response surface — replaced by a lightweight `error?: { message: string }`.

---

## Type Mapping: Old → New

| Old Type | New Type | Notes |
|---|---|---|
| `WriteActionsResponse<T>` | `WriteResult<T>` | No longer a discriminated union. `ok` is informational. |
| `WriteActionsResponseOk` | _(eliminated)_ | Just `WriteResult` with `ok: true` |
| `WriteActionsResponseError<T>` | _(eliminated)_ | Just `WriteResult` with `ok: false` |
| `SuccessfulWriteAction<T>` | `WriteActionOutcomeOk<T>` | Discriminated union branch (`ok: true`) |
| `FailedWriteAction<T>` | `WriteActionOutcomeFailed<T>` | Discriminated union branch (`ok: false`) |
| `WriteCommonError` | `WriteActionError` | Renamed. Same discriminated union on `type`. |
| `WriteActionAffectedItem` (non-generic) | `WriteActionAffectedItem<T>` | Now generic, has optional `item?: T` |
| `FailedWriteActionAffectedItem<T>` | _(eliminated)_ | Merged into `WriteActionAffectedItem<T>` |
| `ApplyWritesToItemsResponse<T>` | `ApplyWritesToItemsResult<T>` | `changes` always present, no narrowing needed |
| `ApplyWritesToItemsChanges<T>` | `ApplyWritesToItemsChanges<T>` | Same name. `referential_comparison_ok` removed. |
| `CombineWriteActionsWhereFiltersResponse<T>` | _(dropped)_ | Dead code, no replacement. |

### Schema Mapping

| Old Schema | New Schema |
|---|---|
| `WriteCommonErrorSchema` | `WriteActionErrorSchema` |
| `SuccessfulWriteActionSchema` | `WriteActionOutcomeOkSchema` |
| `makeSuccessfulWriteActionSchema` | `makeWriteActionOutcomeOkSchema` |
| `FailedWriteActionSchema` | `WriteActionOutcomeFailedSchema` |
| `makeFailedWriteActionSchema` | `makeWriteActionOutcomeFailedSchema` |
| `WriteActionsResponseSchema` | `WriteResultSchema` |
| `WriteActionsResponseOkSchema` | _(eliminated; use `WriteResultSchema`)_ |
| `WriteActionsResponseErrorSchema` | _(eliminated; use `WriteResultSchema`)_ |

### New Helper Functions

These are the primary ergonomic API. Import them alongside `applyWritesToItems`:

```ts
import { getFailedActions, getSuccessfulActions, getAllErrors } from '@anthropic/objects/write-actions';

// Returns WriteActionOutcomeFailed<T>[] — already narrowed
getFailedActions(result)

// Returns WriteActionOutcomeOk<T>[] — already narrowed
getSuccessfulActions(result)

// Returns WriteActionErrorContext<T>[] — all errors flattened across all failed actions
getAllErrors(result)
```

---

## Migration Steps (for an LLM)

### Step 1: Update imports

Search for all imports from the write-actions module and update type names.

**Find:**
```ts
import type { WriteActionsResponse, WriteActionsResponseOk, WriteActionsResponseError,
  SuccessfulWriteAction, FailedWriteAction, WriteCommonError,
  WriteActionAffectedItem, FailedWriteActionAffectedItem,
  ApplyWritesToItemsResponse, ApplyWritesToItemsChanges } from '...'
```

**Replace with:**
```ts
import type { WriteResult, WriteActionOutcomeOk, WriteActionOutcomeFailed, WriteActionOutcome,
  WriteActionError, WriteActionErrorContext, WriteActionAffectedItem,
  ApplyWritesToItemsResult, ApplyWritesToItemsChanges } from '...'
```

Also import the helper functions where needed:
```ts
import { getFailedActions, getSuccessfulActions, getAllErrors } from '...'
```

**Specific renames:**
- `WriteActionsResponse<T>` → `WriteResult<T>`
- `WriteActionsResponseOk` → remove (use `WriteResult` with `ok: true`)
- `WriteActionsResponseError<T>` → remove (use `WriteResult` with `ok: false`)
- `SuccessfulWriteAction<T>` → `WriteActionOutcomeOk<T>`
- `FailedWriteAction<T>` → `WriteActionOutcomeFailed<T>`
- `WriteCommonError` → `WriteActionError`
- `FailedWriteActionAffectedItem<T>` → `WriteActionAffectedItem<T>`
- `ApplyWritesToItemsResponse<T>` → `ApplyWritesToItemsResult<T>`

### Step 2: Update the status check pattern

The old code used a discriminated union on `status`:

**Old (35+ instances typical):**
```ts
expect(result.status).toBe('ok');
if (result.status !== 'ok') throw new Error("noop");
// now TS narrows
result.changes.final_items ...
```

**New:**
```ts
expect(result.ok).toBe(true);
result.changes.final_items ... // accessible without narrowing on ApplyWritesToItemsResult
```

For error checks:

**Old:**
```ts
expect(result.status).toBe('error');
if (result.status !== 'error') throw new Error("noop");
result.failed_actions[0]! ...
```

**New:**
```ts
expect(result.ok).toBe(false);
const failures = getFailedActions(result);
failures[0]! ...
```

**Key insight**: With `ApplyWritesToItemsResult`, `changes` is always present on the type — no narrowing needed. You can access `result.changes.final_items` regardless of `result.ok`.

### Step 3: Update `successful_actions` / `failed_actions` access

The old type had separate `successful_actions` and `failed_actions` arrays directly on the response. The new type has a single `actions` array with discriminated outcomes.

**Old:**
```ts
result.successful_actions[0]!.action.uuid
result.successful_actions[0]!.affected_items![0]!.item_pk
result.successful_actions.length

result.failed_actions[0]!.action.uuid
result.failed_actions[0]!.error_details[0]!.type
result.failed_actions.length
```

**New:**
```ts
const successes = getSuccessfulActions(result);
successes[0]!.action.uuid
successes[0]!.affected_items![0]!.item_pk
successes.length

const failures = getFailedActions(result);
failures[0]!.action.uuid
failures[0]!.errors[0]!.type    // note: .errors not .error_details
failures.length
```

**Search-replace pattern for `result.successful_actions`:**
1. Add `const successes = getSuccessfulActions(result);` before first use.
2. Replace `result.successful_actions` → `successes`.

**Search-replace pattern for `result.failed_actions`:**
1. Add `const failures = getFailedActions(result);` before first use.
2. Replace `result.failed_actions` → `failures`.

### Step 4: Update error detail access

The old system had `error_details: WriteCommonError[]` on both the action and the affected item. The new system has `errors: WriteActionErrorContext<T>[]` only on the failed outcome.

**Old — action-level errors:**
```ts
result.failed_actions[0]!.error_details[0]!.type
result.failed_actions[0]!.error_details[0]!.type === 'missing_key'
```

**New — same data, renamed:**
```ts
const failures = getFailedActions(result);
failures[0]!.errors[0]!.type
failures[0]!.errors[0]!.type === 'missing_key'
```

**Old — item-level errors (the duplicated errors):**
```ts
result.failed_actions[0]!.affected_items![0]!.error_details[0]!.type
```

**New — errors are flat on the outcome, enriched with item context:**
```ts
const failures = getFailedActions(result);
// Each error in .errors may have .item_pk and .item for context
failures[0]!.errors[0]!.type
failures[0]!.errors[0]!.item_pk  // was on the affected_item, now on the error itself
failures[0]!.errors[0]!.item     // the offending item, right on the error
```

The key difference: old code drilled through `affected_items[n].error_details[n]` to get per-item errors. New code has errors flat on the outcome with `item_pk` and `item` directly on the error via `WriteActionErrorContext<T>`.

If old code was iterating affected items to find their specific errors, the new pattern is:
```ts
// Old:
for (const affectedItem of failedAction.affected_items ?? []) {
  for (const error of affectedItem.error_details) {
    console.log(error.type, affectedItem.item_pk, affectedItem.item);
  }
}

// New:
for (const error of failedOutcome.errors) {
  console.log(error.type, error.item_pk, error.item);
}
```

### Step 5: Update affected item types

**Old:**
```ts
// Non-generic, no item
type WriteActionAffectedItem = { item_pk: PrimaryKeyValue }

// Generic, with item and error_details
type FailedWriteActionAffectedItem<T> = WriteActionAffectedItem & {
  item: T;
  error_details: WriteCommonError[];
}
```

**New:**
```ts
// Single unified generic type
type WriteActionAffectedItem<T> = {
  item_pk: PrimaryKeyValue;
  item?: T;  // optional, provided when available
}
// No error_details on affected items — errors live on WriteActionOutcomeFailed.errors
```

If code references `FailedWriteActionAffectedItem`, replace with `WriteActionAffectedItem<T>` and note that `error_details` is no longer on the affected item — it's on the parent `WriteActionOutcomeFailed.errors` array.

### Step 6: Remove `referential_comparison_ok`

This property was removed from `ApplyWritesToItemsChanges`. Delete any code that reads it:

**Old:**
```ts
expect(result.changes.referential_comparison_ok).toBe(true);
if (result.changes.referential_comparison_ok) { ... }
```

**New:**
```ts
// Removed entirely. If you need this info, compute it from the options you passed:
// referential_comparison_ok = !options.mutate || isImmerDraft(items)
```

### Step 7: Update `message` field access

**Old:**
```ts
// On the error branch, message came from SerializableCommonError
if (result.status === 'error') {
  console.log(result.message);  // always "Some write actions failed."
}
```

**New:**
```ts
if (!result.ok) {
  console.log(result.error?.message);  // "Some write actions failed." or undefined
}
```

### Step 8: Update type aliases for `WriteActionsResponse` in wrapper types

If your code defines type aliases around the old response:

**Old:**
```ts
type WriteResponse<T> = WriteActionsResponse<T>;
// or
type MyResult<T> = ApplyWritesToItemsResponse<T>;
```

**New:**
```ts
type WriteResponse<T> = WriteResult<T>;
// or
type MyResult<T> = ApplyWritesToItemsResult<T>;
```

### Step 9: Update manual construction of response/failure objects

If code manually constructs `FailedWriteAction` objects (e.g. for logging or error wrapping):

**Old:**
```ts
const failure: FailedWriteAction<T> = {
  action: writeAction,
  error_details: [{ type: 'custom', message: 'Something went wrong' }],
  unrecoverable: true,
  affected_items: [{ item_pk: '123', item: theItem, error_details: [{ type: 'custom', message: 'Something went wrong' }] }]
};
```

**New:**
```ts
const failure: WriteActionOutcomeFailed<T> = {
  ok: false,
  action: writeAction,
  errors: [{ type: 'custom', message: 'Something went wrong', item_pk: '123', item: theItem }],
  unrecoverable: true,
  affected_items: [{ item_pk: '123', item: theItem }]
};
```

Note:
- Added `ok: false`
- `error_details` → `errors` (with `WriteActionErrorContext<T>` shape: error + `item_pk?` + `item?`)
- `affected_items` no longer carries `error_details`

For constructing success objects:

**Old:**
```ts
const success: SuccessfulWriteAction<T> = {
  action: writeAction,
  affected_items: [{ item_pk: '123' }]
};
```

**New:**
```ts
const success: WriteActionOutcomeOk<T> = {
  ok: true,
  action: writeAction,
  affected_items: [{ item_pk: '123' }]
};
```

### Step 10: Update manual construction of full responses

If code constructs `WriteActionsResponse` or `WriteActionsResponseError` manually:

**Old:**
```ts
const response: WriteActionsResponseError<T> = {
  status: 'error',
  message: 'Some write actions failed.',
  name: 'WriteError',
  successful_actions: [...],
  failed_actions: [...]
};
```

**New:**
```ts
const response: WriteResult<T> = {
  ok: false,
  actions: [...successOutcomes, ...failedOutcomes],  // single array, all outcomes
  error: { message: 'Some write actions failed.' }
};
```

### Step 11: Update schema usage

**Old:**
```ts
import { WriteCommonErrorSchema, WriteActionsResponseSchema, FailedWriteActionSchema } from '...';

WriteActionsResponseSchema.parse(data);
WriteCommonErrorSchema.parse(errorData);
```

**New:**
```ts
import { WriteActionErrorSchema, WriteResultSchema, WriteActionOutcomeFailedSchema } from '...';

WriteResultSchema.parse(data);
WriteActionErrorSchema.parse(errorData);
```

### Step 12: Remove `combineWriteActionsWhereFilters` usage

If any code imports or calls `combineWriteActionsWhereFilters`, it must be removed or replaced. This function and its response type `CombineWriteActionsWhereFiltersResponse` have been dropped entirely.

---

## Common Patterns: Before and After

### Pattern 1: Happy path — check success and access items

**Before:**
```ts
const result = applyWritesToItems(actions, items, schema, ddl);
expect(result.status).toBe('ok');
if (result.status !== 'ok') throw new Error('noop');
expect(result.changes.final_items.length).toBe(2);
expect(result.changes.insert.length).toBe(1);
expect(result.successful_actions.length).toBe(1);
expect(result.successful_actions[0]!.action.uuid).toBe('0');
expect(result.successful_actions[0]!.affected_items![0]!.item_pk).toBe('1');
```

**After:**
```ts
const result = applyWritesToItems(actions, items, schema, ddl);
expect(result.ok).toBe(true);
expect(result.changes.final_items.length).toBe(2);
expect(result.changes.insert.length).toBe(1);
const successes = getSuccessfulActions(result);
expect(successes.length).toBe(1);
expect(successes[0]!.action.uuid).toBe('0');
expect(successes[0]!.affected_items![0]!.item_pk).toBe('1');
```

### Pattern 2: Error path — check failure and inspect errors

**Before:**
```ts
const result = applyWritesToItems(actions, items, schema, ddl);
expect(result.status).toBe('error');
if (result.status !== 'error') throw new Error('noop');
const firstFailedAction = result.failed_actions[0]!;
expect(firstFailedAction.error_details[0]!.type).toBe('missing_key');
expect(firstFailedAction.unrecoverable).toBe(true);
expect(firstFailedAction.affected_items![0]!.error_details[0]!.type).toBe('missing_key');
expect(firstFailedAction.affected_items![0]!.item.id).toBe('bad');
```

**After:**
```ts
const result = applyWritesToItems(actions, items, schema, ddl);
expect(result.ok).toBe(false);
const failures = getFailedActions(result);
const firstFailure = failures[0]!;
expect(firstFailure.errors[0]!.type).toBe('missing_key');
expect(firstFailure.unrecoverable).toBe(true);
// Item context is now on the error itself:
expect(firstFailure.errors[0]!.item_pk).toBeDefined();
expect(firstFailure.errors[0]!.item?.id).toBe('bad');
// Or access affected_items separately:
expect(firstFailure.affected_items![0]!.item?.id).toBe('bad');
```

### Pattern 3: Partial success (non-atomic) — mixed outcomes

**Before:**
```ts
const result = applyWritesToItems(actions, items, schema, ddl, user, { atomic: false });
expect(result.status).toBe('error');
if (result.status !== 'error') throw new Error('noop');
expect(result.failed_actions.length).toBe(1);
expect(result.successful_actions.length).toBe(2);
expect(result.changes.final_items.length).toBe(1);
```

**After:**
```ts
const result = applyWritesToItems(actions, items, schema, ddl, user, { atomic: false });
expect(result.ok).toBe(false);
expect(getFailedActions(result).length).toBe(1);
expect(getSuccessfulActions(result).length).toBe(2);
expect(result.changes.final_items.length).toBe(1);  // no narrowing needed
```

### Pattern 4: Building a per-action outcome map

**Before:**
```ts
// From store's ActionOutcomesForUnexpectedError pattern
const outcomeMap: Record<string, 'success' | 'failed'> = {};
if (result.status === 'error') {
  for (const s of result.successful_actions) outcomeMap[s.action.uuid] = 'success';
  for (const f of result.failed_actions) outcomeMap[f.action.uuid] = 'failed';
}
```

**After:**
```ts
const outcomeMap = Object.fromEntries(
  result.actions.map(a => [a.action.uuid, a.ok ? 'success' : 'failed'])
);
```

### Pattern 5: Logging / lifecycle reporting

**Before:**
```ts
function logResult<T>(result: WriteActionsResponse<T>) {
  if (result.status === 'error') {
    console.error(result.message);
    for (const f of result.failed_actions) {
      console.error(`Action ${f.action.uuid} failed:`, f.error_details);
    }
  }
}
```

**After:**
```ts
function logResult<T>(result: WriteResult<T>) {
  if (!result.ok) {
    console.error(result.error?.message);
    for (const f of getFailedActions(result)) {
      console.error(`Action ${f.action.uuid} failed:`, f.errors);
    }
  }
}
```

### Pattern 6: Checking specific error types

**Before:**
```ts
if (result.status === 'error') {
  const schemaErrors = result.failed_actions
    .flatMap(f => f.error_details)
    .filter(e => e.type === 'schema');
}
```

**After:**
```ts
const schemaErrors = getAllErrors(result).filter(e => e.type === 'schema');
// Each error also has .item_pk and .item if available
```

### Pattern 7: Type alias wrapping (e.g. in store package)

**Before:**
```ts
type WriteResponse<T> = WriteActionsResponse<T>;

function handleResponse<T>(response: WriteResponse<T>) {
  if (response.status === 'error') {
    response.failed_actions.forEach(f => { ... });
  }
}
```

**After:**
```ts
type WriteResponse<T> = WriteResult<T>;

function handleResponse<T>(response: WriteResponse<T>) {
  if (!response.ok) {
    getFailedActions(response).forEach(f => { ... });
  }
}
```

---

## Quick Reference: Property Name Changes

| Old Property Path | New Property Path |
|---|---|
| `result.status` | `result.ok` |
| `result.status === 'ok'` | `result.ok === true` (or just `result.ok`) |
| `result.status === 'error'` | `result.ok === false` (or `!result.ok`) |
| `result.message` | `result.error?.message` |
| `result.successful_actions` | `getSuccessfulActions(result)` |
| `result.failed_actions` | `getFailedActions(result)` |
| `failedAction.error_details` | `failedOutcome.errors` |
| `failedAction.affected_items[n].error_details` | `failedOutcome.errors` (item context on error itself) |
| `failedAction.affected_items[n].item` | `failedOutcome.affected_items[n].item` or `failedOutcome.errors[n].item` |
| `result.changes.referential_comparison_ok` | _(removed)_ |
