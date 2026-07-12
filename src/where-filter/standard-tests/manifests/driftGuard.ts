import type { AcknowledgementCollector } from "../outcomes.ts";

/** The slice of vitest's `expect` the drift-guard needs — kept minimal so a manifest file pulls in no test runtime. */
export type ExpectLike = (actual: unknown) => { toEqual(expected: unknown): void };

/**
 * Fail if the acknowledged seams an engine reported this run differ from its frozen capability manifest, in
 * either direction.
 *
 * A NEW acknowledged seam (drift up) may be a regression hiding behind a skip; a LOST one (drift down) means a
 * gap was closed and the manifest should record the win. Either way the set is frozen, so a change is a
 * deliberate act with a manifest edit, never a silent slide.
 *
 * @param collector The collector threaded into `standardTests` for this engine, populated as the battery ran.
 * @param manifest The engine's frozen `kind ::: reason ::: testName` lines (see `*.manifest.ts`).
 * @param expect The caller's `expect`, so the failure registers under the caller's runner.
 */
export function assertNoCapabilityDrift(collector: AcknowledgementCollector, manifest: readonly string[], expect: ExpectLike): void {
    const observed = collector.snapshot();
    const frozen = [...manifest].sort();
    const added = observed.filter(x => !frozen.includes(x));
    const removed = frozen.filter(x => !observed.includes(x));
    // Surface the drift as a readable added/removed diff first, then pin the exact multiset (catches count drift).
    expect({ added, removed }).toEqual({ added: [], removed: [] });
    expect(observed).toEqual(frozen);
}
