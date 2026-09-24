import { describe, test, expect } from "vitest";
import { z } from "zod";
import type { DDL } from "../../ddl/types.ts";
import type { WriteAffectedItem, WriteResult } from "../types.ts";
import { writeToItemsArray } from "../writeToItemsArray/index.ts";
import { standardTests } from "./index.ts";
import type { AdapterFactory, WriteTestAdapter, WriteTestAdapterResult, WriteTestCapabilities } from "./harness.ts";

/**
 * TEETH for the `payloadFailureAttachesResolvedItem` capability.
 *
 * Proves the flag gates exactly one leaf of the battery — the §11.4 leaf that demands the resolved post-merge
 * item on a payload-derived failure — and nothing else: the row locator, the equality of any item that IS
 * attached, and the success side stay owed under both settings. Drives the PUBLIC `standardTests()` with a
 * recording runner so the registration shape (ran vs visibly skipped) is asserted, not just the leaf outcomes.
 * Only the §11 leaves are executed; every other section is registered but never run.
 */

type Any = Record<string, any>;
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

/** Wrap the honest adapter and rewrite its report on the way out. */
const tampered = (rewrite: (out: Result) => Result): AdapterFactory =>
    <T extends Record<string, any>>(schema: z.ZodType<T, any, any>, ddl: DDL<T>): WriteTestAdapter<T> => ({
        apply: async (cfg) => {
            const out = await honestFactory(schema, ddl).apply(cfg);
            if (out === undefined) return out;
            return rewrite(out as Result) as WriteTestAdapterResult<T>;
        },
    });

type Affected = WriteAffectedItem<Any>;
type Side = 'ok' | 'failed';

/** Immutably rewrite every affected item on outcomes of one side (`ok` or `failed`). */
const mapAffected = (out: Result, side: Side, f: (ai: Affected) => Affected): Result => {
    const actions: WriteResult<Any>['actions'] = out.result.actions.map(o => {
        const onSide = side === 'ok' ? o.ok : !o.ok;
        if (!onSide || !o.affected_items) return o;
        return { ...o, affected_items: o.affected_items.map(f) };
    });
    return { ...out, result: { ...out.result, actions } };
};

const ADAPTERS = {
    /** The reference, untouched. */
    honest: honestFactory,
    /** A layer that judged the payload before it had a row: locator kept, no item. */
    stripsItem: tampered(out => mapAffected(out, 'failed', ({ item_pk }) => ({ item_pk }))),
    /** As stripsItem, and the locator is wrong. */
    misreportsPk: tampered(out => mapAffected(out, 'failed', () => ({ item_pk: 'wrong' }))),
    /** Attaches a row, but the PRE-merge one rather than the merged one. */
    wrongItem: tampered(out => mapAffected(out, 'failed', ({ item_pk }) => ({ item_pk, item: { id: item_pk } }))),
    /** Exposes the row body on a success, which the contract withholds. */
    leaksItemOnSuccess: tampered(out => mapAffected(out, 'ok', ({ item_pk }) => ({ item_pk, item: { id: item_pk } }))),
} as const;

type Leaf = { path: string; fn: () => Promise<void> | void };
type Registration = { ran: Leaf[]; skipped: string[] };

/**
 * Register the whole battery under a recording runner. Every leaf is keyed by its describe path so the
 * registration shape can be diffed between capability settings.
 */
function register(factory: AdapterFactory, capabilities?: WriteTestCapabilities): Registration {
    const ran: Leaf[] = [];
    const skipped: string[] = [];
    const stack: string[] = [];
    const pathOf = (name: string) => [...stack, name].join(' > ');
    const record = (name: string, fn: Leaf['fn']) => { ran.push({ path: pathOf(name), fn }); };
    const noop = () => { /* noop */ };
    const fake = Object.assign(record, {
        skip: (name: string) => { skipped.push(pathOf(name)); },
        fails: record,
        only: record,
        todo: noop,
        each: () => noop,
    });
    /* eslint-disable @typescript-eslint/no-explicit-any -- a recording fake cannot structurally match vitest's TestAPI/SuiteAPI, and the global/import `expect` types differ */
    const fakeTest = fake as any;
    const fakeExpect = expect as any;
    const fakeDescribe = ((name: string, fn: () => void) => { stack.push(name); try { fn(); } finally { stack.pop(); } }) as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    standardTests({
        test: fakeTest,
        expect: fakeExpect,
        describe: fakeDescribe,
        createAdapter: factory,
        implementationName: 'capability-probe',
        // Omitted rather than `undefined` so the probe exercises the same "flag absent" path a consumer does.
        ...(capabilities ? { capabilities } : {}),
    });
    return { ran, skipped };
}

type Outcome = { path: string; passed: boolean; error?: string };

/** Execute only the §11 leaves of a registration. */
async function runSection11(reg: Registration): Promise<Outcome[]> {
    const results: Outcome[] = [];
    for (const { path, fn } of reg.ran.filter(l => l.path.startsWith('11. '))) {
        try { await fn(); results.push({ path, passed: true }); }
        catch (e) { results.push({ path, passed: false, error: e instanceof Error ? e.message : String(e) }); }
    }
    return results;
}

const DECLARED_FALSE: WriteTestCapabilities = { payloadFailureAttachesResolvedItem: false };

const LOCATOR_LEAF = '11. Error detail > 11.4 affected_items asymmetry & result.error > failure affected_items locate the offending row (any item they carry is the merged row); success affected_items carry only the PK';
const RESOLVED_ITEM_LEAF = '11. Error detail > 11.4 affected_items asymmetry & result.error > a failure judged from the submitted payload attaches the resolved post-merge item';

const failing = (results: Outcome[]) => results.filter(r => !r.passed).map(r => r.path);
const failingWithErrors = (results: Outcome[]) => results.filter(r => !r.passed).map(r => `${r.path}: ${r.error}`);
const difference = (a: string[], b: string[]) => a.filter(x => !b.includes(x));

describe('payloadFailureAttachesResolvedItem capability (teeth)', () => {

    describe('registration shape', () => {
        const byDefault = register(ADAPTERS.honest);
        const declared = register(ADAPTERS.honest, DECLARED_FALSE);
        const ranPaths = (r: Registration) => r.ran.map(l => l.path);

        test('the battery registers the resolved-item leaf under the defaults', () => {
            expect(ranPaths(byDefault)).toContain(RESOLVED_ITEM_LEAF);
            expect(ranPaths(byDefault)).toContain(LOCATOR_LEAF);
        });

        test('declaring false moves exactly the resolved-item leaf from ran to visibly skipped, across the whole battery', () => {
            expect(difference(ranPaths(byDefault), ranPaths(declared))).toEqual([RESOLVED_ITEM_LEAF]);
            expect(difference(ranPaths(declared), ranPaths(byDefault))).toEqual([]);
            expect(difference(declared.skipped, byDefault.skipped)).toEqual([RESOLVED_ITEM_LEAF]);
            expect(difference(byDefault.skipped, declared.skipped)).toEqual([]);
        });
    });

    describe('the honest reference', () => {
        test('passes every §11 leaf under the defaults', async () => {
            expect(failingWithErrors(await runSection11(register(ADAPTERS.honest)))).toEqual([]);
        });
        test('passes every §11 leaf when it declares false (an implementation that does attach the item is still held to it)', async () => {
            expect(failingWithErrors(await runSection11(register(ADAPTERS.honest, DECLARED_FALSE)))).toEqual([]);
        });
    });

    describe('a layer that judged the payload before it had a row (locator kept, no item)', () => {
        test('fails the resolved-item leaf, and only that leaf, under the defaults', async () => {
            expect(failing(await runSection11(register(ADAPTERS.stripsItem)))).toEqual([RESOLVED_ITEM_LEAF]);
        });
        test('passes every §11 leaf when it declares false', async () => {
            expect(failingWithErrors(await runSection11(register(ADAPTERS.stripsItem, DECLARED_FALSE)))).toEqual([]);
        });
    });

    describe('the flag never relaxes the locator', () => {
        test('a wrong item_pk fails the locator leaf under the defaults', async () => {
            expect(failing(await runSection11(register(ADAPTERS.misreportsPk)))).toContain(LOCATOR_LEAF);
        });
        test('a wrong item_pk fails the locator leaf when false is declared', async () => {
            expect(failing(await runSection11(register(ADAPTERS.misreportsPk, DECLARED_FALSE)))).toContain(LOCATOR_LEAF);
        });
    });

    describe('the flag never relaxes an item that IS attached', () => {
        test('attaching the pre-merge row fails the locator leaf under the defaults', async () => {
            expect(failing(await runSection11(register(ADAPTERS.wrongItem)))).toContain(LOCATOR_LEAF);
        });
        test('attaching the pre-merge row fails the locator leaf when false is declared', async () => {
            expect(failing(await runSection11(register(ADAPTERS.wrongItem, DECLARED_FALSE)))).toContain(LOCATOR_LEAF);
        });
    });

    describe('the flag never relaxes the success side', () => {
        test('exposing the row on a success fails the locator leaf under the defaults', async () => {
            expect(failing(await runSection11(register(ADAPTERS.leaksItemOnSuccess)))).toContain(LOCATOR_LEAF);
        });
        test('exposing the row on a success fails the locator leaf when false is declared', async () => {
            expect(failing(await runSection11(register(ADAPTERS.leaksItemOnSuccess, DECLARED_FALSE)))).toContain(LOCATOR_LEAF);
        });
    });
});
