import matchJavascriptObjectReference from "../../matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../../types.ts";
import type { SectionCtx } from "../harness.ts";
import { mulberry32, mixSeed, type FuzzRow, genRow } from "../fuzz-internals.ts";
import { evaluateWithMingo } from "./oracle.ts";
import { filterShape } from "./filterShape.ts";
import { genMongoFilter, isArrayFieldPath } from "./generator.ts";
import { KNOWN_DIVERGENCES, PENDING_BUGS } from "./knownDivergences.ts";

export { evaluateWithMingo } from "./oracle.ts";
export { filterShape } from "./filterShape.ts";
export { genMongoFilter, isArrayFieldPath, ARRAY_FIELD_PATHS } from "./generator.ts";
export { KNOWN_DIVERGENCES, PENDING_BUGS, MINGO_QUIRKS, type KnownDivergence } from "./knownDivergences.ts";

/** Everything the oracle is allowed to stay quiet about: a decision we took, or a debt we have recorded. */
const EXPLAINED = [...KNOWN_DIVERGENCES, ...PENDING_BUGS];

/** The fuzz property index reserved for the secondary oracle — WF-P0…WF-P13 occupy 0-13. */
const PROPERTY_INDEX = 14;

/**
 * Iterations for the secondary oracle, deliberately independent of the rest of §24.
 *
 * The other properties share a budget set by the slowest consumer — each iteration of a SQL property compiles
 * and executes a statement. This one runs two in-memory matchers, so it is orders of magnitude cheaper and can
 * afford far more draws. It needs them: the constructs where we disagree with MongoDB are a small slice of the
 * generated language, and at the shared budget (300) a real disagreement is missed more often than not. A cheap
 * property inheriting an expensive property's budget is a green that means nothing.
 */
const ORACLE_ITERATIONS = 25_000;

/** One class of disagreement, and the smallest example that produced it. */
type Disagreement = {
    readonly shape: string;
    readonly divergenceId: string | undefined;
    count: number;
    readonly example: { readonly row: FuzzRow, readonly filter: unknown, readonly ours: boolean, readonly mongo: string };
};

/** Evaluate both oracles on one row/filter. A mingo throw counts as a disagreement — it is still a datum. */
function verdicts(row: FuzzRow, filter: unknown): { ours: boolean, mongo: boolean | string } {
    const ours = matchJavascriptObjectReference(row, filter as WhereFilterDefinition<FuzzRow>);
    try {
        return { ours, mongo: evaluateWithMingo(row, filter as Record<string, unknown>) };
    } catch (e) {
        return { ours, mongo: `threw: ${(e as Error).message}` };
    }
}

const LOGIC_KEYS = new Set(['$and', '$or', '$nor']);

/**
 * Shrink a disagreeing filter to the smallest sub-filter that still disagrees.
 *
 * A logic node disagrees because one of its arms does, so reporting the whole tree buries the cause in noise —
 * and worse, lets one arm's *accepted* divergence claim the whole filter while a genuine bug rides along in
 * another arm. Descending to the guilty arm makes each report a minimal reproducer, and makes the ignore-list's
 * attribution honest: it classifies the construct that actually caused the disagreement, not a bystander.
 *
 * @returns The narrowest disagreeing sub-filter. A compound is returned unchanged when no single arm disagrees
 *   on its own — the disagreement is then genuinely emergent from the composition, which is itself worth seeing.
 */
function minimizeDisagreement(row: FuzzRow, filter: unknown): unknown {
    let current = filter;
    for (;;) {
        const keys = current !== null && typeof current === 'object' && !Array.isArray(current)
            ? Object.keys(current as Record<string, unknown>)
            : [];
        if (keys.length !== 1 || !LOGIC_KEYS.has(keys[0]!)) return current;

        const arms = (current as Record<string, unknown>)[keys[0]!];
        if (!Array.isArray(arms)) return current;

        const guilty = arms.find(arm => {
            try {
                const { ours, mongo } = verdicts(row, arm);
                return ours !== mongo;
            } catch {
                return false;
            }
        });
        if (guilty === undefined) return current;
        current = guilty;
    }
}

/**
 * WF-P14 — the reference matcher agrees with MongoDB, except where we have said it does not.
 *
 * Every other differential property compares an engine against our own reference matcher, so all of them are
 * blind to a mistake the reference itself makes about MongoDB: were it wrong, each engine would be wrong the
 * same way and the suite would still pass. This property closes that hole by evaluating the same row and filter
 * with `mingo`, an independent implementation of the query language, and reporting every disagreement that
 * `MONGO-DIVERGENCES.md` does not already explain.
 *
 * Disagreements are grouped by filter SHAPE rather than counted individually — a thousand filters that differ
 * only in their operands are one thing to understand, not a thousand.
 *
 * Pass this as `fuzz.secondaryOracle` to register the property (see `FuzzPropertyRegistrar`). Only the JS
 * reference consumer does so: the property compares the reference against mingo, so running it per engine would
 * repeat identical work. It is injected rather than wired into the battery because `mingo` is a test-only
 * dependency — reaching it from a published barrel would ship a MongoDB query engine to every consumer.
 *
 * @param ctx - The section context: registers the property via `ctx.test`.
 * @param opts - The seed shared with the rest of §24 so a failure replays. Iterations are NOT shared — see
 *   {@link ORACLE_ITERATIONS}.
 */
export function registerSecondaryOracleProperty(ctx: SectionCtx, opts: { seed: number }): void {
    const { seed } = opts;
    const iterations = ORACLE_ITERATIONS;

    ctx.test(`24.${PROPERTY_INDEX} WF-P${PROPERTY_INDEX} — the reference agrees with MongoDB (mingo secondary oracle)`, () => {
        const found = new Map<string, Disagreement>();

        for (let iter = 0; iter < iterations; iter++) {
            const rng = mulberry32(mixSeed(seed, PROPERTY_INDEX, iter));
            const row = genRow(rng);
            const generated = genMongoFilter(rng, row);

            // The reference throws only on a filter outside the portable operand domain, and the generator stays
            // inside it — so a throw here is a generator defect, not a datum. Let it surface.
            if (verdicts(row, generated).ours === verdicts(row, generated).mongo) continue;

            // Report the guilty arm, not the tree that contained it.
            const filter = minimizeDisagreement(row, generated);
            const { ours, mongo } = verdicts(row, filter);

            const shape = filterShape(filter, isArrayFieldPath);
            const existing = found.get(shape);
            if (existing) {
                existing.count++;
                continue;
            }
            found.set(shape, {
                shape,
                divergenceId: EXPLAINED.find(d => d.claims(filter, isArrayFieldPath))?.id,
                count: 1,
                example: { row, filter, ours, mongo: String(mongo) },
            });
        }

        const all = [...found.values()].sort((a, b) => b.count - a.count);
        const residual = all.filter(d => d.divergenceId === undefined);

        if (residual.length > 0) {
            throw new Error(
                `[fuzz WF-P${PROPERTY_INDEX} ${ctx.implementationName}] the reference disagrees with MongoDB in `
                + `${residual.length} way(s) that MONGO-DIVERGENCES.md does not explain `
                + `(seed=${seed} property=${PROPERTY_INDEX} iterations=${iterations}).\n\n`
                + `UNEXPLAINED:\n${JSON.stringify(residual, null, 2)}\n\n`
                + `EXPLAINED (for context, ${all.length - residual.length} shape(s)):\n`
                + JSON.stringify(all.filter(d => d.divergenceId !== undefined).map(d => ({ shape: d.shape, divergenceId: d.divergenceId, count: d.count })), null, 2),
            );
        }
    });
}
