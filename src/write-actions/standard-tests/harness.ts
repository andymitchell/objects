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
        options?: { atomic?: boolean, attempt_recover_duplicate_create?: 'never' | 'if-convergent' | 'always-update' },
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
     * Impl accepts the deliberately-INVALID where corpus (§9 + fuzz P10 where-variant) — i.e. produces
     * invalid_filter outcomes rather than throwing/pre-rejecting. DEFAULT false so the
     * validate-where-sync consumer (which throws on any invalid_filter) runs UNCHANGED.
     */
    invalidWhereCorpus?: boolean;
};

export type StandardTestConfig = {
    test: typeof test,
    expect: typeof expect,
    createAdapter: AdapterFactory,
    implementationName?: string,
    capabilities?: WriteTestCapabilities,
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
};

/** Resolve a single capability flag against the defaults. */
export function resolveCapability(caps: WriteTestCapabilities | undefined, key: keyof WriteTestCapabilities): boolean {
    return caps?.[key] ?? CAPABILITY_DEFAULTS[key];
}

/**
 * Build the gate used by sections: `itIfSupported('assignMethod')('name', fn)` registers the test
 * normally when the capability is supported, else as a visible `test.skip`.
 */
export function makeItIfSupported(test: StandardTestConfig['test'], caps: WriteTestCapabilities | undefined) {
    return (key: keyof WriteTestCapabilities) => (resolveCapability(caps, key) ? test : test.skip);
}

/**
 * Wrap ideal-contract tests the reference engine doesn't yet satisfy. Uses vitest `test.fails`
 * (green WHILE it fails as documented; turns RED the day the impl is fixed → remove the marker).
 * Falls back to plain `test` (visibly red) on runners without `.fails`.
 */
export function makeExpectedFailToday(test: StandardTestConfig['test']): StandardTestConfig['test'] {
    // `.fails` is a runtime vitest modifier absent from the `It` global type; assert the known type
    // widened with an optional `fails`, then runtime-check it so non-vitest runners degrade to plain `test`.
    const withFails = test as StandardTestConfig['test'] & { fails?: StandardTestConfig['test'] };
    return typeof withFails.fails === 'function' ? withFails.fails : test;
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
    expect: StandardTestConfig['expect'];
    createAdapter: AdapterFactory;
    implName: string;
    /** `itIfSupported('capabilityKey')` → `test` when supported, else visible `test.skip`. */
    itIfSupported: (key: keyof WriteTestCapabilities) => StandardTestConfig['test'];
    /** `test.fails`-style wrapper for tests that assert the ideal contract the reference fails today. */
    expectedFailToday: StandardTestConfig['test'];
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
