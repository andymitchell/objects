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
import { registerRegexFidelity } from "./section-11-regex-like.ts";
import { registerPathInjection } from "./section-12-path-injection.ts";
import { registerEmptyLists } from "./section-13-empty-lists.ts";
import { registerSizeContract } from "./section-14-size-contract.ts";
import { registerNullishMatrix } from "./section-15-nullish-matrix.ts";
import { registerMalformedHostile } from "./section-16-malformed-hostile.ts";
import { registerDegeneratePaths } from "./section-17-degenerate-paths.ts";
import { registerArraySemantics } from "./section-18-array-semantics.ts";
import { registerExoticValues } from "./section-19-exotic-values.ts";
import { registerMultiScalarEnums } from "./section-20-multiscalar-enums.ts";
import { registerLogicTrees } from "./section-21-logic-trees.ts";
import { registerTypeMapping } from "./section-22-type-mapping.ts";
import { registerCoverageGaps } from "./section-23-coverage-gaps.ts";
import { registerOperatorStrictness } from "./section-25-operator-strictness.ts";
import { registerRecordPaths } from "./section-26-record-paths.ts";
import { registerStructuralOperands } from "./section-27-structural-operands.ts";
import { runFuzzSection } from "./fuzz.ts";

/**
 * The backend-agnostic `WhereFilterDefinition` conformance battery.
 *
 * Any implementation (the pure-JS matcher, the SQLite/Postgres SQL emitters, or a third party) supplies a
 * `matchJavascriptObject` seam; the battery then exercises every operator, filter form, and edge case
 * against it. Passing the battery means an implementation agrees with the reference semantics on every
 * pinned case, except where a capability manifest (`standard-tests/manifests/`) records an acknowledged
 * seam for that engine and `MONGO-DIVERGENCES.md` documents the intentional departure.
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
        ...makeHelpers(expect, errorsAsValues, implementationName, testConfig.acknowledgements),
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
    registerRegexFidelity(ctx);
    registerPathInjection(ctx);
    registerEmptyLists(ctx);
    registerSizeContract(ctx);
    registerNullishMatrix(ctx);
    registerMalformedHostile(ctx);
    registerDegeneratePaths(ctx);
    registerArraySemantics(ctx);
    registerExoticValues(ctx);
    registerMultiScalarEnums(ctx);
    registerLogicTrees(ctx);
    registerTypeMapping(ctx);
    registerCoverageGaps(ctx);
    registerOperatorStrictness(ctx);
    registerRecordPaths(ctx);
    registerStructuralOperands(ctx);
    runFuzzSection(ctx);
}

export type { StandardTestConfig, MatchJavascriptObjectInTesting } from "./harness.ts";
