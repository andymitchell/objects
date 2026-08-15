import type { WhereFilterDefinition } from "../../where-filter/index.ts";
import { writeToItemsArray } from "../writeToItemsArray/index.ts";
import { resolveCapability, type SectionCtx } from "./harness.ts";
import {
    mulberry32, mixSeed, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS,
    FuzzSchema, fuzzDdl, type FuzzItem, type Rng, makeWriteAction,
    genWorld, genWhere, genWriteAction, genBatch, genInvalidAction,
    sortByPk, matchedPks, valueDiffPks, touchedPks, fuzzDeepEqual, outcomeSignature, repro, invariant,
} from "./fuzz-internals.ts";

/**
 * §18: property-based / metamorphic fuzz.
 *
 * Eleven properties an implementation must uphold across thousands of generated worlds and batches. Most
 * are metamorphic (idempotence, inc composition, push-append length) or invariant (non-interference, input
 * immutability, atomic all-or-nothing, serialisability, outcome accounting); P1 is a DIFFERENTIAL oracle
 * comparing the adapter against the in-package reference engine (the one deliberate reference import). A
 * failure throws with the exact `(seed, propertyIndex, iteration)` triple so it replays deterministically.
 */
export function runFuzzSection(ctx: SectionCtx): void {
    const { describe } = ctx;
    const seed = ctx.fuzz?.seed ?? DEFAULT_FUZZ_SEED;
    const iterations = ctx.fuzz?.iterations ?? DEFAULT_FUZZ_ITERATIONS;
    const invalidWhereCorpus = resolveCapability(ctx.capabilities, 'invalidWhereCorpus');
    const reconstructs = resolveCapability(ctx.capabilities, 'reconstructsOutcomes');
    // `delete_property` joins the generated verb pool because removing a key is visible to the oracle below.
    // `set_property_undefined` deliberately does not: the oracle reads a present-but-empty key as an absent
    // one, so it cannot see the very state that verb produces, and §21 is where that distinction is judged.
    const deleteProperty = resolveCapability(ctx.capabilities, 'deleteProperty');

    const reference = (initialItems: FuzzItem[], actions: ReturnType<typeof genBatch>, options?: { atomic?: boolean }) =>
        writeToItemsArray(actions, structuredClone(initialItems), FuzzSchema, fuzzDdl, options);

    const runAdapter = async (initialItems: FuzzItem[], actions: ReturnType<typeof genBatch>, options?: { atomic?: boolean }) => {
        const adapter = ctx.createAdapter(FuzzSchema, fuzzDdl);
        return adapter.apply({ initialItems, writeActions: actions, schema: FuzzSchema, ddl: fuzzDdl, options });
    };

    const property = (idx: number, name: string, body: (rng: Rng, iter: number) => Promise<void>): void => {
        ctx.test(`18.${idx} ${name}`, async () => {
            for (let iter = 0; iter < iterations; iter++) {
                await body(mulberry32(mixSeed(seed, idx, iter)), iter);
            }
        });
    };

    describe('18. Property-based / metamorphic fuzz', () => {

        // P0 — a single action touches only rows it created or matched
        property(0, 'non-interference: an action leaves untouched rows byte-for-byte', async (rng, iter) => {
            const world = genWorld(rng);
            const action = genWriteAction(rng, world, 'u0', deleteProperty);
            const r = await runAdapter(world, [action]);
            if (r === undefined) return;
            const touched = touchedPks(action, world);
            for (const row of world) {
                if (touched.has(row.id)) continue;
                const after = r.finalItems.find(x => x.id === row.id);
                invariant(after !== undefined && fuzzDeepEqual(after, row), () => repro('P0', seed, 0, iter, world, [action], `untouched row ${row.id} changed`));
            }
        });

        // P1 — differential oracle vs the in-package reference engine
        property(1, 'differential oracle: adapter agrees with the reference engine', async (rng, iter) => {
            const world = genWorld(rng);
            const batch = genBatch(rng, world, deleteProperty);
            const atomic = rng.bool(0.3);
            const r = await runAdapter(world, batch, { atomic });
            if (r === undefined) return;
            const ref = reference(world, batch, { atomic });
            invariant(r.result.ok === ref.ok, () => repro('P1', seed, 1, iter, world, batch, `ok mismatch: adapter=${r.result.ok} ref=${ref.ok} atomic=${atomic}`));
            invariant(fuzzDeepEqual(sortByPk(r.finalItems), sortByPk(ref.changes.final_items)), () => repro('P1', seed, 1, iter, world, batch, `final_items mismatch atomic=${atomic}`));
            // A zero-match action produces NO engine outcome entry (actions is not 1:1 with the batch), and dual
            // outcomes can repeat a uuid — a synthesizing adapter cannot mirror that multiplicity. ok + final_items
            // above remain the differential core.
            if (!reconstructs) invariant(fuzzDeepEqual(outcomeSignature(r.result), outcomeSignature(ref)), () => repro('P1', seed, 1, iter, world, batch, `outcome signature mismatch atomic=${atomic}`));
        });

        // P2 — the caller's input world is never mutated
        property(2, 'input immutability: the world passed in is never mutated', async (rng, iter) => {
            const world = genWorld(rng);
            const snap = structuredClone(world);
            const batch = genBatch(rng, world, deleteProperty);
            const r = await runAdapter(world, batch, { atomic: rng.bool(0.3) });
            if (r === undefined) return;
            invariant(fuzzDeepEqual(world, snap), () => repro('P2', seed, 2, iter, snap, batch, 'caller world was mutated'));
        });

        // P3 — verb idempotence (add_to_set / merge-update / delete) under a FRESH uuid
        property(3, 'idempotence: repeating an idempotent verb is a no-op', async (rng, iter) => {
            const world = genWorld(rng);
            const where = genWhere(rng, world);
            const verb = rng.pick(['add_to_set', 'update', 'delete'] as const);
            const payload = verb === 'add_to_set'
                ? { type: 'add_to_set' as const, path: 'tags' as const, items: [rng.pick(['a', 'b', 'c', 'd'])], unique_by: 'deep_equals' as const, where }
                : verb === 'update'
                    ? { type: 'update' as const, data: { text: rng.pick(['x', 'y', 'z']) }, where }
                    : { type: 'delete' as const, where };
            const r1 = await runAdapter(world, [makeWriteAction('id1', payload)]);
            if (r1 === undefined) return;
            const r2 = await runAdapter(r1.finalItems, [makeWriteAction('id2', payload)]);
            if (r2 === undefined) return;
            invariant(fuzzDeepEqual(sortByPk(r1.finalItems), sortByPk(r2.finalItems)), () => repro('P3', seed, 3, iter, world, [payload], `verb=${verb} not idempotent`));
        });

        // P4 — inc composition: inc(a) then inc(b) equals inc(a+b) (count-independent where)
        property(4, 'inc composition: inc(a)+inc(b) equals inc(a+b)', async (rng, iter) => {
            const world = genWorld(rng);
            const where: WhereFilterDefinition<FuzzItem> = rng.bool(0.5) ? {} : { id: world.length ? rng.pick(world).id : 'missing' };
            const a = rng.intRange(-10, 10);
            const b = rng.intRange(-10, 10);
            // Skip the net-zero boundary: on a row with a MISSING count, inc(a)+inc(b) materialises the field
            // to 0 while inc(0) short-circuits as a no-op and leaves it missing — a defensible asymmetry, not
            // a composition failure. Away from a+b===0 the law holds for present and missing fields alike.
            if (a + b === 0) return;
            const split = await runAdapter(world, [
                makeWriteAction('i1', { type: 'inc', path: 'count', amount: a, where }),
                makeWriteAction('i2', { type: 'inc', path: 'count', amount: b, where }),
            ]);
            const combined = await runAdapter(world, [makeWriteAction('i3', { type: 'inc', path: 'count', amount: a + b, where })]);
            if (split === undefined || combined === undefined) return;
            invariant(fuzzDeepEqual(sortByPk(split.finalItems), sortByPk(combined.finalItems)), () => repro('P4', seed, 4, iter, world, [{ a, b, where }], 'inc composition broke'));
        });

        // P5 — push appends exactly k elements to a uniquely-targeted row
        property(5, 'push append: pushing k items grows the array by exactly k', async (rng, iter) => {
            const world = genWorld(rng);
            if (world.length === 0) return;
            const target = rng.pick(world);
            const before = target.tags?.length ?? 0;
            const items = Array.from({ length: rng.intRange(1, 3) }, () => rng.pick(['a', 'b', 'c', 'd']));
            const r = await runAdapter(world, [makeWriteAction('p0', { type: 'push', path: 'tags', items, where: { id: target.id } })]);
            if (r === undefined) return;
            const after = r.finalItems.find(x => x.id === target.id)?.tags?.length ?? 0;
            invariant(after === before + items.length, () => repro('P5', seed, 5, iter, world, [{ target: target.id, items }], `push length: before=${before} after=${after} k=${items.length}`));
        });

        // P6 — atomic all-or-nothing when a guaranteed-failing action is appended
        property(6, 'atomic all-or-nothing: a failing action rolls back the whole atomic batch', async (rng, iter) => {
            const world = genWorld(rng);
            const w = world.length ? world : [{ id: 'seed0', sub_items: [] } as FuzzItem];
            // Guaranteed-failing regardless of prior actions: a NaN count is always invalid_data_value.
            // (A duplicate-pk create is NOT guaranteed — an earlier generated delete could remove the target.)
            const failing = makeWriteAction('fail', { type: 'create', data: { id: 'fail_row', count: NaN, sub_items: [] } });
            const batch = [...genBatch(rng, w, deleteProperty), failing];
            const atomicR = await runAdapter(w, batch, { atomic: true });
            if (atomicR === undefined) return;
            invariant(atomicR.result.ok === false, () => repro('P6', seed, 6, iter, w, batch, 'atomic batch with a failing action reported ok'));
            invariant(fuzzDeepEqual(sortByPk(atomicR.finalItems), sortByPk(w)), () => repro('P6', seed, 6, iter, w, batch, 'atomic rollback did not restore the world'));
            const nonAtomicR = await runAdapter(w, batch, { atomic: false });
            if (nonAtomicR === undefined) return;
            const ref = reference(w, batch, { atomic: false });
            invariant(fuzzDeepEqual(sortByPk(nonAtomicR.finalItems), sortByPk(ref.changes.final_items)), () => repro('P6', seed, 6, iter, w, batch, 'non-atomic result diverged from reference'));
        });

        // P7 — the whole result survives a JSON round-trip
        property(7, 'serialisability: the result round-trips through JSON', async (rng, iter) => {
            const world = genWorld(rng);
            const batch = genBatch(rng, world, deleteProperty);
            const r = await runAdapter(world, batch);
            if (r === undefined) return;
            const round = JSON.parse(JSON.stringify(r.result));
            invariant(round.ok === r.result.ok, () => repro('P7', seed, 7, iter, world, batch, 'ok not preserved'));
            invariant(round.actions.length === r.result.actions.length, () => repro('P7', seed, 7, iter, world, batch, 'actions length not preserved'));
            r.result.actions.forEach((o, i) => {
                invariant(round.actions[i].ok === o.ok && round.actions[i].action_uuid === o.action_uuid, () => repro('P7', seed, 7, iter, world, batch, `action ${i} identity not preserved`));
                if (!o.ok) invariant(fuzzDeepEqual(round.actions[i].errors.map((e: { type: string }) => e.type), o.errors.map(e => e.type)), () => repro('P7', seed, 7, iter, world, batch, `action ${i} error types not preserved`));
            });
        });

        // P8 — a successful update/delete's affected_items exactly matches the where's PK set
        property(8, 'where oracle: affected_items equals the where PK set', async (rng, iter) => {
            const world = genWorld(rng);
            const where = genWhere(rng, world);
            const action = rng.bool(0.5)
                ? makeWriteAction('u0', { type: 'update', data: { text: rng.pick(['x', 'y', 'z']) }, where })
                : makeWriteAction('u0', { type: 'delete', where });
            const r = await runAdapter(world, [action]);
            if (r === undefined) return;
            const outcome = r.result.actions[0];
            if (outcome && outcome.ok) {
                const aiPks = (outcome.affected_items ?? []).map(ai => String(ai.item_pk)).sort();
                // A reconstruction-mode adapter reports the value-diff projection (a matched-but-unchanged row is
                // unobservable to it), so the expectation is the diff of the reference run, not the raw match set.
                const expected = reconstructs
                    ? valueDiffPks(world, reference(world, [action]).changes.final_items)
                    : matchedPks(world, where);
                invariant(fuzzDeepEqual(aiPks, expected), () => repro('P8', seed, 8, iter, world, [action], `affected_items ${JSON.stringify(aiPks)} != expected ${JSON.stringify(expected)}`));
            }
        });

        // P9 — every outcome uuid is a submitted uuid
        property(9, 'outcome accounting: every outcome uuid was submitted', async (rng, iter) => {
            const world = genWorld(rng);
            const batch = genBatch(rng, world, deleteProperty);
            const r = await runAdapter(world, batch);
            if (r === undefined) return;
            const submitted = new Set(batch.map(a => a.uuid));
            for (const o of r.result.actions) {
                invariant(submitted.has(o.action_uuid), () => repro('P9', seed, 9, iter, world, batch, `outcome uuid ${o.action_uuid} was not submitted`));
            }
            // Ideal `r.result.actions.length === batch.length` is NOT asserted — see §17/E.1 (dual outcomes
            // and E.4 collapse). Flip on to audit the atomic-per-action ideal once the engine implements it.
        });

        // P10 — a deliberately-invalid action is rejected, state unchanged
        property(10, 'invalid actions are rejected and mutate nothing', async (rng, iter) => {
            const world = genWorld(rng);
            const frozen = structuredClone(world);
            const action = genInvalidAction(rng, invalidWhereCorpus);
            const r = await runAdapter(world, [action]);
            if (r === undefined) return;
            invariant(r.result.ok === false, () => repro('P10', seed, 10, iter, world, [action], 'invalid action reported ok'));
            invariant(fuzzDeepEqual(sortByPk(r.finalItems), sortByPk(frozen)), () => repro('P10', seed, 10, iter, world, [action], 'invalid action mutated state'));
        });

        // P11 — a world holds one row per primary key, whatever the batch did to it. The reference engine is
        // checked directly as well as the adapter: where the adapter IS the reference, a differential property
        // can never see a defect they share, but this one can.
        property(11, 'unique keys: final_items never holds a primary key twice', async (rng, iter) => {
            const world = genWorld(rng);
            const batch = genBatch(rng, world, deleteProperty);
            const r = await runAdapter(world, batch, { atomic: rng.bool(0.3) });
            if (r === undefined) return;

            const firstDuplicate = (items: FuzzItem[]): string | undefined => {
                const seen = new Set<string>();
                for (const item of items) {
                    const key = String(item.id);
                    if (seen.has(key)) return key;
                    seen.add(key);
                }
                return undefined;
            };

            const adapterDup = firstDuplicate(r.finalItems);
            invariant(adapterDup === undefined, () => repro('P11', seed, 11, iter, world, batch, `adapter final_items holds primary key ${adapterDup} twice`));

            const referenceDup = firstDuplicate(reference(world, batch).changes.final_items);
            invariant(referenceDup === undefined, () => repro('P11', seed, 11, iter, world, batch, `reference final_items holds primary key ${referenceDup} twice`));
        });
    });
}
