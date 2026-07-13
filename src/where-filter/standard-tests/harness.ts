import type { describe, test, expect } from "vitest";
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

/**
 * Registers extra fuzz properties into a battery run, using the same seeded generators as the built-in ones.
 *
 * The battery ships every property that can be expressed against the seam alone. A registrar is the seam for a
 * property that needs something the battery deliberately does not depend on — most importantly an *independent*
 * implementation to check the reference matcher itself against, which would otherwise drag that implementation
 * into every consumer's bundle.
 *
 * @param ctx - The section context: register tests with `ctx.test`, assert with `ctx.expect`, and reach the
 *              implementation under test via `ctx.matchJavascriptObject`.
 * @param opts - `seed` is the run's seed; derive from it so a failure reproduces.
 *
 * @example
 * // Check the reference against a real MongoDB implementation, without publishing that dependency:
 * standardTests({ test, expect, matchJavascriptObject, fuzz: { secondaryOracle: registerSecondaryOracleProperty } });
 */
export type FuzzPropertyRegistrar = (ctx: SectionCtx, opts: { seed: number }) => void;

export type StandardTestConfig = {
    test: typeof test,
    expect: typeof expect,
    /**
     * The runner's `describe`. Optional: it defaults to the global one, so a runner with globals enabled
     * (Vitest: `globals: true`) needs no override. Supply it explicitly to run under a runner without globals —
     * otherwise the battery has no way to group its sections and throws rather than registering a partial tree.
     */
    describe?: typeof describe,
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
     * `secondaryOracle` injects an extra fuzz property (see {@link FuzzPropertyRegistrar}) — typically one that
     * checks the reference matcher against an independent implementation of the query language, rather than
     * against itself. It is injected rather than built in so that the implementation stays a concern of the
     * caller's test run and never reaches a consumer's bundle.
     */
    fuzz?: { iterations?: number, seed?: number, secondaryOracle?: FuzzPropertyRegistrar },
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
    /** Registers a test AND records its full `describe > … > test` name for acknowledgement keys. */
    test: StandardTestConfig['test'];
    /** Groups a section AND pushes its name onto the battery's own name stack. */
    describe: typeof describe;
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
 * A modifier that registers a test the battery cannot name, so a seam reported from it could not be attributed.
 *
 * `.each`/`.for` derive a distinct name PER CASE from a template the runner expands itself; reproducing that
 * expansion here would be a guess, and a wrong guess files every case under one key — the very collision an
 * acknowledgement key exists to prevent. `.concurrent` overlaps bodies, so the name in flight is ambiguous.
 * Registering through any of them throws rather than silently mis-keying a manifest: build the cases with a loop
 * of plain `ctx.test(name, fn)` calls instead.
 */
const UNNAMEABLE_TEST_MODIFIERS = new Set(['each', 'for', 'concurrent']);

/** Modifiers that never execute a body, so they can never report a seam and need no name. */
const NON_RUNNING_TEST_MODIFIERS = new Set(['skip', 'todo']);

/**
 * Wrap the runner's `describe`/`test` so the battery owns the name of the test in flight.
 *
 * Acknowledgement keys are `kind ::: reason ::: testName`, so a seam recorded under a blank or wrong name
 * silently collides with every other seam recorded that way. Deriving the name from the runner's ambient state
 * makes it hostage to whatever else is loaded in the consumer's process — a second copy of the runner, for
 * instance, answers about a different test. These wrappers read nothing ambient: `describe` maintains a private
 * stack, `test` captures the full path at REGISTRATION time, and the name is simply recalled while the body runs.
 *
 * Names are relative to the battery, not the consumer's suite: an outer `describe` in the caller's own test file
 * is deliberately absent, so a manifest does not depend on what the caller names their suite.
 *
 * @param rawDescribe - The runner's `describe`.
 * @param rawTest - The runner's `test`.
 * @returns The wrapped pair to register with, plus `currentTestName()` for the assertion helpers.
 *
 * @remarks
 * **The battery runs its own suites sequentially.** One test is in flight at a time, so a single "name in flight"
 * is unambiguous. Suites register through `describe.sequential` where the runner offers it, which holds even under
 * a consumer's `sequence.concurrent: true` — the caller does not have to configure anything. An overlap check
 * backs this up: if two bodies ever run at once the battery says so, rather than filing seams against whichever
 * test happened to write the name last.
 *
 * Supported registration shapes are `ctx.test(name, fn)` and `ctx.test(name, options, fn)`, plus the modifiers
 * `.only` / `.fails` / `.sequential` (named the same way) and `.skip` / `.todo` (never run, so never named).
 * {@link UNNAMEABLE_TEST_MODIFIERS} are refused outright.
 */
export function makeSuiteRecorder(rawDescribe: typeof describe, rawTest: typeof test) {
    let stack: string[] = [];
    let currentName = '';
    let inFlight = 0;

    /** Register through `registrar`, naming the test with its full path. Handles `(name, fn)` and `(name, options, fn)`. */
    const registerNamed = (registrar: object, thisArg: unknown, args: unknown[]): unknown => {
        const apply = (a: unknown[]) => Reflect.apply(registrar as (...x: unknown[]) => unknown, thisArg, a);
        const name = args[0];
        const bodyIndex = args.findIndex(a => typeof a === 'function');
        // Not a shape we can name (no string name, or no body). Hand it to the runner untouched rather than guess.
        if (typeof name !== 'string' || bodyIndex < 1) return apply(args);

        const body = args[bodyIndex] as (...a: unknown[]) => unknown;
        const fullName = [...stack, name].join(' > ');
        const named = [...args];
        named[bodyIndex] = async function (this: unknown, ...inner: unknown[]) {
            if (inFlight > 0) {
                throw new Error(`standardTests: two tests ran at once, so an acknowledged seam could not be attributed to either ('${fullName}' overlapped another). The battery registers its suites as sequential; this means something forced them concurrent.`);
            }
            inFlight++;
            currentName = fullName;
            try { return await body.apply(this, inner); } finally { currentName = ''; inFlight--; }
        };
        return apply(named);
    };

    const wrappedDescribe = new Proxy(rawDescribe, {
        apply(target, thisArg, args: unknown[]) {
            const [name, fn] = args as [string, (...a: unknown[]) => unknown];
            if (typeof name !== 'string' || typeof fn !== 'function') return Reflect.apply(target, thisArg, args);
            // The path is captured where `describe` is CALLED, not where its body runs: a runner may defer the
            // body until after the enclosing `describe` has returned, so the body's own execution order says
            // nothing about where the suite sits in the tree. The body then runs against the path it was born with.
            const path = [...stack, name];
            const factory = function (this: unknown, ...inner: unknown[]) {
                const outer = stack;
                stack = path;
                try { return fn.apply(this, inner); } finally { stack = outer; }
            };
            // Tests inherit `sequential` from their suite, so this pins one-test-at-a-time for the whole battery
            // even when the consumer has made tests concurrent by default.
            const sequential = Reflect.get(target, 'sequential');
            const register = typeof sequential === 'function' ? sequential : target;
            return Reflect.apply(register as (...x: unknown[]) => unknown, thisArg, [name, factory]);
        },
    });

    const wrappedTest = new Proxy(rawTest, {
        apply(target, thisArg, args: unknown[]) {
            return registerNamed(target, thisArg, args);
        },
        get(target, prop) {
            // Refused whether or not the runner implements them — the battery's contract, not the runner's.
            if (typeof prop === 'string' && UNNAMEABLE_TEST_MODIFIERS.has(prop)) {
                return () => {
                    throw new Error(`standardTests: \`test.${prop}\` cannot be used inside the battery — a seam reported from it could not be attributed to a specific test, and would silently merge with others in the capability manifest. Register each case with its own \`ctx.test(name, fn)\` call.`);
                };
            }
            const value = Reflect.get(target, prop);
            if (typeof prop !== 'string' || typeof value !== 'function') return value;
            if (NON_RUNNING_TEST_MODIFIERS.has(prop)) return value;
            // A running modifier shaped like `test` itself (`.only`, `.fails`, `.sequential`): name it the same way.
            return new Proxy(value, { apply: (t, thisA, a: unknown[]) => registerNamed(t, thisA, a) });
        },
    });

    return { describe: wrappedDescribe, test: wrappedTest, currentTestName: () => currentName };
}

/**
 * Build the three assertion helpers a section uses, closed over the caller's `expect`, its
 * `errorsAsValues` contract, `implementationName` (used in skip/divergence diagnostics), and the
 * `currentTestName` reader from {@link makeSuiteRecorder}.
 */
export function makeHelpers(expect: StandardTestConfig['expect'], errorsAsValues: boolean, implementationName: string, currentTestName: () => string, acknowledgements?: AcknowledgementCollector) {

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
