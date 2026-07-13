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
    // An array nested under an array: `groups.subtags` is a path with two array hops, so a compound predicate
    // on it must be satisfied within ONE `subtags` array rather than pooled across all of them.
    groups: z.array(z.object({ subtags: z.array(z.string()) }).strict()).optional(),
    // An array whose elements are themselves arrays: the only field whose operands are structural rather than
    // scalar, so equality here cannot be decided by comparing serialized text.
    matrix: z.array(z.array(z.number())).optional(),
}).strict();
export type FuzzRow = z.infer<typeof FuzzSchema>;

/** The one path in {@link FuzzSchema} that crosses two arrays. Its leaf arrays scope a compound predicate. */
export const NESTED_ARRAY_PATH = 'groups.subtags';

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
    // Several small leaf arrays, drawn from a four-value pool: a compound predicate is then frequently
    // satisfiable across two leaves while satisfiable within none, which is what makes leaf scoping observable.
    // An absent `groups`, a lone leaf, and an empty leaf all still occur — each exercises a different edge.
    if (rng.bool(0.8)) row.groups = Array.from({ length: rng.intRange(1, 3) }, () => ({
        subtags: Array.from({ length: rng.int(3) }, () => rng.pick(TAG_POOL)),
    }));
    if (rng.bool(0.8)) row.matrix = Array.from({ length: rng.int(4) }, () =>
        Array.from({ length: rng.intRange(1, 2) }, () => rng.intRange(0, 3)));
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
    switch (rng.int(23)) {
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
        case 18: {
            // The same conjunction under a `$not`: negation must distribute over the whole payload.
            const { field, opA, opB, a, b } = genComboPair(rng, row);
            return asFilter({ [field]: { $not: { [opA]: a, [opB]: b } } });
        }
        case 19: {
            // A conjunction inside a scalar `$elemMatch`: ONE element must satisfy both operators.
            const { field, opA, opB, a, b } = genElemMatchCombo(rng, row);
            return asFilter({ [field]: { $elemMatch: { [opA]: a, [opB]: b } } });
        }
        case 20:
            // A compound predicate on a path crossing two arrays: it must hold within one leaf array.
            return asFilter({ [NESTED_ARRAY_PATH]: leafScopeFilterPayload(genLeafScopeOps(rng, row)) });
        case 21:
            // A structural operand: the `$all` element is an array, so equality is decided by structure.
            return asFilter({ matrix: { $all: [pickMatrixRow(rng, row)] } });
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
const RANGE_OP_SET: ReadonlySet<string> = new Set(RANGE_OPS);

/**
 * Draw two distinct operators that occupy DIFFERENT predicate groups.
 *
 * A payload's operators are grouped before evaluation, and every range bound (`$gt`/`$gte`/`$lt`/`$lte`) shares
 * a single group. Two range operators therefore always travel together, and a payload made of them cannot
 * reveal an engine that keeps only the first operator and drops the rest — the very defect the multi-operator
 * laws exist to catch. Excluding that pairing keeps every generated combo able to bite.
 */
function drawOpPair(rng: Rng, ops: readonly string[]): [string, string] {
    const opA = rng.pick(ops);
    let opB = rng.pick(ops);
    while (opB === opA || (RANGE_OP_SET.has(opA) && RANGE_OP_SET.has(opB))) opB = rng.pick(ops);
    return [opA, opB];
}

const comboOperand = (rng: Rng, op: string, field: 'name' | 'age', row: FuzzRow): unknown => {
    if (op === '$exists') return rng.bool();
    const value = () => (field === 'name' ? pickName(rng, row) : pickAge(rng, row));
    if (op === '$in' || op === '$nin') return list(rng, value);
    return value();
};

/**
 * A single-field, two-operator combo and the fields needed to split it into `$and` of one-operator payloads.
 * WF-P10 asserts `{field:{opA,opB}} ≡ {$and:[{field:{opA}},{field:{opB}}]}` — the AND law; WF-P11 wraps the same
 * payload in `$not`. Present-biased operands make both operators straddle the row value, so the two ops
 * frequently disagree and the laws bite.
 */
export function genComboPair(rng: Rng, row: FuzzRow): { field: 'name' | 'age'; opA: string; opB: string; a: unknown; b: unknown } {
    const field = rng.bool() ? 'name' : 'age';
    const [opA, opB] = drawOpPair(rng, COMBO_VALUE_OPS);
    return { field, opA, opB, a: comboOperand(rng, opA, field, row), b: comboOperand(rng, opB, field, row) };
}

// ═══════════════════════════════════════════════════════════════════
// Scalar $elemMatch conjunction (WF-P12)
// ═══════════════════════════════════════════════════════════════════

/**
 * The operators an `$elemMatch` body combines when the array's elements are scalars. `$exists` and `$type`
 * are excluded: on a scalar element they diverge across engines, which the example sections already record.
 */
const ELEM_MATCH_COMBO_OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'] as const;

const pickScore = (rng: Rng, row: FuzzRow): number => (row.scores && row.scores.length && rng.bool(0.5) ? rng.pick(row.scores) : rng.intRange(-10, 20));

/**
 * A two-operator `$elemMatch` body over a scalar array. One element must satisfy BOTH operators, so the
 * conjunction cannot be spread across two elements — the law WF-P12 polices.
 */
export function genElemMatchCombo(rng: Rng, row: FuzzRow): { field: 'tags' | 'scores'; opA: string; opB: string; a: unknown; b: unknown } {
    const field = rng.bool() ? 'tags' : 'scores';
    const [opA, opB] = drawOpPair(rng, ELEM_MATCH_COMBO_OPS);
    const value = () => (field === 'tags' ? pickTag(rng, row) : pickScore(rng, row));
    const operand = (op: string): unknown => (op === '$in' || op === '$nin' ? list(rng, value) : value());
    return { field, opA, opB, a: operand(opA), b: operand(opB) };
}

// ═══════════════════════════════════════════════════════════════════
// Nested-array leaf scope (WF-P13) — generator + an INDEPENDENT oracle
// ═══════════════════════════════════════════════════════════════════

/**
 * One operator of a compound predicate on {@link NESTED_ARRAY_PATH}.
 *
 * `$nin` is the one operator here that a missing field satisfies. When a row has no leaf array — an absent
 * `groups` — the path names a missing field, so a lone `$nin` must still match, and every other operator fails
 * a missing field. This is exactly what lets the fuzz reach the missing-leaf-array verdict that the section-04
 * example pins otherwise cover alone; {@link slowLeafScopeEval} encodes the missing-field reading directly.
 *
 * `$ne` is deliberately absent: on a scalar array it reads as a sub-document match rather than containment, so
 * its verdict diverges from "the array holds this value" and would need a separate oracle.
 */
export type LeafScopeOp =
    | { readonly op: '$size'; readonly n: number }
    | { readonly op: '$all'; readonly values: readonly string[] }
    | { readonly op: '$in'; readonly values: readonly string[] }
    | { readonly op: '$nin'; readonly values: readonly string[] }
    | { readonly op: '$elemMatch'; readonly innerOp: string; readonly innerOperand: string | readonly string[] };

const pickSubtag = (rng: Rng, row: FuzzRow): string => {
    const present = (row.groups ?? []).flatMap(g => g.subtags);
    return present.length && rng.bool(0.6) ? rng.pick(present) : rng.pick(TAG_POOL);
};

/** A `$size` operand biased toward a leaf length the row actually has, so the operator is often satisfiable. */
const pickLeafLength = (rng: Rng, row: FuzzRow): number => {
    const lengths = (row.groups ?? []).map(g => g.subtags.length);
    return lengths.length && rng.bool(0.6) ? rng.pick(lengths) : rng.int(3);
};

/**
 * A predicate on the nested-array path: usually two distinct operators, sometimes a lone `$nin`.
 *
 * A lone `$nin` is the draw whose missing-field verdict is true, so it drives the missing-leaf-array coverage;
 * the two-operator draws exercise leaf scoping proper. Operand widths are kept at or below a leaf array's
 * length: an operand demanding three distinct values of a two-element leaf is unsatisfiable under either
 * reading of leaf scope, so it can never separate them.
 */
export function genLeafScopeOps(rng: Rng, row: FuzzRow): LeafScopeOp[] {
    const subtagPair = (): string[] => Array.from({ length: rng.intRange(1, 2) }, () => pickSubtag(rng, row));
    // A lone $nin is the only predicate here a missing field satisfies, so it is the only one that separates a
    // correct missing-leaf-array verdict (true) from the bare "did some leaf satisfy this" reading (false).
    if (rng.bool(0.25)) return [{ op: '$nin', values: subtagPair() }];
    const kinds = ['$size', '$all', '$in', '$nin', '$elemMatch'] as const;
    const [kindA, kindB] = drawOpPair(rng, kinds);
    const build = (kind: string): LeafScopeOp => {
        switch (kind) {
            case '$size': return { op: '$size', n: pickLeafLength(rng, row) };
            case '$all': return { op: '$all', values: subtagPair() };
            case '$in': return { op: '$in', values: subtagPair() };
            case '$nin': return { op: '$nin', values: subtagPair() };
            default: {
                const innerOp = rng.pick(ELEM_MATCH_COMBO_OPS);
                const innerOperand = innerOp === '$in' || innerOp === '$nin' ? subtagPair() : pickSubtag(rng, row);
                return { op: '$elemMatch', innerOp, innerOperand };
            }
        }
    };
    return [build(kindA), build(kindB)];
}

/** Render the drawn operators as the filter payload the engines receive. */
export function leafScopeFilterPayload(ops: readonly LeafScopeOp[]): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const o of ops) {
        if (o.op === '$size') payload.$size = o.n;
        else if (o.op === '$all') payload.$all = [...o.values];
        else if (o.op === '$in') payload.$in = [...o.values];
        else if (o.op === '$nin') payload.$nin = [...o.values];
        else payload.$elemMatch = { [o.innerOp]: Array.isArray(o.innerOperand) ? [...o.innerOperand] : o.innerOperand };
    }
    return payload;
}

type RangeCompare = <X extends string | number>(a: X, b: X) => boolean;
const RANGE_COMPARES: Readonly<Record<string, RangeCompare>> = {
    '$gt': (a, b) => a > b,
    '$gte': (a, b) => a >= b,
    '$lt': (a, b) => a < b,
    '$lte': (a, b) => a <= b,
};

/**
 * Evaluate one value operator against one scalar — hand-written, so the laws that use it never borrow the
 * judgement of the code they are judging.
 *
 * @param value The stored value, or `undefined` for a missing field.
 * @returns Whether the operator holds. A wrong-typed range bound does not match (type bracketing).
 */
export function evalScalarOp(value: string | number | undefined, op: string, operand: unknown): boolean {
    switch (op) {
        case '$exists': return operand === (value !== undefined);
        case '$eq': return value === operand;
        case '$ne': return value === undefined || value !== operand;
        case '$in': return value !== undefined && Array.isArray(operand) && operand.includes(value);
        case '$nin': return value === undefined || (Array.isArray(operand) && !operand.includes(value));
        default: {
            const compare = RANGE_COMPARES[op];
            if (!compare || value === undefined) return false;
            if (typeof value === 'number' && typeof operand === 'number') return compare(value, operand);
            if (typeof value === 'string' && typeof operand === 'string') return compare(value, operand);
            return false;
        }
    }
}

/** Whether a single leaf array satisfies EVERY operator of the compound predicate. */
export function leafSatisfiesAll(leaf: readonly string[], ops: readonly LeafScopeOp[]): boolean {
    return ops.every(o => {
        switch (o.op) {
            case '$size': return leaf.length === o.n;
            case '$all': return o.values.every(v => leaf.includes(v));
            case '$in': return o.values.some(v => leaf.includes(v));
            case '$nin': return !o.values.some(v => leaf.includes(v));
            case '$elemMatch': return leaf.some(el => evalScalarOp(el, o.innerOp, o.innerOperand));
        }
    });
}

/**
 * The independent oracle for {@link NESTED_ARRAY_PATH}.
 *
 * Two rules meet here, and keeping them apart is the whole point:
 * - a POSITIVE predicate is leaf-scoped — it matches when SOME leaf array satisfies all of it at once, so two
 *   different leaves cannot each supply half of a compound condition;
 * - a NEGATION denies the whole path — `$nin` holds only when NO leaf holds a forbidden value. Folding it in
 *   with the positives would let a clean leaf excuse an offending sibling, admitting a row the caller excluded.
 *
 * With no leaf array at all (an absent `groups`), both rules still apply and give the missing-field verdict for
 * free: nothing satisfies a positive, and nothing holds a forbidden value.
 *
 * Hand-written for the same reason as {@link fuzzDeepEqual} — a law comparing an engine against a copy of that
 * engine's own traversal would be blind to a shared misreading of leaf scope or of negation.
 */
export function slowLeafScopeEval(row: FuzzRow, ops: readonly LeafScopeOp[]): boolean {
    const leaves = (row.groups ?? []).map(g => g.subtags);
    const positives = ops.filter(o => o.op !== '$nin');
    const denials = ops.filter(o => o.op === '$nin');

    const someLeafSatisfiesEveryPositive = positives.length === 0 || leaves.some(leaf => leafSatisfiesAll(leaf, positives));
    const noLeafHoldsAForbiddenValue = denials.every(o => !leaves.some(leaf => leafSatisfiesAll(leaf, [{ ...o, op: '$in' }])));
    return someLeafSatisfiesEveryPositive && noLeafHoldsAForbiddenValue;
}

// ═══════════════════════════════════════════════════════════════════
// Structural operands
// ═══════════════════════════════════════════════════════════════════

/** An operand for `{matrix: {$all: [...]}}` — biased toward a row actually present, so the filter often matches. */
export function pickMatrixRow(rng: Rng, row: FuzzRow): number[] {
    if (row.matrix && row.matrix.length && rng.bool(0.5)) return [...rng.pick(row.matrix)];
    return Array.from({ length: rng.intRange(1, 2) }, () => rng.intRange(0, 3));
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
