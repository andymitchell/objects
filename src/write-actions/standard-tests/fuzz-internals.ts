import { z } from "zod";
import type { WriteAction } from "../types.ts";
import type { WriteResult } from "../types.ts";
import type { DDL } from "../../ddl/types.ts";
import type { WhereFilterDefinition } from "../../where-filter/index.ts";
import { matchJavascriptObject } from "../../where-filter/index.ts";
import { assertWriteArrayScope } from "../helpers.ts";

// ═══════════════════════════════════════════════════════════════════
// Deterministic PRNG (mulberry32) — failures replay from (seed, propertyIndex, iteration)
// ═══════════════════════════════════════════════════════════════════

export type Rng = {
    next(): number;
    int(n: number): number;
    intRange(lo: number, hi: number): number;
    bool(p?: number): boolean;
    pick<X>(arr: readonly X[]): X;
};

export function mulberry32(seed: number): Rng {
    let a = seed >>> 0;
    const next = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n: number) => Math.floor(next() * n);
    return { next, int, intRange: (lo, hi) => lo + int(hi - lo + 1), bool: (p = 0.5) => next() < p, pick: (arr) => arr[int(arr.length)]! };
}

/** Combine the base seed with a property index and iteration into a stable per-run seed. */
export function mixSeed(base: number, propertyIndex: number, iteration: number): number {
    return (base ^ Math.imul(propertyIndex, 0x9E3779B1) ^ Math.imul(iteration, 0x85EBCA77)) >>> 0;
}

export const DEFAULT_FUZZ_SEED = 0x1F2E3D4C;
export const DEFAULT_FUZZ_ITERATIONS = 100;

// ═══════════════════════════════════════════════════════════════════
// Fixture (faithful local copy of FlatWithSubItems — see fixtures.ts for the canonical version)
// ═══════════════════════════════════════════════════════════════════

export const FuzzSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    count: z.number().optional(),
    tags: z.array(z.string()).optional(),
    sub_items: z.array(z.object({ sid: z.string(), val: z.number().optional() }).strict()).optional(),
}).strict();
export type FuzzItem = z.infer<typeof FuzzSchema>;
type SubItem = { sid: string; val?: number };

export const fuzzDdl: DDL<FuzzItem> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'sub_items': { primary_key: 'sid' },
    },
};

const TEXT_POOL = ['x', 'y', 'z'] as const;
const TAG_POOL = ['a', 'b', 'c', 'd'] as const;

/** Local action builder — `ts: 0` keeps generation deterministic (never Date.now). */
export function makeWriteAction(uuid: string, payload: WriteAction<FuzzItem>['payload']): WriteAction<FuzzItem> {
    return { type: 'write', ts: 0, uuid, payload };
}

// ═══════════════════════════════════════════════════════════════════
// Generators (every value JSON-safe, so a generated action is always one the engine will accept)
// ═══════════════════════════════════════════════════════════════════

/**
 * Primary keys that collide with an `Object.prototype` member name. They are ordinary strings, so they must
 * behave as inert data — but an implementation indexing rows in a plain `{}` inherits a truthy member for a
 * key it never wrote (and `__proto__` reaches a setter rather than storing), which silently loses or corrupts
 * rows. Seeding them into the world puts EVERY property in this file behind that trap.
 */
const PROTOTYPE_NAME_IDS = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'] as const;

/** The id a generated row takes: usually plain, occasionally one that a plain-object index would mishandle. */
const genId = (rng: Rng, i: number): string => (rng.bool(0.2) ? rng.pick(PROTOTYPE_NAME_IDS) : 'k' + i);

export function genWorld(rng: Rng): FuzzItem[] {
    const n = rng.int(9); // 0-8
    const items: FuzzItem[] = [];
    const taken = new Set<string>();
    for (let i = 0; i < n; i++) {
        // A world may not hold a primary key twice — a generated duplicate would be an invalid premise, not a
        // finding, so it falls back to the plain id (which is unique by construction).
        const candidate = genId(rng, i);
        const id = taken.has(candidate) ? 'k' + i : candidate;
        taken.add(id);
        const item: FuzzItem = { id };
        if (rng.bool(0.7)) item.text = rng.pick(TEXT_POOL);
        if (rng.bool(0.6)) item.count = rng.intRange(-10, 10);
        if (rng.bool(0.5)) item.tags = Array.from({ length: rng.int(5) }, () => rng.pick(TAG_POOL));
        // sub_items is sometimes ABSENT: it is optional in the schema, and every verb (array_scope included)
        // must treat a missing object-array as zero targets — worlds with the field omitted keep the whole
        // property set honest about that.
        if (rng.bool(0.8)) {
            item.sub_items = Array.from({ length: rng.int(5) }, (_, j) => {
                const si: SubItem = { sid: 's' + j };
                if (rng.bool(0.7)) si.val = rng.intRange(-10, 10);
                return si;
            });
        }
        items.push(item);
    }
    return items;
}

export function genWhere(rng: Rng, world: FuzzItem[]): WhereFilterDefinition<FuzzItem> {
    const existingId = (): string => (world.length && rng.bool(0.7) ? rng.pick(world).id : 'missing');
    switch (rng.int(7)) {
        case 0: return {};
        case 1: return { id: existingId() };
        case 2: return { text: rng.pick(TEXT_POOL) };
        case 3: return { count: { $gt: rng.intRange(-5, 5) } };
        case 4: return { count: { $gte: -100, $lte: 100 } };
        case 5: return { $or: [{ id: existingId() }, { text: rng.pick(TEXT_POOL) }] };
        default: return { tags: rng.pick(TAG_POOL) } as WhereFilterDefinition<FuzzItem>;
    }
}

const genUpdateData = (rng: Rng): Partial<FuzzItem> => {
    const data: Partial<FuzzItem> = {};
    do {
        if (rng.bool(0.5)) data.text = rng.pick(TEXT_POOL);
        if (rng.bool(0.5)) data.count = rng.intRange(-10, 10);
        if (rng.bool(0.4)) data.tags = Array.from({ length: rng.int(4) }, () => rng.pick(TAG_POOL));
    } while (Object.keys(data).length === 0);
    return data;
};

const genSubItem = (rng: Rng): SubItem => {
    const si: SubItem = { sid: 'sn' + rng.int(100) };
    if (rng.bool(0.7)) si.val = rng.intRange(-10, 10);
    return si;
};

type FuzzVerb = 'create' | 'update' | 'delete' | 'array_scope' | 'add_to_set' | 'push' | 'pull' | 'inc' | 'delete_property';

const WEIGHTED_VERBS: readonly [FuzzVerb, number][] = [
    ['create', 2], ['update', 3], ['delete', 2], ['array_scope', 2], ['add_to_set', 2], ['push', 2], ['pull', 2], ['inc', 2], ['delete_property', 2],
];

/**
 * Fields a `delete_property` may target. `sub_items` is an array of objects, which no property verb may
 * remove, and `id` is the primary key — both are refusals rather than writes, and P10 is where deliberate
 * refusals belong.
 */
const REMOVABLE_PATHS = ['text', 'count', 'tags'] as const;

const pickVerb = (rng: Rng, deleteProperty: boolean): FuzzVerb => {
    const verbs = deleteProperty ? WEIGHTED_VERBS : WEIGHTED_VERBS.filter(([verb]) => verb !== 'delete_property');
    const total = verbs.reduce((s, [, w]) => s + w, 0);
    let r = rng.int(total);
    for (const [verb, w] of verbs) { if (r < w) return verb; r -= w; }
    return 'update';
};

/**
 * @param deleteProperty Whether the implementation under test supports `delete_property`; when it does not,
 *                       the verb is left out of the pool rather than generating actions it cannot perform.
 */
export function genWriteAction(rng: Rng, world: FuzzItem[], uuid: string, deleteProperty: boolean): WriteAction<FuzzItem> {
    const where = genWhere(rng, world);
    switch (pickVerb(rng, deleteProperty)) {
        case 'create': {
            const dup = world.length > 0 && rng.bool(0.15);
            // A fresh create sometimes takes a prototype-member name, so the insert path meets the same trap as
            // the world (see PROTOTYPE_NAME_IDS): a plain-object index reads it as already-present and loses it.
            const fresh = rng.bool(0.2) ? rng.pick(PROTOTYPE_NAME_IDS) : 'n' + rng.int(1000);
            const id = dup ? rng.pick(world).id : fresh;
            // sub_items is always present (see genWorld) so a later same-batch array_scope never hits an
            // undefined array on this freshly-created row.
            const data: FuzzItem = { id, sub_items: [] };
            if (rng.bool(0.6)) data.text = rng.pick(TEXT_POOL);
            if (rng.bool(0.6)) data.count = rng.intRange(-10, 10);
            return makeWriteAction(uuid, { type: 'create', data });
        }
        case 'update': {
            const method = rng.bool(0.3) ? 'assign' : undefined;
            return makeWriteAction(uuid, method ? { type: 'update', data: genUpdateData(rng), where, method } : { type: 'update', data: genUpdateData(rng), where });
        }
        case 'delete':
            return makeWriteAction(uuid, { type: 'delete', where });
        case 'array_scope': {
            const subWhere = { sid: 's' + rng.int(4) } as WhereFilterDefinition<SubItem>;
            const sub = rng.int(3);
            const action = sub === 0
                ? { type: 'create' as const, data: genSubItem(rng) }
                : sub === 1
                    ? { type: 'update' as const, data: { val: rng.intRange(-10, 10) }, where: subWhere }
                    : { type: 'delete' as const, where: subWhere };
            return makeWriteAction(uuid, assertWriteArrayScope<FuzzItem, 'sub_items'>({ type: 'array_scope', scope: 'sub_items', action, where }));
        }
        case 'add_to_set': {
            if (rng.bool(0.5)) {
                return makeWriteAction(uuid, { type: 'add_to_set', path: 'tags', items: [rng.pick(TAG_POOL)], unique_by: 'deep_equals', where });
            }
            const uniqueBy = rng.bool(0.5) ? 'deep_equals' : 'pk';
            return makeWriteAction(uuid, { type: 'add_to_set', path: 'sub_items', items: [genSubItem(rng)], unique_by: uniqueBy, where });
        }
        case 'push': {
            if (rng.bool(0.5)) return makeWriteAction(uuid, { type: 'push', path: 'tags', items: [rng.pick(TAG_POOL)], where });
            return makeWriteAction(uuid, { type: 'push', path: 'sub_items', items: [genSubItem(rng)], where });
        }
        case 'pull': {
            if (rng.bool(0.5)) return makeWriteAction(uuid, { type: 'pull', path: 'tags', items_where: [rng.pick(TAG_POOL)], where });
            const iw = rng.bool(0.5) ? { val: rng.intRange(-10, 10) } : { sid: 's' + rng.int(4) };
            return makeWriteAction(uuid, { type: 'pull', path: 'sub_items', items_where: iw as WhereFilterDefinition<SubItem>, where });
        }
        case 'delete_property':
            return makeWriteAction(uuid, { type: 'delete_property', path: rng.pick(REMOVABLE_PATHS), where });
        default:
            return makeWriteAction(uuid, { type: 'inc', path: 'count', amount: rng.intRange(-10, 10), where });
    }
}

export function genBatch(rng: Rng, world: FuzzItem[], deleteProperty: boolean): WriteAction<FuzzItem>[] {
    const n = rng.intRange(1, 6);
    return Array.from({ length: n }, (_, i) => genWriteAction(rng, world, 'u' + i, deleteProperty));
}

/**
 * Build an action whose payload names a target the payload types forbid, so the runtime is what answers.
 *
 * A caller arriving from untyped JavaScript can aim a verb at any field at all, including ones the
 * TypeScript surface rules out — the single assertion is quarantined here rather than spread across the
 * corpus.
 */
function makeForeignWriteAction(uuid: string, payload: unknown): WriteAction<FuzzItem> {
    return { type: 'write', ts: 0, uuid, payload: payload as WriteAction<FuzzItem>['payload'] };
}

/**
 * A deliberately-invalid action for P10. By default `invalid_data_value` and `invalid_property_path`
 * variants, both safe for the validate-where-sync consumer, whose every `where` here is a legitimate
 * filter. The unknown-field WHERE variant produces `invalid_filter` and is included ONLY when the caller
 * supports the invalid-where corpus.
 */
export function genInvalidAction(rng: Rng, invalidWhereCorpus: boolean): WriteAction<FuzzItem> {
    const variants = invalidWhereCorpus ? 6 : 5;
    switch (rng.int(variants)) {
        case 0: return makeWriteAction('bad', { type: 'inc', path: 'count', amount: NaN, where: {} });
        case 1: return makeWriteAction('bad', { type: 'inc', path: 'count', amount: Infinity, where: {} });
        case 2: return makeWriteAction('bad', { type: 'create', data: { id: 'z' + rng.int(1000), count: NaN } });
        // An explicit `undefined` value: JSON drops the key, so the action would mean nothing at all on the far
        // side of a boundary. Guaranteed-failing like its peers, whatever the world holds.
        case 3: return makeWriteAction('bad', { type: 'update', data: { text: undefined }, where: {} });
        // A verb aimed at the primary key. The key locates every row, so moving it is refused on the action
        // itself — no world can make this one land, and no row is even reached.
        case 4: return makeForeignWriteAction('bad', { type: 'inc', path: fuzzDdl.lists['.'].primary_key, amount: 1, where: {} });
        default: return makeWriteAction('bad', { type: 'update', data: { text: 'z' }, where: { nope: 1 } as WhereFilterDefinition<FuzzItem> });
    }
}

// ═══════════════════════════════════════════════════════════════════
// Oracle helpers
// ═══════════════════════════════════════════════════════════════════

export const sortByPk = (items: FuzzItem[]): FuzzItem[] => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The set of PKs a single action could touch: its created PK (create) or its where's match set (everything else). */
/**
 * Minimal runtime view of a payload. `WritePayload<FuzzItem>` resolves to `unknown` for schemas with
 * object arrays (the array_scope path-type collapses the whole union), so the static type can't narrow —
 * this view names only the two runtime fields this helper reads.
 */
type PayloadView =
    | { type: 'create'; data: { id: string } }
    | { type: 'update' | 'delete' | 'array_scope' | 'add_to_set' | 'push' | 'pull' | 'inc' | 'delete_property'; where?: unknown };

export function touchedPks(action: WriteAction<FuzzItem>, world: FuzzItem[]): Set<string> {
    const p = action.payload as PayloadView;
    const touched = new Set<string>();
    if (p.type === 'create') touched.add(String(p.data.id));
    else if (p.where) matchedPks(world, p.where as WhereFilterDefinition<FuzzItem>).forEach(id => touched.add(id));
    return touched;
}

/** PKs a where matches, computed with the same bare matcher the engine uses (writeToItemsArray.ts:322). */
export function matchedPks(world: FuzzItem[], where: WhereFilterDefinition<FuzzItem>): string[] {
    return world.filter(row => matchJavascriptObject(row, where)).map(row => row.id).sort();
}

/**
 * PKs whose row was removed or content-changed between two worlds — the value-diff projection a
 * reconstruction-mode adapter reports as affected.
 */
export function valueDiffPks(before: FuzzItem[], after: FuzzItem[]): string[] {
    const afterByPk = new Map(after.map((r) => [r.id, r]));
    const out: string[] = [];
    for (const row of before) {
        const now = afterByPk.get(row.id);
        if (now === undefined || !fuzzDeepEqual(now, row)) out.push(row.id);
    }
    return out.sort();
}

/**
 * Hand-written structural deep-equal — deliberately NOT the unit-under-test's own `deepEquals`, so the
 * differential oracle never trusts the code it is judging. NaN≡NaN; undefined≡missing; arrays order-sensitive.
 */
export function fuzzDeepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const aArr = Array.isArray(a); const bArr = Array.isArray(b);
    if (aArr !== bArr) return false;
    if (aArr && bArr) {
        if (a.length !== b.length) return false;
        return a.every((x, i) => fuzzDeepEqual(x, b[i]));
    }
    const ao = a as Record<string, unknown>; const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)].filter(k => ao[k] !== undefined || bo[k] !== undefined));
    for (const k of keys) if (!fuzzDeepEqual(ao[k], bo[k])) return false;
    return true;
}

/** Per-uuid outcome fingerprint — immune to successes-first ordering, E.1 dual outcomes, and E.4 collapse. */
export function outcomeSignature(result: WriteResult<FuzzItem>): Record<string, { oks: number; errorTypes: string[] }> {
    const sig: Record<string, { oks: number; errorTypes: string[] }> = {};
    for (const o of result.actions) {
        const entry = (sig[o.action_uuid] ??= { oks: 0, errorTypes: [] });
        if (o.ok) entry.oks++;
        else entry.errorTypes.push(...o.errors.map(e => e.type));
    }
    for (const k of Object.keys(sig)) sig[k]!.errorTypes.sort();
    return sig;
}

/** Build a reproduction message embedding the (seed, propertyIndex, iteration) triple and the world/actions. */
export function repro(name: string, seed: number, propIdx: number, iter: number, world: unknown, actions: unknown, extra?: string): string {
    return `[fuzz ${name}] reproduce with seed=${seed} property=${propIdx} iteration=${iter}`
        + `${extra ? `\n${extra}` : ''}`
        + `\nworld=${JSON.stringify(world)}`
        + `\nactions=${JSON.stringify(actions)}`;
}

export function invariant(cond: boolean, msg: () => string): void {
    if (!cond) throw new Error(msg());
}
