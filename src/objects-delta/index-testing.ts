/**
 * Reusable vitest suites (`@andymitchell/objects/objects-delta-testing`) for any `applyDelta` or
 * reduce-objects-deltas implementation.
 *
 * The suites import `vitest` (^3 or ^4) directly, so they register on the consumer's own test runner. The
 * consumer must have vitest installed. It is deliberately not a declared peer dependency: the GitHub Packages
 * registry omits `peerDependenciesMeta` from the metadata npm resolves from, so even an optional peer would be
 * installed for every consumer of this package, including production-only ones.
 */
import  { testReduceObjectDeltas } from "./reduce-objects-delta/testReduceObjectDeltas.ts";
import  { testApplyDelta } from "./apply-delta/testApplyDelta.ts";




export {

    testApplyDelta,
    testReduceObjectDeltas,
}
