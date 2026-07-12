import { asFilter, type FuzzRow, type Rng } from "../fuzz-internals.ts";
import type { WhereFilterDefinition } from "../../types.ts";

/**
 * A filter generator for the MongoDB-conformance oracle.
 *
 * The main fuzz generator (`genFilter`) is confined to a *uniform profile* — the operators the example sections
 * proved behave identically across the JS matcher and both SQL emitters. That profile deliberately excludes
 * `$type`, `$regex`, `$all:[]`, comparison operators applied to an array field, and `$exists`/`$type` inside a
 * scalar `$elemMatch`, because those are where the three ENGINES disagreed.
 *
 * Those exclusions are exactly where this package disagrees with MONGODB. A Mongo oracle run over the uniform
 * profile therefore cannot reach a single documented divergence, and would report a green that means nothing.
 *
 * So this generator covers the full language the JS matcher accepts, and is kept separate from `genLeaf` for a
 * second reason: extending the shared generator would shift the seeded RNG stream for WF-P0…WF-P13 and move
 * every saboteur's declared trip.
 *
 * @param rng - Seeded RNG; the caller mixes the seed per property and iteration.
 * @param row - The document being filtered. Operands are drawn from it about half the time so filters actually
 *   discriminate rather than trivially missing.
 * @returns A filter inside the portable operand domain, addressing only unescaped paths.
 *
 * @remarks
 * Bounds, all deliberate: no non-JSON carriers (the reference throws on them while mingo answers —
 * `MONGO-DIVERGENCES.md` #9 — which is a validity-gate difference, not a semantic one); no escaped-dot paths
 * (#14, a path-grammar difference, likewise not semantic); no non-finite operands (MongoDB's NaN ordering is a
 * separate question and would swamp the report).
 */
export function genMongoFilter(rng: Rng, row: FuzzRow, depth = 0): WhereFilterDefinition<FuzzRow> {
    if (depth < 2 && rng.bool(0.25)) {
        const op = rng.pick(LOGIC_OPS);
        const arms = Array.from({ length: rng.intRange(1, 3) }, () => genMongoFilter(rng, row, depth + 1));
        return asFilter({ [op]: arms });
    }
    return genMongoLeaf(rng, row);
}

/** Paths in `FuzzSchema` whose value is an array. A divergence that hits `tags` hits `scores` for the same reason. */
export const ARRAY_FIELD_PATHS: ReadonlySet<string> = new Set(['tags', 'scores', 'items', 'groups', 'matrix', 'groups.subtags']);

/** Whether a dot-prop path names an array-valued field — the field-kind axis of {@link filterShape}. */
export const isArrayFieldPath = (path: string): boolean => ARRAY_FIELD_PATHS.has(path);

const LOGIC_OPS = ['$and', '$or', '$nor'] as const;
const RANGE_OPS = ['$gt', '$lt', '$gte', '$lte'] as const;
const TYPE_NAMES = ['string', 'number', 'bool', 'object', 'array', 'null'] as const;
const NAME_POOL = ['ann', 'bob', 'cid', 'dan'] as const;
const TAG_POOL = ['a', 'b', 'c', 'd'] as const;
const REGEX_POOL = ['^a', 'b$', 'a|b', '.', 'c'] as const;

const pickName = (rng: Rng, row: FuzzRow): string => (row.name !== undefined && rng.bool(0.5) ? row.name : rng.pick(NAME_POOL));
const pickAge = (rng: Rng, row: FuzzRow): number => (row.age !== undefined && rng.bool(0.5) ? row.age : rng.intRange(-10, 20));
const pickTag = (rng: Rng, row: FuzzRow): string => (row.tags?.length && rng.bool(0.5) ? rng.pick(row.tags) : rng.pick(TAG_POOL));
const pickScore = (rng: Rng, row: FuzzRow): number => (row.scores?.length && rng.bool(0.5) ? rng.pick(row.scores) : rng.intRange(-10, 20));
const list = <X>(rng: Rng, gen: () => X): X[] => Array.from({ length: rng.intRange(1, 3) }, gen);

/** A value-operator payload usable against a string-valued target (an element, or a scalar field). */
function stringValueOps(rng: Rng, row: FuzzRow): Record<string, unknown> {
    switch (rng.int(6)) {
        case 0: return { $eq: pickTag(rng, row) };
        case 1: return { $ne: pickTag(rng, row) };
        case 2: return { [rng.pick(RANGE_OPS)]: pickTag(rng, row) };
        case 3: return { $in: list(rng, () => pickTag(rng, row)) };
        case 4: return { $nin: list(rng, () => pickTag(rng, row)) };
        default: return rng.bool() ? { $regex: rng.pick(REGEX_POOL) } : { $regex: rng.pick(REGEX_POOL), $options: 'i' };
    }
}

/** A value-operator payload usable against a number-valued target. */
function numberValueOps(rng: Rng, row: FuzzRow): Record<string, unknown> {
    switch (rng.int(5)) {
        case 0: return { $eq: pickScore(rng, row) };
        case 1: return { $ne: pickScore(rng, row) };
        case 2: return { [rng.pick(RANGE_OPS)]: pickScore(rng, row) };
        case 3: return { $in: list(rng, () => pickScore(rng, row)) };
        default: return { $nin: list(rng, () => pickScore(rng, row)) };
    }
}

function genMongoLeaf(rng: Rng, row: FuzzRow): WhereFilterDefinition<FuzzRow> {
    switch (rng.int(26)) {
        // ── Scalar fields: the conformant baseline. Any disagreement HERE is a real finding.
        case 0: return asFilter({ name: pickName(rng, row) });
        case 1: return asFilter({ name: stringValueOps(rng, row) });
        case 2: return asFilter({ age: pickAge(rng, row) });
        case 3: return asFilter({ age: numberValueOps(rng, row) });
        case 4: return asFilter({ age: { [rng.pick(RANGE_OPS)]: pickAge(rng, row), [rng.pick(RANGE_OPS)]: pickAge(rng, row) } });
        case 5: return asFilter({ [rng.pick(['name', 'age', 'active'] as const)]: { $exists: rng.bool() } });
        case 6: return asFilter({ [rng.pick(['name', 'age', 'active'] as const)]: { $type: rng.pick(TYPE_NAMES) } });
        case 7: return asFilter({ active: rng.bool() });
        case 8: return asFilter({ active: { $eq: rng.bool() } });
        case 9: return asFilter({ name: { $not: stringValueOps(rng, row) } });
        case 10: return asFilter({ age: { $not: numberValueOps(rng, row) } });

        // ── Comparison operators applied DIRECTLY to an array field (MONGO-DIVERGENCES.md #13 territory).
        case 11: return asFilter({ tags: stringValueOps(rng, row) });
        case 12: return asFilter({ scores: numberValueOps(rng, row) });
        case 13: return asFilter({ tags: { $not: stringValueOps(rng, row) } });

        // ── Array-native operators. `$all: []` is #2; `$type` on an array field is #1.
        case 14: return asFilter({ tags: pickTag(rng, row) });
        case 15: return asFilter({ tags: { $all: rng.bool(0.2) ? [] : list(rng, () => pickTag(rng, row)) } });
        case 16: return asFilter({ tags: { $size: rng.int(4) } });
        case 17: return asFilter({ scores: { $size: rng.int(4) } });
        case 18: return asFilter({ [rng.pick(['tags', 'scores', 'items', 'matrix'] as const)]: { $type: rng.pick(TYPE_NAMES) } });
        case 19: return asFilter({ [rng.pick(['tags', 'scores', 'items'] as const)]: { $exists: rng.bool() } });

        // ── Scalar $elemMatch: value-operator bodies (conformant), and $exists/$type bodies (#15).
        case 20: return asFilter({ tags: { $elemMatch: stringValueOps(rng, row) } });
        case 21: return asFilter({ scores: { $elemMatch: numberValueOps(rng, row) } });
        case 22: return asFilter({
            tags: { $elemMatch: rng.bool() ? { $exists: rng.bool() } : { $type: rng.pick(TYPE_NAMES) } },
        });
        case 23: return asFilter({ tags: { $elemMatch: { $exists: true, $eq: pickTag(rng, row) } } });

        // ── Dotted paths into arrays (MongoDB traverses implicitly), and the two-array path.
        case 24: return asFilter(rng.bool()
            ? { 'items.k': rng.bool() ? pickTag(rng, row) : stringValueOps(rng, row) }
            : { 'items.v': rng.bool() ? pickAge(rng, row) : numberValueOps(rng, row) });

        // ── Structural operands: exact-array literal, object $elemMatch.
        //
        // `groups.subtags` — a path crossing TWO arrays — is deliberately ABSENT. mingo evaluates such paths
        // incorrectly (verified against mongod 8.2.6; see MINGO_QUIRKS), and this package agrees with MongoDB
        // there. Generating them would produce a stream of disagreements in which mingo, not the reference, is
        // wrong. An oracle that cannot evaluate a construct must not be asked about it — filtering its answers
        // out afterwards would be an ignore-list hiding the oracle's own defect, which is how a blind spot gets
        // mistaken for conformance.
        default: {
            switch (rng.int(3)) {
                case 0: return asFilter({ tags: list(rng, () => pickTag(rng, row)) });
                case 1: return asFilter({ matrix: { $all: [list(rng, () => rng.intRange(-2, 4))] } });
                default: return asFilter({ items: { $elemMatch: { k: pickTag(rng, row) } } });
            }
        }
    }
}
