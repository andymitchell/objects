import type { StandardTestConfig, SectionCtx } from "./harness.ts";
import { makeItIfSupported, makeExpectedFailToday } from "./harness.ts";
import { registerVerbsCrud } from "./section-01-verbs-crud.ts";
import { registerVerbsArrayOps } from "./section-01-verbs-arrayops.ts";
import { registerResultShape } from "./section-02-result-shape.ts";
import { registerErrors } from "./section-03-errors.ts";
import { registerHaltBlocking } from "./section-04-halt-blocking.ts";
import { registerAtomic } from "./section-05-atomic.ts";
import { registerDuplicateCreate } from "./section-06-duplicate-create.ts";
import { registerIdempotency } from "./section-07-idempotency.ts";
import { registerEdgeRegression } from "./section-08-edge-regression.ts";
import { registerInvalidFilter } from "./section-09-invalid-filter.ts";
import { registerInvalidDataValue } from "./section-10-invalid-data-value.ts";
import { registerErrorDetail } from "./section-11-error-detail.ts";
import { registerDeepVerbSemantics } from "./section-12-deep-verb-semantics.ts";
import { registerWorldIntegrity } from "./section-13-world-integrity.ts";
import { registerResultContract } from "./section-14-result-contract.ts";
import { registerWhereBehavioural } from "./section-15-where-behavioural.ts";
import { registerDuplicateCreateEdges } from "./section-16-duplicate-create-edges.ts";
import { registerMultiMatchPartialFailure } from "./section-17-multimatch-partial-failure.ts";
import { runFuzzSection } from "./fuzz.ts";

/**
 * The backend-agnostic WriteAction conformance battery.
 *
 * Any implementation (including third parties) supplies an {@link AdapterFactory} that wraps its own
 * write path; the battery then exercises every verb, error mode, and edge case against that adapter's
 * observable surface (`result` / `changes` / `finalItems`). A passing implementation behaves uniformly
 * with the reference engine.
 *
 * @param config The caller's `test`/`expect` (so the suite registers under the caller's runner),
 *               the adapter factory, and an optional `implementationName` used in skip diagnostics.
 * @example
 * standardTests({ test, expect, createAdapter, implementationName: 'my-store' });
 */
export function standardTests(config: StandardTestConfig): void {
    const ctx: SectionCtx = {
        test: config.test,
        expect: config.expect,
        createAdapter: config.createAdapter,
        implName: config.implementationName ?? 'unknown',
        itIfSupported: makeItIfSupported(config.test, config.capabilities),
        expectedFailToday: makeExpectedFailToday(config.test, config.pinReferenceDefects),
        capabilities: config.capabilities,
        fuzz: config.fuzz,
    };

    describe('1. Core Verbs', () => {
        registerVerbsCrud(ctx);
        registerVerbsArrayOps(ctx);
    });
    registerResultShape(ctx);
    registerErrors(ctx);
    registerHaltBlocking(ctx);
    registerAtomic(ctx);
    registerDuplicateCreate(ctx);
    registerIdempotency(ctx);
    registerEdgeRegression(ctx);
    registerInvalidFilter(ctx);
    registerInvalidDataValue(ctx);
    registerErrorDetail(ctx);
    registerDeepVerbSemantics(ctx);
    registerWorldIntegrity(ctx);
    registerResultContract(ctx);
    registerWhereBehavioural(ctx);
    registerDuplicateCreateEdges(ctx);
    registerMultiMatchPartialFailure(ctx);
    runFuzzSection(ctx);
}

export type {
    StandardTestConfig,
    AdapterFactory,
    WriteTestAdapter,
    WriteTestAdapterResult,
    WriteTestCapabilities,
} from "./harness.ts";
