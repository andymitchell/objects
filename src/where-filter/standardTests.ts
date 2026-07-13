// Re-export shim. The backend-agnostic WhereFilterDefinition conformance battery now lives in
// ./standard-tests/ (split by section for size + maintainability). This file preserves the public
// import path `where-filter/standardTests.ts` that where-filter/index.ts and the engine test
// consumers depend on (plus `ContactSchema`, imported by dot-prop-paths/shape-ambiguity.test.ts).
export { standardTests } from "./standard-tests/index.ts";
export type { StandardTestConfig, MatchJavascriptObjectInTesting } from "./standard-tests/index.ts";
export { ContactSchema } from "./standard-tests/fixtures.ts";
export { classifyWhereClauseErrors, classifyInsertError, AcknowledgementCollector } from "./standard-tests/outcomes.ts";
export type { ConformanceOutcome, AcknowledgementEvent, AcknowledgementKind } from "./standard-tests/outcomes.ts";
export { assertNoCapabilityDrift } from "./standard-tests/manifests/driftGuard.ts";
export type { ExpectLike } from "./standard-tests/manifests/driftGuard.ts";
