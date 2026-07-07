import { describe, test, expect } from "vitest";
import matchJavascriptObjectReference from "../matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { MatchJavascriptObjectInTesting, SectionCtx } from "./harness.ts";
import { makeHelpers } from "./harness.ts";
import { runFuzzSection } from "./fuzz.ts";
import { DEFAULT_FUZZ_SEED } from "./fuzz-internals.ts";

/**
 * TEETH for §24. This dev-only harness proves the fuzz section actually catches misbehaving matchers
 * rather than passing everything. It runs ONLY `runFuzzSection` (the full battery accrues expected-fail
 * reds, so it is the wrong yardstick) against:
 *   - the HONEST reference matcher → every property must pass;
 *   - nine saboteurs, each a small deliberate defect → at least one property must catch it, including the
 *     specific properties we claim guard that behaviour.
 *
 * A saboteur's `trips` is asserted as a SUBSET of its actual failures (extra catches are fine — a broken
 * matcher may fail several laws). Two saboteurs (emptyOrMatchesAll, swallowsInvalidFilter) are caught by a
 * SINGLE property that the differential (WF-P1) alone cannot see — proving those laws earn their place.
 */

// ── The seam under test: the JS reference matcher (throws on a malformed filter). ────────────────
const referenceMatch = (obj: Record<string, unknown>, filter: unknown): boolean =>
    matchJavascriptObjectReference(obj, filter as WhereFilterDefinition<Record<string, unknown>>);

const honestMatcher: MatchJavascriptObjectInTesting = async (obj, filter) => referenceMatch(obj, filter);

// ── Filter rewriters — a saboteur transforms the filter, then defers to the honest matcher. ──────
type Rewrite = (obj: Record<string, unknown>) => Record<string, unknown>;

function isPlainRecord(x: unknown): x is Record<string, unknown> {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Deep-clone the filter, applying `rewrite` bottom-up to every object node. */
function mapFilter(node: unknown, rewrite: Rewrite): unknown {
    if (Array.isArray(node)) return node.map(child => mapFilter(child, rewrite));
    if (isPlainRecord(node)) {
        const mapped: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) mapped[k] = mapFilter(v, rewrite);
        return rewrite(mapped);
    }
    return node;
}

const rewriteMatcher = (rewrite: Rewrite): MatchJavascriptObjectInTesting =>
    async (obj, filter) => referenceMatch(obj, mapFilter(filter, rewrite));

const renameKey = (obj: Record<string, unknown>, from: string, to: string): Record<string, unknown> => {
    if (!(from in obj)) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k === from ? to : k] = v;
    return out;
};

/** Forget to negate: treat `$nor` as `$or`. Breaks the differential, De Morgan, and `$nor ≡ ¬$or`. */
const ignoresNegation: Rewrite = (obj) => renameKey(obj, '$nor', '$or');
/**
 * Forget to negate equality: swap `$ne`↔`$eq`. Complementary on any present value, and equality is the
 * single most common generated operator — so the differential sees it almost immediately. (A range-direction
 * flip was tried first but range operators are only ~7% of generated leaves; at 40 iterations they never
 * straddled a boundary, so the fuzz could not reliably catch that bug — a genuine sensitivity limit.)
 */
const swapsNeEq: Rewrite = (obj) => {
    if (!('$ne' in obj) && !('$eq' in obj)) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k === '$ne' ? '$eq' : k === '$eq' ? '$ne' : k] = v;
    return out;
};
/** Invert every `$exists` — any `$exists` leaf then disagrees with the reference. */
const flipsExists: Rewrite = (obj) => ('$exists' in obj ? { ...obj, $exists: !obj.$exists } : obj);
/** Count one too many: `$size: n`→`n + 1`. */
const sizeOffByOne: Rewrite = (obj) => ('$size' in obj && typeof obj.$size === 'number' ? { ...obj, $size: obj.$size + 1 } : obj);
/** Swap `$in`↔`$nin` — complementary on any present value, so the differential always sees it. */
const swapsInNin: Rewrite = (obj) => {
    if (!('$in' in obj) && !('$nin' in obj)) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k === '$in' ? '$nin' : k === '$nin' ? '$in' : k] = v;
    return out;
};

/** Ignore the filter entirely and match everything. */
const alwaysTrue: MatchJavascriptObjectInTesting = async () => true;
/** Ignore the filter entirely and match nothing. */
const alwaysFalse: MatchJavascriptObjectInTesting = async () => false;

// ── Two saboteurs the differential cannot see — only an empty-logic / rejection law catches them. ─
/** `{$or:[]}` (which the uniform generator never emits) wrongly matches all → only WF-P8 sees it. */
const emptyOrMatchesAll: MatchJavascriptObjectInTesting = async (obj, filter) => {
    const node: unknown = filter;
    if (isPlainRecord(node) && Array.isArray(node.$or) && node.$or.length === 0) return true;
    return referenceMatch(obj, filter);
};
/** Swallows a malformed filter into `false` instead of rejecting → only WF-P9 sees it. */
const swallowsInvalidFilter: MatchJavascriptObjectInTesting = async (obj, filter) => {
    try { return referenceMatch(obj, filter); } catch { return false; }
};

type Saboteur = { name: string; matcher: MatchJavascriptObjectInTesting; trips: number[] };

const GROUP_A: Saboteur[] = [
    { name: 'S1 alwaysTrue', matcher: alwaysTrue, trips: [1, 8, 9] },
    { name: 'S2 alwaysFalse', matcher: alwaysFalse, trips: [1, 8, 9] },
    { name: 'S3 ignoresNegation', matcher: rewriteMatcher(ignoresNegation), trips: [1, 2, 7] },
    { name: 'S4 swapsNeEq', matcher: rewriteMatcher(swapsNeEq), trips: [1] },
    { name: 'S5 flipsExists', matcher: rewriteMatcher(flipsExists), trips: [1] },
    { name: 'S6 sizeOffByOne', matcher: rewriteMatcher(sizeOffByOne), trips: [1] },
    { name: 'S7 swapsInNin', matcher: rewriteMatcher(swapsInNin), trips: [1] },
    { name: 'S8 emptyOrMatchesAll', matcher: emptyOrMatchesAll, trips: [8] },
    { name: 'S9 swallowsInvalidFilter', matcher: swallowsInvalidFilter, trips: [9] },
];

type Collected = { name: string; passed: boolean; error?: string };

/**
 * Drive `runFuzzSection` against a matcher and collect per-property pass/fail. The section registers its
 * properties by calling the ambient `describe`/`ctx.test`; we swap `globalThis.describe` for a synchronous
 * invoker and hand it a fake `test` collector, so the properties run inline here instead of registering with
 * the real runner.
 */
async function collectFuzzResults(matcher: MatchJavascriptObjectInTesting): Promise<Collected[]> {
    const collected: { name: string; fn: () => Promise<void> | void }[] = [];
    const fake = Object.assign(
        (name: string, fn: () => Promise<void> | void) => { collected.push({ name, fn }); },
        { skip: () => { /* noop */ }, only: (name: string, fn: () => Promise<void> | void) => collected.push({ name, fn }), fails: (name: string, fn: () => Promise<void> | void) => collected.push({ name, fn }), todo: () => { /* noop */ }, each: () => () => { /* noop */ } },
    );
    /* eslint-disable @typescript-eslint/no-explicit-any -- a deliberate fake `test` collector cannot structurally match vitest's full TestAPI; the vitest global vs imported `expect` types also differ */
    const fakeTest = fake as any;
    const realExpect = expect as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ctx: SectionCtx = {
        test: fakeTest,
        expect: realExpect,
        matchJavascriptObject: matcher,
        implementationName: 'saboteur-probe',
        errorsAsValues: false,
        fuzz: { iterations: 40, seed: DEFAULT_FUZZ_SEED },
        ...makeHelpers(realExpect, false, 'saboteur-probe'),
    };

    const g: { describe: unknown } = globalThis;
    const original = g.describe;
    g.describe = (_name: string, fn: () => void) => { fn(); };
    try {
        runFuzzSection(ctx);
    } finally {
        g.describe = original;
    }

    const results: Collected[] = [];
    for (const { name, fn } of collected) {
        try { await fn(); results.push({ name, passed: true }); }
        catch (e) { results.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) }); }
    }
    return results;
}

/** The property index of each failing test, parsed from its `24.N WF-PN — …` name. */
const failingIndices = (results: Collected[]): Set<number> =>
    new Set(results.filter(r => !r.passed).map(r => Number(r.name.split(' ')[0]!.split('.')[1])));

describe('§24 fuzz saboteur harness (teeth)', () => {

    test('the honest reference matcher passes every fuzz property', async () => {
        const results = await collectFuzzResults(honestMatcher);
        expect(results.filter(r => !r.passed).map(r => `${r.name}: ${r.error}`)).toEqual([]);
    });

    for (const sab of GROUP_A) {
        test(`${sab.name} is caught (declared trips: ${sab.trips.map(i => 'WF-P' + i).join(', ')})`, async () => {
            const failing = failingIndices(await collectFuzzResults(sab.matcher));
            expect(failing.size, `${sab.name}: no property caught it`).toBeGreaterThan(0);
            const uncaught = sab.trips.filter(i => !failing.has(i));
            expect(uncaught, `${sab.name}: declared trips not all caught — actual failing set = [${[...failing].sort((a, b) => a - b).join(', ')}]`).toEqual([]);
        });
    }
});
