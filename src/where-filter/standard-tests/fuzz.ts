import matchJavascriptObjectReference from "../matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";
import {
    mulberry32, mixSeed, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS,
    FuzzSchema, type FuzzRow, type Rng, asFilter, NESTED_ARRAY_PATH,
    genRow, genFilter, genComboPair, genElemMatchCombo, genLeafScopeOps,
    leafScopeFilterPayload, slowLeafScopeEval, REJECTING_FILTERS, invariant, repro,
} from "./fuzz-internals.ts";

/**
 * §24: seeded differential + metamorphic fuzz.
 *
 * WF-P0 asserts crash-safety; WF-P1 is the DIFFERENTIAL oracle comparing the adapter under test against
 * the in-package JS reference matcher (the one deliberate reference import). WF-P2–P8 are metamorphic laws
 * (De Morgan, double-negation, `$in`≡`$or` of `$eq`, commutativity/idempotence, monotonicity, `$nor`≡¬`$or`,
 * empty-logic identities) that only compare the adapter against ITSELF, so they hold even where an engine
 * diverges from the reference. WF-P9 pins the rejection contract.
 *
 * WF-P10–P12 police multi-operator payloads, the shape a first-operator-wins dispatch silently truncates:
 * the AND law at the top level (`{p:{opA,opB}} ≡ {$and:[{p:{opA}},{p:{opB}}]}`), the complement law under
 * `$not`, and the implication law inside a scalar `$elemMatch`. WF-P13 checks a compound predicate on a path
 * crossing two arrays against an independent leaf-scope evaluator.
 *
 * Every failure throws with the exact `(seed, propertyIndex, iteration)` triple so it replays deterministically.
 * The generator's uniform profile is confined to operators the example sections proved agree across all three
 * engines — a WF-P1 red means a NEW divergence the profile missed: tighten the generator, never the assertion.
 */
export function runFuzzSection(ctx: SectionCtx): void {
    const seed = ctx.fuzz?.seed ?? DEFAULT_FUZZ_SEED;
    const iterations = ctx.fuzz?.iterations ?? DEFAULT_FUZZ_ITERATIONS;

    const run = (row: FuzzRow, f: WhereFilterDefinition<FuzzRow>): Promise<boolean | undefined> => ctx.matchJavascriptObject(row, f, FuzzSchema);
    const oracle = (row: FuzzRow, f: WhereFilterDefinition<FuzzRow>): boolean => matchJavascriptObjectReference(row, f);

    const property = (idx: number, name: string, body: (rng: Rng, iter: number) => Promise<'ok' | 'skip'>): void => {
        ctx.test(`24.${idx} WF-P${idx} — ${name}`, async () => {
            let skipped = 0;
            for (let iter = 0; iter < iterations; iter++) {
                if (await body(mulberry32(mixSeed(seed, idx, iter)), iter) === 'skip') skipped++;
            }
            if (skipped > 0) console.warn(`[fuzz WF-P${idx} ${ctx.implementationName}] skipped ${skipped}/${iterations} (unsupported → undefined)`);
        });
    };

    describe('24. Fuzz — differential & metamorphic', () => {

        // WF-P0 — any uniform filter yields boolean|undefined and never throws
        property(0, 'crash-safety: a uniform filter never throws', async (rng, iter) => {
            const row = genRow(rng);
            const f = genFilter(rng, row);
            let res: boolean | undefined;
            try {
                res = await run(row, f);
            } catch (e) {
                invariant(false, () => repro('WF-P0', seed, 0, iter, row, f, `threw: ${(e as Error).message}`));
                return 'ok';
            }
            invariant(res === undefined || typeof res === 'boolean', () => repro('WF-P0', seed, 0, iter, row, f, `non-boolean result: ${String(res)}`));
            return 'ok';
        });

        // WF-P1 — differential oracle vs the in-package reference matcher
        property(1, 'differential: adapter agrees with the JS reference', async (rng, iter) => {
            const row = genRow(rng);
            const f = genFilter(rng, row);
            const got = await run(row, f);
            if (got === undefined) return 'skip';
            const exp = oracle(row, f);
            invariant(got === exp, () => repro('WF-P1', seed, 1, iter, row, f, `adapter=${got} reference=${exp}`));
            return 'ok';
        });

        // WF-P2 — De Morgan: ¬(A∧B) ≡ (¬A)∨(¬B)
        property(2, 'De Morgan', async (rng, iter) => {
            const row = genRow(rng);
            const A = genFilter(rng, row, 2);
            const B = genFilter(rng, row, 2);
            const lhs = await run(row, { $nor: [{ $and: [A, B] }] });
            const rhs = await run(row, { $or: [{ $nor: [A] }, { $nor: [B] }] });
            if (lhs === undefined || rhs === undefined) return 'skip';
            invariant(lhs === rhs, () => repro('WF-P2', seed, 2, iter, row, { A, B }, `lhs=${lhs} rhs=${rhs}`));
            return 'ok';
        });

        // WF-P3 — double negation: ¬¬F ≡ F
        property(3, 'double negation', async (rng, iter) => {
            const row = genRow(rng);
            const F = genFilter(rng, row, 2);
            const dn = await run(row, { $nor: [{ $nor: [F] }] });
            const f = await run(row, F);
            if (dn === undefined || f === undefined) return 'skip';
            invariant(dn === f, () => repro('WF-P3', seed, 3, iter, row, F, `¬¬F=${dn} F=${f}`));
            return 'ok';
        });

        // WF-P4 — $in ≡ $or of $eq on a scalar field
        property(4, '$in ≡ $or of $eq', async (rng, iter) => {
            const row = genRow(rng);
            const useName = rng.bool();
            const values: (string | number)[] = Array.from({ length: rng.intRange(1, 3) }, () =>
                useName ? rng.pick(['ann', 'bob', 'cid', 'dan']) : rng.intRange(-10, 20));
            const inFilter = asFilter(useName ? { name: { $in: values } } : { age: { $in: values } });
            const orFilter = asFilter({ $or: values.map(v => (useName ? { name: { $eq: v } } : { age: { $eq: v } })) });
            const a = await run(row, inFilter);
            const b = await run(row, orFilter);
            if (a === undefined || b === undefined) return 'skip';
            invariant(a === b, () => repro('WF-P4', seed, 4, iter, row, { inFilter, orFilter }, `$in=${a} $or-of-$eq=${b}`));
            return 'ok';
        });

        // WF-P5 — commutativity + idempotence of $and / $or
        property(5, 'commutativity + idempotence', async (rng, iter) => {
            const row = genRow(rng);
            const A = genFilter(rng, row, 2);
            const B = genFilter(rng, row, 2);
            const op = rng.pick(['$and', '$or'] as const);
            const ab = await run(row, { [op]: [A, B] });
            const ba = await run(row, { [op]: [B, A] });
            const aa = await run(row, { [op]: [A, A] });
            const a1 = await run(row, { [op]: [A] });
            if ([ab, ba, aa, a1].some(x => x === undefined)) return 'skip';
            invariant(ab === ba, () => repro('WF-P5', seed, 5, iter, row, { op, A, B }, `commutativity: ${op}[A,B]=${ab} ${op}[B,A]=${ba}`));
            invariant(aa === a1, () => repro('WF-P5', seed, 5, iter, row, { op, A }, `idempotence: ${op}[A,A]=${aa} ${op}[A]=${a1}`));
            return 'ok';
        });

        // WF-P6 — monotonicity: $and narrows, $or widens
        property(6, 'monotonicity', async (rng, iter) => {
            const row = genRow(rng);
            const A = genFilter(rng, row, 2);
            const B = genFilter(rng, row, 2);
            const andAB = await run(row, { $and: [A, B] });
            const andA = await run(row, { $and: [A] });
            const orA = await run(row, { $or: [A] });
            const orAB = await run(row, { $or: [A, B] });
            if ([andAB, andA, orA, orAB].some(x => x === undefined)) return 'skip';
            if (andAB === true) invariant(andA === true, () => repro('WF-P6', seed, 6, iter, row, { A, B }, `$and[A,B]=T but $and[A]=${andA}`));
            if (orA === true) invariant(orAB === true, () => repro('WF-P6', seed, 6, iter, row, { A, B }, `$or[A]=T but $or[A,B]=${orAB}`));
            return 'ok';
        });

        // WF-P7 — $nor ≡ ¬$or over a single arm
        property(7, '$nor ≡ ¬$or', async (rng, iter) => {
            const row = genRow(rng);
            const F = genFilter(rng, row, 2);
            const nor = await run(row, { $nor: [F] });
            const or = await run(row, { $or: [F] });
            if (nor === undefined || or === undefined) return 'skip';
            invariant(nor === !or, () => repro('WF-P7', seed, 7, iter, row, F, `$nor[F]=${nor} $or[F]=${or}`));
            return 'ok';
        });

        // WF-P8 — empty-logic identities
        property(8, 'empty-logic identities', async (rng, iter) => {
            const row = genRow(rng);
            const F = genFilter(rng, row, 2);
            const andEmpty = await run(row, { $and: [] });
            const orEmpty = await run(row, { $or: [] });
            const norEmpty = await run(row, { $nor: [] });
            if (andEmpty !== undefined) invariant(andEmpty === true, () => repro('WF-P8', seed, 8, iter, row, {}, `$and[]=${andEmpty}`));
            if (orEmpty !== undefined) invariant(orEmpty === false, () => repro('WF-P8', seed, 8, iter, row, {}, `$or[]=${orEmpty}`));
            if (norEmpty !== undefined) invariant(norEmpty === true, () => repro('WF-P8', seed, 8, iter, row, {}, `$nor[]=${norEmpty}`));
            const justF = await run(row, F);
            const orF = await run(row, { $or: [F] });
            if (justF !== undefined && orF !== undefined) invariant(orF === justF, () => repro('WF-P8', seed, 8, iter, row, F, `$or[F]=${orF} F=${justF}`));
            // An empty sub-filter `{}` is match-all: the identity of $and (`$and:[F,{}] ≡ F`) and the absorber of
            // $or (`$or:[F,{}] ≡ match-all`). The empty arm must contribute `1 = 1`, never a dangling clause.
            const andFEmpty = await run(row, asFilter({ $and: [F, {}] }));
            if (justF !== undefined && andFEmpty !== undefined) invariant(andFEmpty === justF, () => repro('WF-P8', seed, 8, iter, row, F, `$and[F,{}]=${andFEmpty} F=${justF}`));
            const orFEmpty = await run(row, asFilter({ $or: [F, {}] }));
            if (orFEmpty !== undefined) invariant(orFEmpty === true, () => repro('WF-P8', seed, 8, iter, row, F, `$or[F,{}]=${orFEmpty} (match-all expected)`));
            return 'ok';
        });

        // WF-P9 — the rejection contract holds for the reject corpus (row-independent; a few rows suffice)
        property(9, 'rejection contract', async (rng, iter) => {
            if (iter >= 3) return 'ok';
            const row = genRow(rng);
            for (const h of REJECTING_FILTERS) {
                await ctx.expectMalformedFilterRejected(() => run(row, asFilter(h)));
            }
            return 'ok';
        });

        // WF-P10 — multi-operator AND law: a payload of several operators means their conjunction, exactly
        // as splitting them into a $and of one-operator payloads. Catches first-operator-wins dispatch. The
        // combo generator also feeds the uniform profile (via genLeaf), so WF-P1's differential exercises
        // multi-operator payloads on every engine too.
        property(10, 'multi-operator AND law', async (rng, iter) => {
            const row = genRow(rng);
            const { field, opA, opB, a, b } = genComboPair(rng, row);
            const combo = asFilter({ [field]: { [opA]: a, [opB]: b } });
            const split = asFilter({ $and: [{ [field]: { [opA]: a } }, { [field]: { [opB]: b } }] });
            const got = await run(row, combo);
            const exp = await run(row, split);
            if (got === undefined || exp === undefined) return 'skip';
            invariant(got === exp, () => repro('WF-P10', seed, 10, iter, row, { combo, split }, `combo=${got} and-split=${exp}`));
            return 'ok';
        });

        // WF-P11 — $not is the complement of its operand. `{p:{$not:X}}` matches exactly the rows `{p:X}` does
        // not, whatever X is and whether or not p is present. An engine that drops an operator inside $not, or
        // short-circuits $not on a missing field, breaks the complement.
        property(11, '$not complement', async (rng, iter) => {
            const row = genRow(rng);
            const { field, opA, opB, a, b } = genComboPair(rng, row);
            const inner = { [opA]: a, [opB]: b };
            const negated = await run(row, asFilter({ [field]: { $not: inner } }));
            const plain = await run(row, asFilter({ [field]: inner }));
            if (negated === undefined || plain === undefined) return 'skip';
            invariant(negated === !plain, () => repro('WF-P11', seed, 11, iter, row, { field, inner }, `$not=${negated} inner=${plain}`));
            return 'ok';
        });

        // WF-P12 — a scalar $elemMatch conjunction implies each of its operators alone. One element satisfying
        // both operators satisfies each of them, so weakening the body can only widen the match. The converse
        // does not hold (two elements may satisfy one operator each), which is what makes this a necessary
        // condition an operator-dropping engine still fails.
        property(12, 'scalar $elemMatch AND-implication', async (rng, iter) => {
            const row = genRow(rng);
            const { field, opA, opB, a, b } = genElemMatchCombo(rng, row);
            const both = await run(row, asFilter({ [field]: { $elemMatch: { [opA]: a, [opB]: b } } }));
            const onlyA = await run(row, asFilter({ [field]: { $elemMatch: { [opA]: a } } }));
            const onlyB = await run(row, asFilter({ [field]: { $elemMatch: { [opB]: b } } }));
            if ([both, onlyA, onlyB].some(x => x === undefined)) return 'skip';
            if (both === true) {
                const detail = { field, opA, a, opB, b };
                invariant(onlyA === true, () => repro('WF-P12', seed, 12, iter, row, detail, `both=true but ${opA} alone=${onlyA}`));
                invariant(onlyB === true, () => repro('WF-P12', seed, 12, iter, row, detail, `both=true but ${opB} alone=${onlyB}`));
            }
            return 'ok';
        });

        // WF-P13 — a compound predicate on a path crossing two arrays must be satisfied within ONE leaf array,
        // judged against a hand-written evaluator rather than the engine's own traversal. An engine that scopes
        // each operator to the whole spread pools elements from different leaves and matches too much.
        property(13, 'nested-array leaf scope', async (rng, iter) => {
            const row = genRow(rng);
            const ops = genLeafScopeOps(rng, row);
            const filter = asFilter({ [NESTED_ARRAY_PATH]: leafScopeFilterPayload(ops) });
            const got = await run(row, filter);
            if (got === undefined) return 'skip';
            const exp = slowLeafScopeEval(row, ops);
            invariant(got === exp, () => repro('WF-P13', seed, 13, iter, row, filter, `engine=${got} leaf-scope oracle=${exp}`));
            return 'ok';
        });
    });
}
