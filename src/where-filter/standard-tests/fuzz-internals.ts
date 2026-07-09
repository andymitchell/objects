import { z } from "zod";
import type { WhereFilterDefinition } from "../types.ts";

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
export const DEFAULT_FUZZ_ITERATIONS = 150;

// ═══════════════════════════════════════════════════════════════════
// Fixture — a small schema whose fields exercise the uniform (cross-engine-agreeing) operators
// ═══════════════════════════════════════════════════════════════════

export const FuzzSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    age: z.number().optional(),
    active: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    scores: z.array(z.number()).optional(),
    items: z.array(z.object({ k: z.string(), v: z.number().optional() }).strict()).optional(),
}).strict();
export type FuzzRow = z.infer<typeof FuzzSchema>;

// Lowercase-ASCII ONLY. Mixed case / non-ASCII would hit PG/SQLite collation vs JS code-point
// divergence in string ranges. Do not extend the alphabet without excluding string-range ops.
const NAME_POOL = ['ann', 'bob', 'cid', 'dan'] as const;
const TAG_POOL = ['a', 'b', 'c', 'd'] as const;

type SubItem = { k: string; v?: number };

/** Assert a dynamically-built filter is a WhereFilterDefinition. The generators only ever build valid
 * uniform-profile shapes; the fields are optional so their operator types collapse to `never`, hence the
 * cast (never `as any`). */
export const asFilter = (x: unknown): WhereFilterDefinition<FuzzRow> => x as WhereFilterDefinition<FuzzRow>;

// ═══════════════════════════════════════════════════════════════════
// Generators — every value JSON-safe; every operator in the uniform (cross-engine) profile
// ═══════════════════════════════════════════════════════════════════

export function genRow(rng: Rng): FuzzRow {
    // Every field is optional and independently present/absent — including the array fields, so a MISSING array
    // is exercised. An array operator ($size/$all/$in) on a missing array is now uniform across all engines: the
    // SQLite $size emitter yields a DEFINITE `false` via a CASE guard (an unguarded `AND` used to leave SQL NULL,
    // which does not negate, breaking `$nor ≡ ¬$or`); $all/$in/$elemMatch spread to zero rows.
    const row: FuzzRow = { id: 'r' + rng.int(1000) };
    if (rng.bool()) row.name = rng.pick(NAME_POOL);
    if (rng.bool()) row.age = rng.intRange(-10, 20);
    if (rng.bool()) row.active = rng.bool();
    // Array fields are usually present (collection fields typically are) but sometimes absent — enough over the
    // real iteration counts (100–300) to exercise the missing-array path densely, while keeping present-array
    // operators well-represented for the differential.
    if (rng.bool(0.8)) row.tags = Array.from({ length: rng.int(5) }, () => rng.pick(TAG_POOL));
    if (rng.bool(0.8)) row.scores = Array.from({ length: rng.int(5) }, () => rng.intRange(-10, 20));
    if (rng.bool(0.8)) row.items = Array.from({ length: rng.int(5) }, () => {
        const si: SubItem = { k: rng.pick(TAG_POOL) };
        if (rng.bool(0.7)) si.v = rng.intRange(-10, 20);
        return si;
    });
    return row;
}

// Operands bias ~50% toward a value present in the row, so filters both match and miss.
const pickName = (rng: Rng, row: FuzzRow): string => (row.name !== undefined && rng.bool(0.5) ? row.name : rng.pick(NAME_POOL));
const pickAge = (rng: Rng, row: FuzzRow): number => (row.age !== undefined && rng.bool(0.5) ? row.age : rng.intRange(-10, 20));
const pickTag = (rng: Rng, row: FuzzRow): string => (row.tags && row.tags.length && rng.bool(0.5) ? rng.pick(row.tags) : rng.pick(TAG_POOL));
const RANGE_OPS = ['$gt', '$lt', '$gte', '$lte'] as const;
const list = <X>(rng: Rng, gen: () => X): X[] => Array.from({ length: rng.intRange(1, 3) }, gen);

/**
 * A single uniform-profile leaf: an operator (or a two-operator conjunction) on one field whose behaviour is
 * identical across the pure-JS matcher and both SQL emitters. Deliberately EXCLUDES the operators shown to diverge in the example
 * sections: boolean equality (`active` — SQLite binds a raw boolean and throws), `$regex`/`$type`,
 * non-finite numbers, empty `$in`/`$nin`/`$all`, `$elemMatch` `$exists`/`$type` on scalar arrays,
 * exact-array / multi-key deep-object literals, and unknown paths.
 */
function genLeaf(rng: Rng, row: FuzzRow): WhereFilterDefinition<FuzzRow> {
    switch (rng.int(19)) {
        case 0: return asFilter({ name: pickName(rng, row) });
        case 1: return asFilter({ name: { $eq: pickName(rng, row) } });
        case 2: return asFilter({ name: { $ne: pickName(rng, row) } });
        case 3: return asFilter({ name: { [rng.pick(RANGE_OPS)]: pickName(rng, row) } });
        case 4: return asFilter({ name: { $in: list(rng, () => pickName(rng, row)) } });
        case 5: return asFilter({ name: { $nin: list(rng, () => pickName(rng, row)) } });
        case 6: return asFilter({ name: { $exists: rng.bool() } });
        case 7: return asFilter({ age: pickAge(rng, row) });
        case 8: return asFilter({ age: { [rng.bool() ? '$eq' : '$ne']: pickAge(rng, row) } });
        case 9: return asFilter({ age: { [rng.pick(RANGE_OPS)]: pickAge(rng, row) } });
        case 10: return asFilter({ age: { [rng.bool() ? '$in' : '$nin']: list(rng, () => pickAge(rng, row)) } });
        case 11: return asFilter({ age: { $exists: rng.bool() } });
        case 12: return asFilter({ tags: pickTag(rng, row) });
        case 13: return asFilter({ tags: { [rng.bool() ? '$in' : '$nin']: list(rng, () => pickTag(rng, row)) } });
        case 14: return asFilter({ tags: { $size: rng.int(4) } });
        case 15: return asFilter({ tags: { $all: list(rng, () => pickTag(rng, row)) } });
        case 16: return asFilter({ scores: { $size: rng.int(4) } });
        case 17: {
            // A two-operator conjunction on one scalar field (a Mongo implicit-AND payload). Every engine
            // composes the operators as an AND, so the shape stays uniform — see {@link genComboPair}.
            const { field, opA, opB, a, b } = genComboPair(rng, row);
            return asFilter({ [field]: { [opA]: a, [opB]: b } });
        }
        default: {
            const sub: SubItem = { k: pickTag(rng, row) };
            if (rng.bool(0.5)) sub.v = pickAge(rng, row);
            return asFilter({ items: { $elemMatch: sub } });
        }
    }
}

const LOGIC_OPS = ['$and', '$or', '$nor'] as const;

/** A uniform-profile filter: a leaf, or a logic node (1–3 arms) up to depth 3. */
export function genFilter(rng: Rng, row: FuzzRow, depth = 0): WhereFilterDefinition<FuzzRow> {
    if (depth < 3 && rng.bool(0.3)) {
        const op = rng.pick(LOGIC_OPS);
        // An arm is occasionally the empty match-all `{}`: the identity of $and, the absorber of $or, the emptier
        // of $nor. Exercises the empty-sub-filter join path (which must contribute `1 = 1`, not a dangling clause).
        const arms = list(rng, () => (rng.bool(0.15) ? asFilter({}) : genFilter(rng, row, depth + 1)));
        return asFilter({ [op]: arms });
    }
    return genLeaf(rng, row);
}

/**
 * The WF-P9 rejection corpus: filters the reference genuinely rejects on ALL engines, so the fuzz stays
 * green on an honest matcher (it is the saboteur baseline). `{id:{$in:5}}` throws a TypeError (`.includes`
 * on a number) — the field must be REQUIRED and always present: an absent value (a phantom field, or an
 * absent OPTIONAL field) short-circuits the nullish guard to `false` instead of reaching the throw.
 *
 * The §25 additions below are GATE rejections: once the validity gate is tightened they are rejected
 * uniformly by all four consumers (the gate is shared), so they never become an eval-time-only reject that
 * would permanently red SQL. Only gate-rejected shapes belong here.
 */
export const REJECTING_FILTERS: readonly unknown[] = [
    null, [], 42, 'x', { $and: [5, 'x'] }, { id: { $in: 5 } },
    // §25 gate rejections: unknown-operator piggyback, present-undefined operator/logic, non-JSON carrier,
    // cross-category mix. Each fails `isWhereFilterDefinition` once the gate is tightened.
    { age: { $eq: 5, $mod: 3 } },
    { age: { $lt: 5, $gt: undefined } },
    { $or: undefined },
    { tags: [new Date()] },
    { tags: { $all: [{ x: Symbol('s') }] } },
    { tags: { $size: 2, $gt: 5 } },
];

// ═══════════════════════════════════════════════════════════════════
// Multi-operator AND law (WF-P10) — combo generator, also folded into the uniform profile via genLeaf
// ═══════════════════════════════════════════════════════════════════

/**
 * The value operators WF-P10 combines. Two DISTINCT ones on one present-biased scalar field form a payload
 * whose meaning is their conjunction. All operands are number|string — never boolean/null (not value-op
 * operands, and they would drag in $all engine-limitation reds). `$regex`/`$options` are excluded so the
 * combo is a pure conjunction with no paired-predicate special case.
 */
const COMBO_VALUE_OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists'] as const;

const comboOperand = (rng: Rng, op: string, field: 'name' | 'age', row: FuzzRow): unknown => {
    if (op === '$exists') return rng.bool();
    const value = () => (field === 'name' ? pickName(rng, row) : pickAge(rng, row));
    if (op === '$in' || op === '$nin') return list(rng, value);
    return value();
};

/**
 * A single-field, two-operator combo and the fields needed to split it into `$and` of one-operator payloads.
 * WF-P10 asserts `{field:{opA,opB}} ≡ {$and:[{field:{opA}},{field:{opB}}]}` — the AND law. Present-biased
 * operands make both operators straddle the row value, so the two ops frequently disagree and the law bites.
 */
export function genComboPair(rng: Rng, row: FuzzRow): { field: 'name' | 'age'; opA: string; opB: string; a: unknown; b: unknown } {
    const field = rng.bool() ? 'name' : 'age';
    const opA = rng.pick(COMBO_VALUE_OPS);
    let opB = rng.pick(COMBO_VALUE_OPS);
    while (opB === opA) opB = rng.pick(COMBO_VALUE_OPS);
    return { field, opA, opB, a: comboOperand(rng, opA, field, row), b: comboOperand(rng, opB, field, row) };
}

/**
 * Hand-written structural deep-equal — deliberately NOT the unit-under-test's own equality, so the
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

/** Build a reproduction message embedding the (seed, propertyIndex, iteration) triple and the row/filter. */
export function repro(name: string, seed: number, propIdx: number, iter: number, row: unknown, filter: unknown, extra?: string): string {
    return `[fuzz ${name}] reproduce with seed=${seed} property=${propIdx} iteration=${iter}`
        + `${extra ? `\n${extra}` : ''}`
        + `\nrow=${JSON.stringify(row)}`
        + `\nfilter=${JSON.stringify(filter)}`;
}

export function invariant(cond: boolean, msg: () => string): void {
    if (!cond) throw new Error(msg());
}
