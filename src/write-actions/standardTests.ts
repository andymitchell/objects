// Re-export shim. The backend-agnostic WriteAction conformance battery now lives in
// ./standard-tests/ (split by section for size + maintainability). This file preserves the
// public import path `write-actions/standardTests.ts` that write-actions/index.ts and the
// engine consumers depend on.
export { standardTests } from "./standard-tests/index.ts";
export type { StandardTestConfig, AdapterFactory, WriteTestAdapter, WriteTestAdapterResult, WriteTestCapabilities } from "./standard-tests/index.ts";
