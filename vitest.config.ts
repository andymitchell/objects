import { availableParallelism } from 'node:os'

import { defineConfig, configDefaults } from 'vitest/config'

const cpus = availableParallelism()

export default defineConfig({
  test: {
    globals: true,
    // Twenty test files boot a PGlite instance in a `beforeAll`, and that boot compiles a 6.4MB WASM payload:
    // ~0.6s on an idle machine, ~3.4s with ten in flight, and longer again on a cold page cache (a release run
    // reinstalls node_modules immediately beforehand). Hooks therefore do the single heaviest work in this suite
    // and cannot be given a smaller budget than the tests they set up — which is what Vitest's 10s hook default
    // would do against the 15s test default.
    hookTimeout: 60_000,
    // Sized for the tests that rebuild a PGlite heap mid-test (a 1MB value, a 1000-key implicit $and): 0.6-2.2s
    // idle, each paying a fresh boot on top. Loose enough to absorb a loaded machine, tight enough that a genuine
    // hang in the other ~7,480 tests still surfaces as a failure rather than a stall.
    testTimeout: 30_000,
    // Wall clock is bounded below by the single slowest file (the Postgres conformance battery, ~10s), so workers
    // beyond a handful finish no sooner — they only multiply the concurrent WASM boots competing for the same
    // cores and disk, and every test pays that contention out of its own budget. Measured on 10 cores: 9 workers
    // and 4 workers both finish in ~16s, but summed test time falls from 94s to 40s. Revisit if a second file
    // ever approaches the critical path, since the cap is free only while one file dominates.
    maxWorkers: cpus === 1 ? 1 : Math.max(2, Math.min(4, cpus - 1)),
    // Defaults to `!isCI`, so a stray `.only` would pass locally and abort the release run. Refusing it
    // everywhere keeps a developer's answer and the release's answer the same.
    allowOnly: false,
    // The MongoDB ground-truth corpus boots a real mongod, downloading its binary on first run. It is the final
    // authority on a conformance question, but far too heavy to pay for on every run: `npm run test:mongo-truth`.
    exclude: [...configDefaults.exclude, '**/*.mongo-truth.test.ts'],
  },
})
