# Migrating Write-Action Response Types

This document describes how to update a codebase that uses `applyWritesToItems` (or any API returning `WriteActionsResponse`) from the old response types to the new ones.

It is written as instructions for an LLM performing the migration, but is equally useful as a human reference.

> ⚠️ **Breaking (action identity & slim errors).** A per-action outcome identifies its action by **`action_uuid: string`**; the full `action: WriteAction` is not echoed on `WriteOutcomeOkCore` / `WriteOutcomeFailedCore` (nor on the full `WriteOutcomeOk` / `WriteOutcomeFailed`). Read `outcome.action_uuid` and reconcile against the `uuid`s you submitted. Error context is slimmer: `WriteErrorContext` carries no `item` (keep `item_pk`), and the `schema` `WriteError` carries no `tested_item`. The resolved offending row rides `WriteOutcomeFailed.tested_item` — the full in-process outcome only, never a `*Core` — a raw diagnostic for a logger to redact; its Zod `issues` are JSON-safe by construction, and `WriteActionFailuresTracker.get()` returns the live outcomes without JSON-normalisation. Any older example below that reads `outcome.action.uuid`, an error's `item`, or a schema error's `tested_item` reflects the prior shape. `WriteErrorContext` is also no longer generic — its `<T>` was unused (it carries only scalar locators: a `WriteError` plus an optional `item_pk`), so replace `WriteErrorContext<T>` with `WriteErrorContext`.

> ⚠️ **Superseded — ownership/permissions fully removed.** A later **major** version removed the built-in ownership/permission layer entirely; authorization now lives upstream in Casl (compiled to `WhereFilterDefinition` + `WriteActions`, which reach this library already authorized). The following no longer exist: the `ddl.ownership` field, the `@andyrmitchell/objects/ownership` sub-path, `checkOwnership` / `prepareOwnershipWhereClause` / `OwnershipRule` / `IUser` / `isIUser` / `checkWritePermission`, the `user` parameter on `writeToItemsArray` and `writeToItemsArrayPreserveInputType`, the `enforce_ownership` option, and the `permission_denied` `WriteError` (and `CorePermissionDeniedReason`). Items 15–18 below introduced ownership and are kept only as history — any example that passes a `user` argument, sets `ddl.ownership`, references `checkWritePermission` / `checkOwnership`, or inspects a `permission_denied` error reflects that interim state and no longer applies.

> ⚠️ **Breaking (`undefined` no longer removes a key).** An `undefined` value in `update.data` used to delete that key, via the exported sentinel `VALUE_TO_DELETE_KEY`. Both are gone: `VALUE_TO_DELETE_KEY` is no longer exported, and an explicit `undefined` at any depth of `create.data` or `update.data` is rejected up-front as an unrecoverable `invalid_data_value` — nothing is written, and the error carries the offending `data_path` plus a `message` naming the remedy. Rewrite each call site to the verb that says what it meant: `{ type: 'delete_property', path, where }` removes the key, and `{ type: 'set_property_undefined', path, where }` keeps the key present holding `undefined`. Both survive JSON, which the old spelling did not — `JSON.stringify` erased the key, so a stored or forwarded action silently degraded into one that changed nothing; such an action now fails loudly instead of quietly doing nothing. Both verbs take a full escaped dot-prop path and refuse a property the schema requires, a property holding an array of objects, or the primary key (`invalid_property_path`). See the README section "Writes, `undefined`, `null`, and removing a property" for the whole contract.

> ⚠️ **Breaking, compile-time only (`add_to_set` `unique_by: 'pk'` needs an element with a key).** `pk` uniqueness decides membership by reading one field off each element, so `WritePayloadAddToSet` offers it only where the element type names a field to read. On an array of objects that name their keys — or one whose element is `unknown`, `any`, or an open `Record` — both rules stay available and nothing changes. On an array of scalars, an array of arrays, an array whose element type names no key at all (an empty object type, a record declaring no keys, or a union of objects sharing none), or an array whose element may arrive as either an object or a scalar, `unique_by` now admits `'deep_equals'` alone. Runtime behaviour is untouched: the Zod action schema still accepts either word, and the engine still refuses `pk` against a non-object element as a recoverable error that leaves the array as it was — so an untyped caller gets the same verdict it always did, and only a typed call site that was already destined to fail stops compiling. Fix such a call site by comparing those elements by value (`unique_by: 'deep_equals'`), which is the only rule a keyless element can be measured by.

> ⚠️ **Breaking (a list's elements are now judged as closely as an item's fields).** The parse gate built by `makeWriteActionSchema` walks the `items` of a `push` and an `add_to_set` for values a write action cannot carry, which it previously admitted while the engine went on to refuse them per write. A `Date`, a `bigint`, a non-finite number, or a structure that leads back into itself is now rejected at whatever depth of an element it was written, each located as `['items', <index>, …]`. An explicit `undefined` **element** is rejected too — by the gate and by the engine, which reports it as an unrecoverable `invalid_data_value` at `<path>.<index>` — because a list has no absent position for it to become and `JSON.stringify` writes `null` in its place; the payload type withholds it as well, so `items` no longer accepts `undefined` even where the element type admits one. An `undefined` **key inside** an element is still admitted, deliberately: those elements are compared by deep equality, which reads an absent key and an `undefined` one alike. Two smaller consequences: an accepted action now carries the caller's own `items` array by reference, as `data` already did, rather than a rebuilt copy of it; and `items` that is not a list at all reports a `custom` issue naming the fault instead of Zod's `invalid_type`. Fix a rejected write by leaving the element out of the list, or by writing `null` if that is the value meant.

> ⚠️ **Fixed (proxy-wrapped `items` no longer throw mid-write).** `push` and `add_to_set` copy the elements they store, and that copy is now taken by a deep read of the values rather than by `structuredClone`. A list composed behind a proxy — an Immer draft, a framework's reactive object — is plain data that round-trips JSON, so the gate accepts it; it used to reach the engine and throw `DataCloneError` from inside the mutation. Nothing changes for a plain array, and the separation the copy exists for is unchanged: a stored element is never the element the action carries.

## Overview of the Change

The response type system was redesigned for ergonomic, flat access. The key changes:

1. **`status: 'ok' | 'error'` discriminated union replaced with flat `ok: boolean`** — data is always accessible without narrowing.
2. **`successful_actions` and `failed_actions` merged into a single `actions` array** — each entry is a discriminated union on `ok`. Use helper functions `getWriteFailures()` / `getWriteSuccesses()` for filtered access.
3. **Error details flattened** — old `FailedWriteAction.error_details` + `FailedWriteActionAffectedItem.error_details` duplication replaced by a single `errors: WriteErrorContext<T>[]` on `WriteOutcomeFailed`.
4. **Affected item types unified** — `WriteActionAffectedItem` and `FailedWriteActionAffectedItem` merged into one generic `WriteAffectedItem<T>`.
5. **`referential_comparison_ok` removed** from `WriteToItemsArrayChanges` (was `ApplyWritesToItemsChanges`).
6. **`CombineWriteActionsWhereFiltersResponse` replaced by `CombineWriteActionsWhereFiltersResult`** — the function is unchanged in purpose; only its result type was renamed and reshaped.
7. **`SerializableCommonError` removed** from the response surface — replaced by a lightweight `error?: { message: string }`.
8. **Deprecated type aliases removed** — `WriteCommonError`, `SuccessfulWriteAction`, `FailedWriteAction`, `FailedWriteActionAffectedItem`, `WriteActionsResponse`, `WriteActionsResponseOk`, `WriteActionsResponseError`, `ApplyWritesToItemsResponse` are no longer exported. Use the new names directly.
9. **Deprecated schema aliases removed** — `WriteCommonErrorSchema`, `SuccessfulWriteActionSchema`, `FailedWriteActionSchema`, `WriteActionsResponseSchema`, `WriteActionsResponseOkSchema`, `WriteActionsResponseErrorSchema` are no longer exported. Use the new names directly.
10. **`WriteActions` namespace object removed** — import functions and schemas individually (tree-shakeable).
11. **`convertWriteResultToLegacy` removed** — no backward compatibility shim; migrate directly to the new types.
12. **`./write-actions-old-types` sub-path removed** — the legacy generation-old type system is gone entirely.
13. **Naming convention pass** — all types, schemas, and functions renamed for consistency under the `Write` prefix. See tables below for the full mapping.
14. **`attempt_recover_duplicate_create: 'if-identical'` renamed to `'if-convergent'`** — the old name was misleading; the actual semantics are subset-convergence, not strict identity.
15. **`ddl.permissions` renamed to `ddl.ownership`** — `DDLPermissions`, `DDLPermissionProperty`, `DDLPermissionsSchema`, `DDLPermissionPropertySchema` removed. Use `OwnershipRule` from `@andyrmitchell/objects/ownership`.
16. **`type: 'basic_ownership_property'` renamed to `type: 'basic'`** — simpler discriminant now that ownership is its own module.
17. **`checkWritePermission` removed from public API** — use `checkOwnership` from `@andyrmitchell/objects/ownership` instead. Returns `OwnershipCheckResult` (not `WriteError`).
18. **New `@andyrmitchell/objects/ownership` sub-path** — exports `checkOwnership`, `prepareOwnershipWhereClause`, `OwnershipRule`, `IUser`, and standard test utilities.

> _Items 15–18 are **superseded**: ownership has since been removed entirely (see the notice at the top of this document). They remain only to document the interim state._

---

## Type Mapping: Old → New

| Old Type | New Type | Notes |
|---|---|---|
| `WriteActionsResponse<T>` | `WriteResult<T>` | No longer a discriminated union. `ok` is informational. |
| `WriteActionsResponseOk` | _(eliminated)_ | Just `WriteResult` with `ok: true` |
| `WriteActionsResponseError<T>` | _(eliminated)_ | Just `WriteResult` with `ok: false` |
| `SuccessfulWriteAction<T>` | `WriteOutcomeOk<T>` | Discriminated union branch (`ok: true`) |
| `FailedWriteAction<T>` | `WriteOutcomeFailed<T>` | Discriminated union branch (`ok: false`) |
| `WriteCommonError` | `WriteError` | Renamed. Same discriminated union on `type`. |
| `WriteActionAffectedItem` (non-generic) | `WriteAffectedItem<T>` | Now generic, has optional `item?: T` |
| `FailedWriteActionAffectedItem<T>` | _(eliminated)_ | Merged into `WriteAffectedItem<T>` |
| `ApplyWritesToItemsResponse<T>` | `WriteToItemsArrayResult<T>` | `changes` always present, no narrowing needed |
| `ApplyWritesToItemsChanges<T>` | `WriteToItemsArrayChanges<T>` | `referential_comparison_ok` removed. |
| `ApplyWritesToItemsOptions<T>` | `WriteToItemsArrayOptions<T>` | Renamed for consistency |
| `WriteActionPayload<T>` | `WritePayload<T>` | Renamed |
| `CombineWriteActionsWhereFiltersResponse<T>` | `CombineWriteActionsWhereFiltersResult<T>` | Renamed and reshaped to `{ success: true, filter } \| { success: false, errors }`. |

### Function Mapping

| Old Function | New Function |
|---|---|
| `applyWritesToItems` | `writeToItemsArray` |
| `applyWritesToItemsTyped` | `writeToItemsArrayPreserveInputType` |
| `checkPermission` | `checkWritePermission` |
| `getFailedActions` | `getWriteFailures` |
| `getSuccessfulActions` | `getWriteSuccesses` |
| `getAllErrors` | `getWriteErrors` |
| `assertArrayScope` | `assertWriteArrayScope` |

### Schema Mapping

| Old Schema | New Schema |
|---|---|
| `WriteCommonErrorSchema` | `WriteErrorSchema` |
| `SuccessfulWriteActionSchema` | `WriteOutcomeOkSchema` |
| `makeSuccessfulWriteActionSchema` | `makeWriteOutcomeOkSchema` |
| `FailedWriteActionSchema` | `WriteOutcomeFailedSchema` |
| `makeFailedWriteActionSchema` | `makeWriteOutcomeFailedSchema` |
| `WriteActionsResponseSchema` | `WriteResultSchema` |
| `WriteActionsResponseOkSchema` | _(eliminated; use `WriteResultSchema`)_ |
| `WriteActionsResponseErrorSchema` | _(eliminated; use `WriteResultSchema`)_ |

Note: `WriteActionSchema`, `makeWriteActionSchema`, `WriteResultSchema`, and `makeWriteResultSchema` are unchanged.

### New Helper Functions

These are the primary ergonomic API. Import them alongside `writeToItemsArray`:

```ts
import { getWriteFailures, getWriteSuccesses, getWriteErrors } from '@andymitchell/objects/write-actions';

// Returns WriteOutcomeFailed<T>[] — already narrowed
getWriteFailures(result)

// Returns WriteOutcomeOk<T>[] — already narrowed
getWriteSuccesses(result)

// Returns WriteErrorContext[] — all errors flattened across all failed actions
getWriteErrors(result)
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
import type { WriteResult, WriteOutcomeOk, WriteOutcomeFailed, WriteOutcome,
  WriteError, WriteErrorContext, WriteAffectedItem,
  WriteToItemsArrayResult, WriteToItemsArrayChanges } from '...'
```

Also import the helper functions where needed:
```ts
import { getWriteFailures, getWriteSuccesses, getWriteErrors } from '...'
```

Also rename the main function:
```ts
import { writeToItemsArray } from '...'  // was applyWritesToItems
```

**Specific renames:**
- `WriteActionsResponse<T>` → `WriteResult<T>`
- `WriteActionsResponseOk` → remove (use `WriteResult` with `ok: true`)
- `WriteActionsResponseError<T>` → remove (use `WriteResult` with `ok: false`)
- `SuccessfulWriteAction<T>` → `WriteOutcomeOk<T>`
- `FailedWriteAction<T>` → `WriteOutcomeFailed<T>`
- `WriteCommonError` → `WriteError`
- `FailedWriteActionAffectedItem<T>` → `WriteAffectedItem<T>`
- `ApplyWritesToItemsResponse<T>` → `WriteToItemsArrayResult<T>`
- `ApplyWritesToItemsChanges<T>` → `WriteToItemsArrayChanges<T>`
- `ApplyWritesToItemsOptions<T>` → `WriteToItemsArrayOptions<T>`
- `WriteActionPayload<T>` → `WritePayload<T>`

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
result.changes.final_items ... // accessible without narrowing on WriteToItemsArrayResult
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
const failures = getWriteFailures(result);
failures[0]! ...
```

**Key insight**: With `WriteToItemsArrayResult`, `changes` is always present on the type — no narrowing needed. You can access `result.changes.final_items` regardless of `result.ok`.

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
const successes = getWriteSuccesses(result);
successes[0]!.action.uuid
successes[0]!.affected_items![0]!.item_pk
successes.length

const failures = getWriteFailures(result);
failures[0]!.action.uuid
failures[0]!.errors[0]!.type    // note: .errors not .error_details
failures.length
```

**Search-replace pattern for `result.successful_actions`:**
1. Add `const successes = getWriteSuccesses(result);` before first use.
2. Replace `result.successful_actions` → `successes`.

**Search-replace pattern for `result.failed_actions`:**
1. Add `const failures = getWriteFailures(result);` before first use.
2. Replace `result.failed_actions` → `failures`.

### Step 4: Update error detail access

The old system had `error_details: WriteCommonError[]` on both the action and the affected item. The new system has `errors: WriteErrorContext<T>[]` only on the failed outcome.

**Old — action-level errors:**
```ts
result.failed_actions[0]!.error_details[0]!.type
result.failed_actions[0]!.error_details[0]!.type === 'missing_key'
```

**New — same data, renamed:**
```ts
const failures = getWriteFailures(result);
failures[0]!.errors[0]!.type
failures[0]!.errors[0]!.type === 'missing_key'
```

**Old — item-level errors (the duplicated errors):**
```ts
result.failed_actions[0]!.affected_items![0]!.error_details[0]!.type
```

**New — errors are flat on the outcome, enriched with item context:**
```ts
const failures = getWriteFailures(result);
// Each error in .errors may have .item_pk and .item for context
failures[0]!.errors[0]!.type
failures[0]!.errors[0]!.item_pk  // was on the affected_item, now on the error itself
failures[0]!.errors[0]!.item     // the offending item, right on the error
```

The key difference: old code drilled through `affected_items[n].error_details[n]` to get per-item errors. New code has errors flat on the outcome with `item_pk` and `item` directly on the error via `WriteErrorContext<T>`.

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
type WriteAffectedItem<T> = {
  item_pk: PrimaryKeyValue;
  item?: T;  // optional, provided when available
}
// No error_details on affected items — errors live on WriteOutcomeFailed.errors
```

If code references `FailedWriteActionAffectedItem`, replace with `WriteAffectedItem<T>` and note that `error_details` is no longer on the affected item — it's on the parent `WriteOutcomeFailed.errors` array.

### Step 6: Remove `referential_comparison_ok`

This property was removed from `WriteToItemsArrayChanges` (was `ApplyWritesToItemsChanges`). Delete any code that reads it:

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
type MyResult<T> = WriteToItemsArrayResult<T>;
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
const failure: WriteOutcomeFailed<T> = {
  ok: false,
  action: writeAction,
  errors: [{ type: 'custom', message: 'Something went wrong', item_pk: '123', item: theItem }],
  unrecoverable: true,
  affected_items: [{ item_pk: '123', item: theItem }]
};
```

Note:
- Added `ok: false`
- `error_details` → `errors` (with `WriteErrorContext<T>` shape: error + `item_pk?` + `item?`)
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
const success: WriteOutcomeOk<T> = {
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
import { WriteErrorSchema, WriteResultSchema, WriteOutcomeFailedSchema } from '...';

WriteResultSchema.parse(data);
WriteErrorSchema.parse(errorData);
```

### Step 12: Update function calls

**Old:**
```ts
import { applyWritesToItems, checkPermission, assertArrayScope } from '...';

const result = applyWritesToItems(actions, items, schema, ddl);
const denied = checkPermission(item, ddl, user);
const payload = assertArrayScope(action);
```

**New:**
```ts
import { writeToItemsArray, checkWritePermission, assertWriteArrayScope } from '...';

const result = writeToItemsArray(actions, items, schema, ddl);
const denied = checkWritePermission(item, ddl, user);
const payload = assertWriteArrayScope(action);
```

### Step 13: Update the `combineWriteActionsWhereFilters` result type

`combineWriteActionsWhereFilters` is exported and supported — it builds one `WhereFilterDefinition` matching every existing row a batch could touch. Only its result type changed:

**Old:**
```ts
import { combineWriteActionsWhereFilters, type CombineWriteActionsWhereFiltersResponse } from '...';
```

**New:**
```ts
import { combineWriteActionsWhereFilters, type CombineWriteActionsWhereFiltersResult } from '...';

const r = combineWriteActionsWhereFilters(ddl, actions);
if (r.success) r.filter;   // WhereFilterDefinition<T> | undefined — undefined means "constrains nothing"
else r.errors;             // WriteError[]
```

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
const result = writeToItemsArray(actions, items, schema, ddl);
expect(result.ok).toBe(true);
expect(result.changes.final_items.length).toBe(2);
expect(result.changes.insert.length).toBe(1);
const successes = getWriteSuccesses(result);
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
const result = writeToItemsArray(actions, items, schema, ddl);
expect(result.ok).toBe(false);
const failures = getWriteFailures(result);
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
const result = writeToItemsArray(actions, items, schema, ddl, { atomic: false });
expect(result.ok).toBe(false);
expect(getWriteFailures(result).length).toBe(1);
expect(getWriteSuccesses(result).length).toBe(2);
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
    for (const f of getWriteFailures(result)) {
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
const schemaErrors = getWriteErrors(result).filter(e => e.type === 'schema');
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
    getWriteFailures(response).forEach(f => { ... });
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
| `result.successful_actions` | `getWriteSuccesses(result)` |
| `result.failed_actions` | `getWriteFailures(result)` |
| `failedAction.error_details` | `failedOutcome.errors` |
| `failedAction.affected_items[n].error_details` | `failedOutcome.errors` (item context on error itself) |
| `failedAction.affected_items[n].item` | `failedOutcome.affected_items[n].item` or `failedOutcome.errors[n].item` |
| `result.changes.referential_comparison_ok` | _(removed)_ |

---

## `attempt_recover_duplicate_create`: `'if-identical'` → `'if-convergent'`

The `'if-identical'` string literal in `WriteToItemsArrayOptions.attempt_recover_duplicate_create` has been renamed to `'if-convergent'`. The old name was misleading — the semantics are subset-convergence (lodash `isMatch`), not strict identity.

**Find:**
```ts
attempt_recover_duplicate_create: 'if-identical'
```

**Replace with:**
```ts
attempt_recover_duplicate_create: 'if-convergent'
```

This is a type-level and runtime change. TypeScript will flag any remaining `'if-identical'` usage as a type error.
