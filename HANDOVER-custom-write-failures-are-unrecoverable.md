# Handover: classify the engine's `custom` write failures as unrecoverable

Delete this file when the work is done.

## The problem

`writeToItemsArray` answers every failed action with a `WriteOutcomeFailedCore` carrying `errors[]` and an optional `unrecoverable` flag. The flag is the contract that retrying consumers (the ICollection spec's WriteOutbox, the Sync Engine flush loop, any retry wrapper) decide by: `true` means "re-sending this action unchanged can never succeed", absent/`false` means "a retry may succeed".

`src/write-actions/writeToItemsArray/helpers/WriteActionFailuresTracker.ts` (`isUnrecoverable`, lines 21–37) flags nine of the eleven error classes `true` and leaves two unflagged: `blocked` (correct: the action never ran, it was rolled back behind a sibling) and `custom`.

`custom` is wrong. Every producer of `custom` in the engine is "this verb cannot apply to the value it found or was given":

| Site | Message |
|---|---|
| `helpers/mutations/applyInc.ts:18,24,27,30` | NaN amount; null field; non-number field; NaN field |
| `helpers/mutations/applyPush.ts:21,24` | null field; non-array field |
| `helpers/mutations/applyPull.ts:26,29` | null field; non-array field |
| `helpers/mutations/applyAddToSet.ts:38,41,88,100,103` | null field; non-array field; no DDL list rules for the path; pk mode on a scalar array; item missing its pk field |
| `combineWriteActionsWhereFilters.ts:157` | no DDL list rules for the scope |

None is transport-, time- or resource-related. Several are not even state-derived (a NaN amount, an item missing its pk field, missing DDL rules) and are deterministic on the action alone. The state-derived ones (inc on a null field, push to a non-array) are deterministic against the data the engine adjudicated: an unchanged action re-sent by a machine against the same data gets the same answer. The only way a retry "succeeds" is if a foreign writer changes the base first, and a relative verb then landing silently on a base the caller never saw is a surprise, not a recovery. The ICollection spec already states that a corrected re-submission is a new consumer decision, never an automatic retry.

Observed consequence downstream: a custody layer (WriteOutbox) that honours the flag retries `inc rank +1` on a null `rank` on an exponential schedule for its whole settle deadline (24 h by default) and then dead-letters it, when the caller should have been told at once. Ten leaves of this package's own standard battery, run through that layer, fail for exactly this reason.

### Where to see the problem case directly

The consumer is the `store2` project, checked out at `~/git/breef/store2` with the WriteOutbox work on the worktree `~/git/breef/store2/.claude/worktrees/write-outbox-v2-impl` (branch `worktree-write-outbox-v2-impl`, commit `11d8e97`). Read-only for you; do not edit or run anything there.

- The classification WriteOutbox applies, keyed on the flag alone: `src/inbuilt/write-outbox/classification.ts` (`classifyWriteResponse`), specified by `uc-failure-classification` in `spec/use-cases/icollection-implementation/WriteOutbox/use-case-spec.md`.
- The general ICollection contract the flag serves: `spec/spec.md`, decisions `dec-write-errors-split-recoverable-or-unrecoverable` (its example currently calls a `custom` failure transient) and `dec-retrying-layers-honour-retry-classification` (a retrying layer must stop on `unrecoverable: true`; a corrected re-submission is a new consumer decision).
- The failing enrolment: `src/inbuilt/write-outbox/write-outbox.stackable-conformance.test.ts` runs this package's standard battery over WriteOutbox-over-memory via `src/conformance/helpers/write-action-adapter.ts`. The ten red leaves are the battery's 1.5 (pk on scalar array), 11.2 (custom failure not flagged), 12.6 (×2), 12.7 (×4) and 12.8 (×2); each asserts the caller receives the `custom` refusal, and instead receives `{ status: 'ok' }` after the 2 s custody window because the layer classified the refusal as retryable.

## Proposed solution (choose your own if you see a better one)

Flag `custom` as unrecoverable. Keep `blocked` unflagged. Concretely:

1. `WriteActionFailuresTracker.ts` `isUnrecoverable`: move `case "custom"` into the `return true` group. Update the function's doc comment to say why (deterministic verb inapplicability; `blocked` is the one class a retry can clear because the blocker, not the action, failed).
2. Flip the pins that assert the old classification, retitling each so the title states the new intent:
   - `helpers/WriteActionFailuresTracker.test.ts:362` "a custom error leaves the action recoverable" (and add `custom` to the `unrecoverableErrors` table at line 341 if that is cleaner).
   - `standard-tests/section-11-error-detail.ts:104` "a custom failure is NOT flagged unrecoverable" (asserts `.not.toBe(true)` at 115).
   - `standard-tests/section-12-deep-verb-semantics.ts:297` "pk-mode on a scalar array is a recoverable custom error, leaving the array untouched" (asserts at 313). The other 12.6/12.7/12.8 leaves only assert `errors[0].type === 'custom'` and stay valid; consider having one of them additionally assert `unrecoverable === true` so the battery pins the new split.
   - `validateWritePayload.test.ts:376` "an inc with NaN is reclassified from a recoverable 'custom' to an unrecoverable invalid_data_value": the behaviour stays, only the word "recoverable" in the title is now false; retitle.
   - `WriteActionFailuresTracker.test.ts:420` comment on `blocked` staying recoverable is still right; leave it.
3. JSDoc: `src/write-actions/types.ts:216` (`AddToSetUniqueBy` remarks) says "`pk` against a non-object element is a recoverable error"; change to "is refused unrecoverably". Check the `WriteError` union's `custom` member (types.ts:446) and `WriteOutcomeFailedCore.unrecoverable` (types.ts:632) for any wording that implies `custom` is retryable; make the doc say plainly which classes carry the flag.
4. The standard battery is consumed by ICollection implementations in `store2` through `dec-write-WriteActions-suggested-lib`, so a flipped pin is a behaviour change for every consumer: add a note to `MIGRATING-BREAKING-WRITE-ACTIONS.md` (the repo's breaking-change log) stating that `custom` failures carry `unrecoverable: true`, and that a consumer which retried them must now surface them.
5. Verify: `npm run typecheck`, `npm test` (vitest), and the saboteur test `standard-tests/standardTests.saboteur.test.ts` still passes.

Do not rename or split the `custom` class, and do not change which sites produce it; the request is the flag only. If you conclude that some `custom` producer is genuinely retryable without any change to the action, keep that one unflagged and say why in its doc comment; I found none.

## Downstream (for your awareness, not for you to do)

The owner versions and publishes this package. `store2` then updates its general spec (`dec-write-errors-split-recoverable-or-unrecoverable`, whose example calls a `custom` failure transient, and the sentence pinning the battery's per-class split), the WriteOutbox spec's `uc-failure-classification` rationale, one JSDoc in `src/inbuilt/shared/writes.ts`, and re-verifies the ten leaves. The WriteOutbox classification table keys on the flag alone, so no store2 code changes.
