import type { StandardTestConfig, SectionCtx } from "./harness.ts";
import { makeHelpers } from "./harness.ts";
import { registerFilterForms } from "./section-01-filter-forms.ts";
import { registerScalarComparisonsA } from "./section-02-scalar-comparisons.ts";
import { registerScalarComparisonsB } from "./section-02b-scalar-comparisons.ts";
import { registerArrayComparisonsA } from "./section-03-array-comparisons.ts";
import { registerArrayComparisonsB } from "./section-03b-array-comparisons.ts";
import { registerDotPropSpreading } from "./section-04-dotprop-spreading.ts";
import { registerEdgeCases } from "./section-05-edge-cases.ts";
import { registerValidation } from "./section-06-validation.ts";
import { registerSecurity } from "./section-07-security.ts";
import { registerCompositePatterns } from "./section-08-composite.ts";
import { registerLogicalEquivalences } from "./section-09-logical-equivalences.ts";
import { registerSchemaConformance } from "./section-10-schema-conformance.ts";

/**
 * The backend-agnostic `WhereFilterDefinition` conformance battery.
 *
 * Any implementation (the pure-JS matcher, the SQLite/Postgres SQL emitters, or a third party) supplies a
 * `matchJavascriptObject` seam; the battery then exercises every operator, filter form, and edge case
 * against it. A passing implementation is provably uniform with the reference semantics — see
 * `MONGO-DIVERGENCES.md` for the documented, intentional departures.
 *
 * @param testConfig The caller's `test`/`expect` (so the suite registers under the caller's runner), the
 *                   `matchJavascriptObject` seam, and optional `implementationName`/`errorsAsValues`/`fuzz`.
 * @example
 * standardTests({ test, expect, matchJavascriptObject, implementationName: 'my-store' });
 */
export function standardTests(testConfig: StandardTestConfig): void {
    const { test, expect, matchJavascriptObject } = testConfig;
    const implementationName = testConfig.implementationName ?? 'unknown';
    const errorsAsValues = testConfig.errorsAsValues ?? false;

    const ctx: SectionCtx = {
        test,
        expect,
        matchJavascriptObject,
        implementationName,
        errorsAsValues,
        fuzz: testConfig.fuzz,
        ...makeHelpers(expect, errorsAsValues, implementationName),
    };

    registerFilterForms(ctx);
    describe('2. Scalar value comparisons', () => {
        registerScalarComparisonsA(ctx);
        registerScalarComparisonsB(ctx);
    });
    describe('3. Array comparisons', () => {
        registerArrayComparisonsA(ctx);
        registerArrayComparisonsB(ctx);
    });
    registerDotPropSpreading(ctx);
    registerEdgeCases(ctx);
    registerValidation(ctx);
    registerSecurity(ctx);
    registerCompositePatterns(ctx);
    registerLogicalEquivalences(ctx);
    registerSchemaConformance(ctx);
}

export type { StandardTestConfig, MatchJavascriptObjectInTesting } from "./harness.ts";
