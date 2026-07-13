import { describe, test, expect } from "vitest";
import { z } from "zod";
import type { DDL } from "../../ddl/types.ts";
import type { WriteAction, WriteOutcome } from "../types.ts";
import { writeToItemsArray } from "../writeToItemsArray/index.ts";
import type { AdapterFactory, WriteTestAdapter, WriteTestAdapterResult, SectionCtx } from "./harness.ts";
import { runFuzzSection } from "./fuzz.ts";
import { DEFAULT_FUZZ_SEED } from "./fuzz-internals.ts";

/**
 * TEETH for §18. This dev-only harness proves the fuzz section actually catches misbehaving adapters
 * rather than passing everything. It runs ONLY `runFuzzSection` (the full battery accrues expected-fail
 * reds, so it is the wrong yardstick) against:
 *   - an HONEST adapter (twin of writeToItemsArray.test.ts's) → every property must pass;
 *   - twelve GROUP-A saboteurs, each a small deliberate defect → at least one property must catch it,
 *     including the specific properties we claim guard that behaviour;
 *   - one GROUP-B saboteur (referential aliasing) → invisible to a value-only fuzz, documenting the boundary.
 */

type Any = Record<string, any>;
type ApplyCfg = Parameters<WriteTestAdapter<Any>['apply']>[0];
type Result = NonNullable<WriteTestAdapterResult<Any>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod v3/v4 generic variance mismatch (matches the real adapter)
const honestFactory: AdapterFactory = <T extends Record<string, any>>(_schema: z.ZodType<T, any, any>, _ddl: DDL<T>) => ({
    apply: async ({ initialItems, writeActions, options, schema, ddl }) => {
        const items = structuredClone(initialItems);
        const result = writeToItemsArray(writeActions, items, schema, ddl, {
            atomic: options?.atomic,
            attempt_recover_duplicate_create: options?.attempt_recover_duplicate_create,
        });
        return { result, changes: result.changes, finalItems: result.changes.final_items };
    },
});

type SaboteurOps = {
    mutateInput?: (cfg: ApplyCfg) => ApplyCfg;
    tamperOutput?: (out: Result, cfg: ApplyCfg) => Result;
};

const saboteur = (ops: SaboteurOps): AdapterFactory =>
    <T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>): WriteTestAdapter<T> => ({
        apply: async (cfg) => {
            const input = ops.mutateInput ? ops.mutateInput(cfg as ApplyCfg) : (cfg as ApplyCfg);
            const out = await honestFactory(schema, ddl).apply(input as Parameters<WriteTestAdapter<T>['apply']>[0]);
            if (out === undefined) return out;
            return (ops.tamperOutput ? ops.tamperOutput(out as Result, input) : out) as WriteTestAdapterResult<T>;
        },
    });

// ── views for the deliberately-wrong bits (single assertions, no `as any`) ──
const okOutcome = (uuid: string): WriteOutcome<Any> => ({ ok: true, action_uuid: uuid });
const cloneActions = (cfg: ApplyCfg): WriteAction<Any>[] => structuredClone(cfg.writeActions);
const payloadOf = (a: WriteAction<Any>): { type: string; where?: unknown; unique_by?: unknown; amount?: number } => a.payload as { type: string; where?: unknown; unique_by?: unknown; amount?: number };

type Saboteur = { name: string; ops: SaboteurOps; trips: number[] };

const GROUP_A: Saboteur[] = [
    {
        name: 'S1 ignoresWhere', trips: [1, 8],
        ops: { mutateInput: (cfg) => ({ ...cfg, writeActions: cloneActions(cfg).map(a => { const p = payloadOf(a); if ('where' in p) p.where = {}; return a; }) }) },
    },
    {
        name: 'S2 reportsOkOnFailure', trips: [1, 10],
        ops: { tamperOutput: (out) => { out.result.ok = true; out.result.actions = out.result.actions.map(o => (o.ok ? o : okOutcome(o.action_uuid))); return out; } },
    },
    {
        name: 'S3 staleFinalItems', trips: [1],
        ops: { tamperOutput: (out, cfg) => ({ ...out, finalItems: structuredClone(cfg.initialItems) }) },
    },
    {
        name: 'S4 reverseActionOrder', trips: [1],
        ops: { mutateInput: (cfg) => ({ ...cfg, writeActions: [...cfg.writeActions].reverse() }) },
    },
    {
        name: 'S5 mutatesCallerInitialItems', trips: [2],
        ops: { mutateInput: (cfg) => { if (cfg.initialItems[0]) (cfg.initialItems[0] as Record<string, unknown>).__poison = true; return cfg; } },
    },
    {
        name: 'S6 offByOneInc', trips: [1, 4],
        ops: { mutateInput: (cfg) => ({ ...cfg, writeActions: cloneActions(cfg).map(a => { const p = payloadOf(a); if (p.type === 'inc' && typeof p.amount === 'number') p.amount += 1; return a; }) }) },
    },
    {
        // P3 (add_to_set idempotence) manufactures the duplicate-add case on every generated add_to_set, so it
        // is the property that guards dedupe semantics by construction — the differential oracle only sees this
        // saboteur when the generated corpus happens to contain a duplicate add.
        name: 'S7 addToSetPushesDuplicates', trips: [3],
        ops: { mutateInput: (cfg) => ({ ...cfg, writeActions: cloneActions(cfg).map(a => { const p = payloadOf(a); if (p.type === 'add_to_set') { p.type = 'push'; delete p.unique_by; } return a; }) }) },
    },
    {
        name: 'S8 dropsAffectedItems', trips: [8],
        ops: { tamperOutput: (out) => { out.result.actions.forEach(o => { if (o.ok) delete (o as { affected_items?: unknown }).affected_items; }); return out; } },
    },
    {
        name: 'S9 overReportsAffectedItems', trips: [8],
        ops: { tamperOutput: (out) => { out.result.actions.forEach(o => { if (o.ok) o.affected_items = [...(o.affected_items ?? []), { item_pk: '__ghost__' }]; }); return out; } },
    },
    {
        name: 'S10 rogueOutcomeUuid', trips: [9],
        ops: { tamperOutput: (out) => { if (out.result.actions[0]) out.result.actions[0].action_uuid = '__rogue__'; return out; } },
    },
    {
        name: 'S11 swallowsInvalidData', trips: [10],
        ops: {
            tamperOutput: (out) => {
                const r = out.result;
                r.actions = r.actions.map(o => (!o.ok && o.errors.some(e => e.type === 'invalid_data_value' || e.type === 'invalid_filter')) ? okOutcome(o.action_uuid) : o);
                if (r.actions.every(o => o.ok)) r.ok = true;
                return out;
            },
        },
    },
    {
        name: 'S12 swallowsBlockedActions', trips: [1],
        ops: {
            tamperOutput: (out) => {
                const r = out.result;
                r.actions = r.actions.map(o => (!o.ok && o.errors.some(e => e.type === 'blocked')) ? okOutcome(o.action_uuid) : o);
                if (r.actions.every(o => o.ok)) r.ok = true;
                return out;
            },
        },
    },
    {
        name: 'S14 duplicatesPrimaryKey', trips: [11],
        ops: {
            tamperOutput: (out) => {
                const first = out.finalItems[0];
                if (first) out.finalItems = [...out.finalItems, structuredClone(first)];
                return out;
            },
        },
    },
];

// GROUP B — a referential-aliasing impl produces value-identical output, so a value-only fuzz cannot see it.
const S13: Saboteur = { name: 'S13 aliasing', trips: [], ops: { tamperOutput: (out) => out } };

type Collected = { name: string; passed: boolean; error?: string };

async function collectFuzzResults(factory: AdapterFactory): Promise<Collected[]> {
    const collected: { name: string; fn: () => Promise<void> | void }[] = [];
    const fake = Object.assign(
        (name: string, fn: () => Promise<void> | void) => { collected.push({ name, fn }); },
        { skip: () => { /* noop */ }, only: (name: string, fn: () => Promise<void> | void) => collected.push({ name, fn }), fails: (name: string, fn: () => Promise<void> | void) => collected.push({ name, fn }), todo: () => { /* noop */ }, each: () => () => { /* noop */ } },
    );
    /* eslint-disable @typescript-eslint/no-explicit-any -- deliberate fake `test` collector + vitest global/import expect-type mismatch */
    const fakeTest = fake as any;
    const fakeExpect = expect as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ctx: SectionCtx = {
        test: fakeTest,
        expect: fakeExpect,
        createAdapter: factory,
        implName: 'saboteur-probe',
        itIfSupported: () => fakeTest,
        expectedFailToday: fakeTest,
        capabilities: { invalidWhereCorpus: true },
        fuzz: { iterations: 40, seed: DEFAULT_FUZZ_SEED },
    };

    // Swap the ambient global `describe` (which the section files call) for a synchronous invoker, so the
    // property registrations run inline into `collected` instead of registering with the real runner.
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

const failingIndices = (results: Collected[]): Set<number> =>
    new Set(results.filter(r => !r.passed).map(r => Number(r.name.split(' ')[0]!.split('.')[1])));

describe('§18 fuzz saboteur harness (teeth)', () => {

    test('the honest reference adapter passes every fuzz property', async () => {
        const results = await collectFuzzResults(honestFactory);
        expect(results.filter(r => !r.passed).map(r => `${r.name}: ${r.error}`)).toEqual([]);
    });

    for (const sab of GROUP_A) {
        test(`${sab.name} is caught (expected trips: ${sab.trips.map(i => 'P' + i).join(', ')})`, async () => {
            const failing = failingIndices(await collectFuzzResults(saboteur(sab.ops)));
            expect(failing.size).toBeGreaterThan(0);
            for (const idx of sab.trips) expect(failing.has(idx)).toBe(true);
        });
    }

    test('S13 aliasing is invisible to the value-only fuzz (documents the boundary)', async () => {
        const results = await collectFuzzResults(saboteur(S13.ops));
        expect(results.filter(r => !r.passed)).toEqual([]);
    });
});
