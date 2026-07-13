import type { ZodSchema } from "zod";
import type { MatchJavascriptObject, WhereFilterDefinition } from "../types.ts";
import type { AcknowledgementCollector } from "./outcomes.ts";

/**
 * The one seam every conformance harness injects: given an object, a filter, and the object's schema,
 * return whether the filter matches — or `undefined` when the implementation cannot express the filter
 * (an acknowledged skip, never a silent match). SQL back-ends wrap their compile+execute round-trip here;
 * the pure-JS reference wraps {@link MatchJavascriptObject} directly.
 */
export type MatchJavascriptObjectInTesting = <T extends Record<string, any> = Record<string, any>>(obj: T, filter: WhereFilterDefinition<T>, schema: ZodSchema<T>) => Promise<ReturnType<MatchJavascriptObject> | undefined>;

export type StandardTestConfig = {
    test: typeof test,
    expect: typeof expect,
    matchJavascriptObject: MatchJavascriptObjectInTesting,
    implementationName?: string,
    /**
     * Opt in (default `false`) when the matcher reports a malformed/contradictory filter by RESOLVING to
     * `undefined` (errors-as-values) rather than throwing. The validation cases then assert `undefined`
     * instead of a throw/`false` — strict in BOTH contracts, so an errors-as-values consumer is held to the
     * same "never a silent match" bar and the default throwing path is byte-for-byte unchanged (no weakening).
     */
    errorsAsValues?: boolean,
    /**
     * Seeded differential + metamorphic fuzz knobs. Omit to use the section's defaults. `seed` makes a run
     * reproducible; `iterations` scales coverage against the harness's wall-clock budget (SQL back-ends run
     * fewer than the pure-JS oracle).
     *
     * `secondaryOracle` adds an independent MongoDB implementation to the run, checking the reference matcher
     * against the query language it claims to implement rather than against itself. Only the pure-JS reference
     * consumer sets it: the check is engine-independent, so running it per back-end would repeat identical work.
     */
    fuzz?: { iterations?: number, seed?: number, secondaryOracle?: 'mingo' },
    /**
     * Optional sink for acknowledged seams (a filter the engine skipped as unsupported, or answered against
     * spec as a documented divergence). When supplied, the assertion helpers record every acknowledgement here
     * so a drift-guard test can freeze the set against a capability manifest. Behaviour is unchanged whether or
     * not it is supplied — recording is a side effect, never a verdict.
     */
    acknowledgements?: AcknowledgementCollector,
}

// ═══════════════════════════════════════════════════════════════════
// Shared context threaded into each section register function
// ═══════════════════════════════════════════════════════════════════

/**
 * The values every section file needs. `standardTests()` (index.ts) builds one of these from the caller's
 * config and passes it to each `registerSectionNN(ctx)`. Sections destructure only the fields they use.
 */
export type SectionCtx = {
    test: StandardTestConfig['test'];
    expect: StandardTestConfig['expect'];
    matchJavascriptObject: MatchJavascriptObjectInTesting;
    implementationName: string;
    errorsAsValues: boolean;
    fuzz: StandardTestConfig['fuzz'];
    /** Strict `toBe(expected)`, tolerating only `undefined` (acknowledged-unsupported). */
    expectOrAcknowledgeUnsupported: (result: boolean | undefined, expected: boolean, reason?: string) => void;
    /** A malformed filter MUST be rejected: a throwing matcher throws; an errors-as-values matcher resolves `undefined`. */
    expectMalformedFilterRejected: (call: () => Promise<boolean | undefined>, throwMessage?: string) => Promise<void>;
    /** ONLY for a documented `MONGO-DIVERGENCES.md` entry (reason must cite it). */
    expectOrAcknowledgeDivergence: (result: boolean | undefined, expected: boolean, reason: string) => void;
    /**
     * A law relating TWO seam calls (e.g. De Morgan): the two answers must agree, whatever they are.
     * Either side `undefined` ⇒ the implementation cannot express one of the filters, so the law is
     * acknowledged-unsupported rather than silently skipped.
     */
    expectEquivalentOrAcknowledge: (a: boolean | undefined, b: boolean | undefined, reason?: string) => void;
};

// ═══════════════════════════════════════════════════════════════════
// Helpers (bodies preserved from the pre-split monolith)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the three assertion helpers a section uses, closed over the caller's `expect`, its
 * `errorsAsValues` contract, and `implementationName` (used in skip/divergence diagnostics).
 */
export function makeHelpers(expect: StandardTestConfig['expect'], errorsAsValues: boolean, implementationName: string, acknowledgements?: AcknowledgementCollector) {

    /** The full `describe > … > test` name of the assertion in flight, so recorded seams stay distinct. */
    const currentTestName = (): string => (expect as { getState?: () => { currentTestName?: string } }).getState?.()?.currentTestName ?? '';

    /** Replaces scattered `if (result === undefined) return` with explicit acknowledgement. */
    function expectOrAcknowledgeUnsupported(
        result: boolean | undefined,
        expected: boolean,
        reason?: string
    ): void {
        if (result === undefined) {
            const note = reason ?? 'not supported';
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${note}`);
            acknowledgements?.record({ kind: 'unsupported', reason: note, testName: currentTestName() });
            return;
        }
        expect(result).toBe(expected);
    }

    /**
     * A malformed/contradictory filter that the matcher must REJECT — never silently match it. A throwing
     * matcher (the default) MUST throw; an errors-as-values matcher (`errorsAsValues`) MUST resolve to
     * `undefined`. Strict in both contracts (no permissive union, never accepts `true`/`false`), so opting in
     * leaves the default throwing path byte-for-byte unchanged and weakens no coverage.
     */
    async function expectMalformedFilterRejected(call: () => Promise<boolean | undefined>, throwMessage?: string): Promise<void> {
        if (errorsAsValues) { expect(await call()).toBe(undefined); }
        else if (throwMessage) { await expect(call()).rejects.toThrow(throwMessage); }
        else { await expect(call()).rejects.toThrow(); }
    }

    /**
     * Acknowledge a known, **documented** cross-implementation divergence from MongoDB semantics.
     *
     * **Precondition:** every divergence asserted via this helper MUST have a corresponding
     * entry in `MONGO-DIVERGENCES.md` (sibling to the impl). That file is the single source
     * of truth for intentional departures from MongoDB semantics — it lists, per divergence:
     * the MongoDB behaviour, this impl's behaviour, the rationale, and a link to the test.
     *
     * If a test surfaces an unexpected cross-impl difference, the correct fix is either:
     *   (a) decide the divergence is intentional, document it in `MONGO-DIVERGENCES.md`, then
     *       use this helper with the entry's title/section in `reason`; or
     *   (b) align the impl with MongoDB.
     *
     * Do **not** silently absorb a difference by wrapping with this helper without a
     * documentation entry — that hides the rationale and lets undocumented behaviour drift.
     *
     * The `reason` argument should reference the `MONGO-DIVERGENCES.md` entry (section number
     * or canonical title) so the link survives test triage.
     */
    function expectOrAcknowledgeDivergence(
        result: boolean | undefined,
        expected: boolean,
        reason: string
    ): void {
        if (result === undefined) {
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${reason}`);
            acknowledgements?.record({ kind: 'unsupported', reason, testName: currentTestName() });
            return;
        }
        if (result !== expected) {
            console.warn(`[ACKNOWLEDGED DIVERGENCE: ${implementationName}] ${reason}: got ${result}, spec says ${expected}`);
            acknowledgements?.record({ kind: 'divergence', reason, testName: currentTestName() });
            return;
        }
        expect(result).toBe(expected);
    }

    /**
     * Assert a metamorphic law between two seam calls: whatever the answers are, they must be the SAME.
     *
     * Unlike {@link expectOrAcknowledgeUnsupported} there is no expected verdict — the law is what is under
     * test, not the value. An implementation that cannot express either filter yields `undefined` on that
     * side, which is an acknowledged skip of the law, never a pass.
     */
    function expectEquivalentOrAcknowledge(
        a: boolean | undefined,
        b: boolean | undefined,
        reason?: string
    ): void {
        if (a === undefined || b === undefined) {
            const note = reason ?? 'not supported';
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${note}`);
            acknowledgements?.record({ kind: 'unsupported', reason: note, testName: currentTestName() });
            return;
        }
        expect(a).toBe(b);
    }

    return { expectOrAcknowledgeUnsupported, expectMalformedFilterRejected, expectOrAcknowledgeDivergence, expectEquivalentOrAcknowledge };
}
