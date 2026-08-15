import type { describe, test, expect } from "vitest";
import { z } from "zod";
import type { WriteAction, WriteResult } from "../types.ts";
import type { WriteChanges } from "../writeToItemsArray/types.ts";
import type { DDL } from "../../ddl/types.ts";

// ═══════════════════════════════════════════════════════════════════
// Adapter Types
// ═══════════════════════════════════════════════════════════════════

/** Result of a single adapter.apply() call. Return undefined if the implementation doesn't support this operation. */
export type WriteTestAdapterResult<T extends Record<string, any>> = {
    result: WriteResult<T>,
    changes: WriteChanges<T>,
    /** Independent read of the data source AFTER execution (NOT from WriteResult) */
    finalItems: T[],
} | undefined;

export type WriteTestAdapter<T extends Record<string, any>> = {
    apply: (config: {
        initialItems: T[],
        writeActions: WriteAction<T>[],
        schema: z.ZodType<T, any, any>,
        ddl: DDL<T>,
        options?: { atomic?: boolean, attempt_recover_duplicate_create?: 'never' | 'if-convergent' | 'always-update' } | undefined,
    }) => Promise<WriteTestAdapterResult<T>>
}

export type AdapterFactory = <T extends Record<string, any>>(
    schema: z.ZodType<T, any, any>,
    ddl: DDL<T>
) => WriteTestAdapter<T>;

/**
 * Optional feature flags describing which behaviours an implementation supports.
 *
 * Each flag gates a group of tests: when the flag resolves to `false` the tests register as a
 * VISIBLE `test.skip` (never silently green), so a partial implementation reports honestly rather
 * than appearing to pass tests it never ran. Defaults ({@link CAPABILITY_DEFAULTS}) reproduce the
 * reference engine's behaviour, so omitting `capabilities` entirely leaves the full battery running.
 */
export type WriteTestCapabilities = {
    /** Impl maintains a persistent uuid→payload idempotency ledger ACROSS apply() calls. DEFAULT false. */
    storeUuidIdempotencyLedger?: boolean;
    /** Impl supports attempt_recover_duplicate_create ('if-convergent'/'always-update'). DEFAULT true. */
    duplicateCreateRecovery?: boolean;
    /** Impl supports update method:'assign'. DEFAULT true. */
    assignMethod?: boolean;
    /** Impl supports replacing a scalar array wholesale via update data. DEFAULT true. */
    scalarArrayUpdate?: boolean;
    /**
     * Impl accepts the deliberately-INVALID where/scope corpus (§9, §20.1 + fuzz P10 where-variant) — i.e.
     * produces invalid_filter/invalid_scope outcomes rather than throwing/pre-rejecting. DEFAULT false so
     * the validate-where-sync consumer (which throws on any invalid_filter) runs UNCHANGED.
     */
    invalidWhereCorpus?: boolean;
    /** Impl can express a multi-action batch WITHOUT the all-or-nothing option (sequential-halt / partial-success). DEFAULT true. */
    nonAtomicMultiAction?: boolean;
    /** Impl applies a SINGLE action all-or-nothing across every row it matches — a multi-match validation failure commits nothing. DEFAULT false. */
    atomicPerAction?: boolean;
    /**
     * Adapter RECONSTRUCTS `result`/`changes` from observable state (an initial-vs-final value diff) rather than
     * relaying the engine's own report. Outcome multiplicity, zero-match outcome entries, and matched-but-unchanged
     * "dirty" marks are then unobservable, so the tests/oracles that pin engine-report observability relax. DEFAULT false.
     */
    reconstructsOutcomes?: boolean;
    /**
     * Impl supports `set_property_undefined` — a property whose key is PRESENT while holding `undefined`. DEFAULT true.
     *
     * A store whose rows are themselves JSON cannot hold that state (serialising the row erases the key), so it
     * conforms by declaring `false` here while still supporting {@link deleteProperty}.
     */
    setPropertyUndefined?: boolean;
    /** Impl supports `delete_property` — taking a property's key away from a row entirely. DEFAULT true. */
    deleteProperty?: boolean;
};

export type StandardTestConfig = {
    test: typeof test,
    expect: typeof expect,
    /**
     * The runner's `describe`. Optional: it defaults to the global one, so a runner with globals enabled
     * (Vitest: `globals: true`) needs no override. Supply it explicitly to run under a runner without globals —
     * otherwise the battery has no way to group its sections and throws rather than registering a partial tree.
     */
    describe?: typeof describe,
    createAdapter: AdapterFactory,
    implementationName?: string,
    capabilities?: WriteTestCapabilities,
    /**
     * Register the battery's known reference-engine defects as a `test.fails` ratchet rather than a visible skip.
     * DEFAULT false.
     *
     * A handful of tests assert the ideal contract that the reference engine does not yet meet. Pinning them
     * makes them turn RED the day the reference is fixed, which is what the in-package reference suites want.
     * Any other implementation wants the opposite: an implementation that is MORE correct than the reference
     * must not be failed for it, so by default these register as skips.
     */
    pinReferenceDefects?: boolean,
    fuzz?: { iterations?: number, seed?: number },
}

// ═══════════════════════════════════════════════════════════════════
// Capability resolution
// ═══════════════════════════════════════════════════════════════════

/** The behaviour assumed when a capability flag is omitted — reproduces the reference engine. */
export const CAPABILITY_DEFAULTS: Required<WriteTestCapabilities> = {
    storeUuidIdempotencyLedger: false,
    duplicateCreateRecovery: true,
    assignMethod: true,
    scalarArrayUpdate: true,
    invalidWhereCorpus: false,
    nonAtomicMultiAction: true,
    atomicPerAction: false,
    reconstructsOutcomes: false,
    setPropertyUndefined: true,
    deleteProperty: true,
};

/** Resolve a single capability flag against the defaults. */
export function resolveCapability(caps: WriteTestCapabilities | undefined, key: keyof WriteTestCapabilities): boolean {
    return caps?.[key] ?? CAPABILITY_DEFAULTS[key];
}

/**
 * A callable that registers exactly one test: `test` itself, or one of its modifiers (`test.skip`, `test.fails`).
 *
 * A modifier is narrower than the full `test` API — it registers a test but does not chain further — so any gate
 * that may hand back either one is typed as the modifier shape, which both satisfy.
 */
export type TestRegistrar = StandardTestConfig['test']['skip'];

/**
 * Build the gate used by sections: `itIfSupported('assignMethod')('name', fn)` registers the test
 * normally when the capability is supported, else as a visible `test.skip`.
 */
export function makeItIfSupported(test: StandardTestConfig['test'], caps: WriteTestCapabilities | undefined): (key: keyof WriteTestCapabilities) => TestRegistrar {
    return (key: keyof WriteTestCapabilities) => (resolveCapability(caps, key) ? test : test.skip);
}

/**
 * Wrap ideal-contract tests the reference engine doesn't yet satisfy.
 *
 * With {@link StandardTestConfig.pinReferenceDefects} the test becomes a vitest `test.fails` ratchet: green
 * WHILE it fails as documented, RED the day the engine is fixed (→ remove the marker). Without it — the
 * default, and the right answer for any implementation other than the reference — the test registers as a
 * visible `test.skip`, so an implementation that already meets the ideal contract is never punished for it.
 * Falls back to plain `test` (visibly red) on a runner whose `test` has no `.fails` modifier.
 */
export function makeExpectedFailToday(test: StandardTestConfig['test'], pinReferenceDefects?: boolean): TestRegistrar {
    if (!pinReferenceDefects) return test.skip;
    // Runtime-checked so a runner without `.fails` degrades to a visibly-red plain `test` rather than crashing.
    return typeof test.fails === 'function' ? test.fails : test;
}

// ═══════════════════════════════════════════════════════════════════
// Shared context threaded into each section register function
// ═══════════════════════════════════════════════════════════════════

/**
 * The values every section file needs. `standardTests()` (index.ts) builds one of these from the
 * caller's config and passes it to each `registerSectionNN(ctx)`. Sections destructure the fields
 * they use; capability-gated sections read `itIfSupported`/`expectedFailToday`.
 */
export type SectionCtx = {
    test: StandardTestConfig['test'];
    /** Groups a section. Threaded rather than taken from the global scope, so a runner without globals still works. */
    describe: typeof describe;
    expect: StandardTestConfig['expect'];
    createAdapter: AdapterFactory;
    implName: string;
    /** `itIfSupported('capabilityKey')` → `test` when supported, else visible `test.skip`. */
    itIfSupported: (key: keyof WriteTestCapabilities) => TestRegistrar;
    /**
     * Wrapper for tests asserting an ideal contract the reference engine does not meet: a `test.fails` ratchet
     * when {@link StandardTestConfig.pinReferenceDefects} is set, otherwise a visible skip.
     */
    expectedFailToday: TestRegistrar;
    capabilities: WriteTestCapabilities | undefined;
    fuzz: StandardTestConfig['fuzz'];
};

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

export function makeAction<T extends Record<string, any>>(uuid: string, payload: WriteAction<T>['payload']): WriteAction<T> {
    return { type: 'write', ts: Date.now(), uuid, payload };
}

/** If adapter returned undefined (unsupported), log + skip. Else run assertion. */
export function expectOrAcknowledgeUnsupported<T>(
    result: T | undefined,
    assertion: (r: T) => void,
    implementationName: string,
    reason?: string
): void {
    if (result === undefined) {
        console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${reason ?? 'not supported'}`);
        return;
    }
    assertion(result);
}
