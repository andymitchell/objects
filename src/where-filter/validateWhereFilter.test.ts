import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateWhereFilter, compileValidateWhereFilter } from "./validateWhereFilter.ts";
import matchJavascriptObject from "./matchJavascriptObject.ts";
import type { WhereFilterDefinition } from "./types.ts";

// `.strict()` throughout: `unknown_field` is flagged only under strict objects (the only mode the engine
// enforces no-extra-keys on writes), so these schemas must be strict for the unknown-field cases to fire.
const Schema = z.object({
    id: z.string(),
    age: z.number(),
    active: z.boolean(),
    nickname: z.string().optional(),
    score: z.number().nullable(),
    contact: z.object({ email: z.string(), phone: z.string().optional() }).strict(),
    tags: z.array(z.string()),
    meta: z.record(z.string(), z.string()), // dynamic keys — paths into it can't be modelled
}).strict();
type Row = z.infer<typeof Schema>;

/** Cast an arbitrary (often deliberately-invalid) value to the filter type for runtime testing. */
const wf = (filter: unknown) => filter as WhereFilterDefinition<Row>;
const validate = (filter: unknown) => validateWhereFilter(wf(filter), Schema);

describe("validateWhereFilter", () => {
    describe("accepts valid filters (and never false-positives)", () => {
        it("accepts the empty filter and simple field filters", () => {
            expect(validate({})).toEqual([]);
            expect(validate({ id: "x" })).toEqual([]);
            expect(validate({ age: { $gte: 18 } })).toEqual([]);
            expect(validate({ active: true })).toEqual([]);
        });

        it("accepts nested object paths and logic recursion", () => {
            expect(validate({ "contact.email": "a@b.com" })).toEqual([]);
            expect(validate({ $and: [{ id: "x" }, { age: 1 }] })).toEqual([]);
            expect(validate({ $or: [{ id: "x" }, { "contact.phone": "1" }] })).toEqual([]);
        });

        it("accepts documented edge cases that match all/nothing", () => {
            expect(validate({ $or: [] })).toEqual([]);
            expect(validate({ $and: [] })).toEqual([]);
            expect(validate({ nickname: undefined })).toEqual([]);
        });

        it("accepts a null operand on a nullable field (match-missing)", () => {
            expect(validate({ score: null })).toEqual([]);
            expect(validate({ score: { $eq: null } })).toEqual([]);
        });

        it("does not check value constraints — only structure (a 'matches nothing' query is valid)", () => {
            expect(validate({ age: -5 })).toEqual([]);
            expect(validate({ id: "no-such-id" })).toEqual([]);
        });

        it("accepts array-field operators without scalar-typing them", () => {
            expect(validate({ tags: "x" })).toEqual([]); // scalar-in-array membership
            expect(validate({ tags: { $size: 2 } })).toEqual([]);
        });

        it("accepts a path into a dynamic record (can't be modelled, so not rejected)", () => {
            expect(validate({ "meta.anything": "x" })).toEqual([]);
        });
    });

    describe("flags unknown fields", () => {
        it("flags an unknown top-level field", () => {
            const issues = validate({ ghost: 1 });
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({ reason: "unknown_field", path: "ghost" });
        });

        it("flags an unknown nested field under a known object", () => {
            expect(validate({ "contact.ghost": 1 })).toMatchObject([{ reason: "unknown_field", path: "contact.ghost" }]);
        });

        it("flags an unknown field inside an $and (must-match), but not inside $or/$nor (a sibling arm can rescue)", () => {
            expect(validate({ $and: [{ id: "x" }, { ghost: 1 }] })).toMatchObject([{ reason: "unknown_field", path: "ghost" }]);
            expect(validate({ $or: [{ id: "x" }, { ghost: 1 }] })).toEqual([]);
            expect(validate({ $nor: [{ ghost: 1 }] })).toEqual([]);
        });
    });

    describe("flags primitive type mismatches", () => {
        it("flags a string operand on a number field", () => {
            expect(validate({ age: "old" })).toMatchObject([{ reason: "type_mismatch", path: "age" }]);
        });
        it("flags a number operand on a string field", () => {
            expect(validate({ id: 5 })).toMatchObject([{ reason: "type_mismatch", path: "id" }]);
        });
        it("flags a string operand on a boolean field", () => {
            expect(validate({ active: "yes" })).toMatchObject([{ reason: "type_mismatch", path: "active" }]);
        });
        it("flags a mistyped element inside $in", () => {
            expect(validate({ age: { $in: ["a", "b"] } })).toMatchObject([{ reason: "type_mismatch", path: "age" }]);
        });
    });

    describe("flags non-finite numbers (NaN, and ±Infinity in zero-match positions → matches nothing)", () => {
        it("flags NaN as a direct operand (bare, $eq, range)", () => {
            expect(validate({ age: NaN })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $eq: NaN } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $gt: NaN } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
        });
        it("flags ±Infinity in a zero-match position — no finite value equals or exceeds it (eq, $gt/$gte:Infinity; eq, $lt/$lte:-Infinity)", () => {
            expect(validate({ age: Infinity })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $eq: Infinity } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $gt: Infinity } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $gte: Infinity } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: -Infinity })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $lt: -Infinity } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
            expect(validate({ age: { $lte: -Infinity } })).toMatchObject([{ reason: "non_finite", path: "age" }]);
        });
        it("does NOT flag ±Infinity used as a legitimate bound — it matches every finite value ($lt/$lte:Infinity; $gt/$gte:-Infinity)", () => {
            expect(validate({ age: { $lt: Infinity } })).toEqual([]);
            expect(validate({ age: { $lte: Infinity } })).toEqual([]);
            expect(validate({ age: { $gt: -Infinity } })).toEqual([]);
            expect(validate({ age: { $gte: -Infinity } })).toEqual([]);
        });
        it("does NOT flag a non-finite inside $in — a sibling element can still match", () => {
            expect(validate({ age: { $in: [1, Infinity] } })).toEqual([]);
            expect(validate({ age: { $in: [1, NaN] } })).toEqual([]);
        });
    });

    describe("accepts broadening operators (they match widely — incl. missing — so are never contradictions)", () => {
        it("accepts $ne / $nin / $not / $exists on a known field whatever the operand type", () => {
            expect(validate({ age: { $ne: 5 } })).toEqual([]);
            expect(validate({ id: { $ne: 5 } })).toEqual([]); // wrong-type operand under $ne still matches every other id
            expect(validate({ age: { $nin: [1, 2] } })).toEqual([]);
            expect(validate({ age: { $not: { $gt: 5 } } })).toEqual([]);
            expect(validate({ nickname: { $exists: false } })).toEqual([]);
            expect(validate({ age: { $ne: NaN } })).toEqual([]); // NaN under $ne is broadening, not a contradiction
        });

        it("accepts a broadening operator on an UNKNOWN field — it matches every row, so it is not a contradiction", () => {
            expect(validate({ ghost: { $ne: 5 } })).toEqual([]);
            expect(validate({ ghost: null })).toEqual([]);
            expect(validate({ ghost: { $exists: false } })).toEqual([]);
            expect(validate({ ghost: { $nin: [1] } })).toEqual([]);
        });
    });

    describe("$in type-mismatch precision", () => {
        it("flags $in only when EVERY element is the wrong type (matches nothing)", () => {
            expect(validate({ age: { $in: ["a", "b"] } })).toMatchObject([{ reason: "type_mismatch", path: "age" }]);
        });
        it("does NOT flag a mixed-type $in — one right-type element could match", () => {
            expect(validate({ age: { $in: [1, "a"] } })).toEqual([]);
        });
    });

    describe("flags malformed filters the matcher would throw on", () => {
        it("flags a null or array filter", () => {
            expect(validate(null)).toMatchObject([{ reason: "malformed" }]);
            expect(validate([])).toMatchObject([{ reason: "malformed" }]);
        });
        it("flags a filter with a structurally-invalid logic arm", () => {
            expect(validate({ $or: [null] })).toMatchObject([{ reason: "malformed" }]);
        });
        it("a malformed-filter issue carries no field path", () => {
            expect(validate(null)[0]!.path).toBeUndefined();
        });
    });

    it("compiles once and validates many filters", () => {
        const validateCompiled = compileValidateWhereFilter(Schema);
        expect(validateCompiled(wf({ id: "x" }))).toEqual([]);
        expect(validateCompiled(wf({ ghost: 1 }))).toMatchObject([{ reason: "unknown_field" }]);
    });
});

// ── Schema exercising unions, object arrays, nested arrays, records (drives F2/F3 + the metamorphic net) ──
const M = z.object({
    id: z.string(),
    age: z.number(),
    active: z.boolean(),
    score: z.number().nullable(),
    nickname: z.string().optional(),
    tags: z.array(z.string()), // scalar array
    meta: z.record(z.string(), z.string()), // dynamic record
    contact: z.object({ email: z.string(), phone: z.string().optional() }).strict(),
    children: z.array(z.object({ // object array
        name: z.string(),
        age: z.number(),
        grandchildren: z.array(z.object({ gname: z.string() }).strict()), // nested array-in-array
    }).strict()),
    items: z.array(z.union([ // union inside an array, variants with DISTINCT keys
        z.object({ kind: z.literal("a"), a: z.string() }),
        z.object({ kind: z.literal("b"), b: z.number() }),
    ])),
    sameKey: z.array(z.union([z.object({ v: z.string() }), z.object({ v: z.number() })])), // union, SHARED key, differing type
    poly: z.union([ // top-level union, shared key differing type
        z.object({ t: z.literal("x"), v: z.string() }),
        z.object({ t: z.literal("y"), v: z.number() }),
    ]),
    du: z.discriminatedUnion("dk", [ // discriminated union → opaque leaf
        z.object({ dk: z.literal("c1"), c1: z.string() }),
        z.object({ dk: z.literal("c2"), c2: z.number() }),
    ]),
    optArr: z.array(z.object({ oa: z.string() })).optional(), // optional object array
}).strict();
type M = z.infer<typeof M>;
const vm = (filter: unknown) => validateWhereFilter(filter as WhereFilterDefinition<M>, M);

describe("validateWhereFilter — unions (fix the false-reject, stay conservative)", () => {
    it("accepts either variant's type on a shared-key union path (no false-reject)", () => {
        expect(vm({ "poly.v": "x" })).toEqual([]);
        expect(vm({ "poly.v": 5 })).toEqual([]);
    });

    it("accepts either variant's type for a shared-key union inside an array element", () => {
        expect(vm({ "sameKey.v": "x" })).toEqual([]);
        expect(vm({ "sameKey.v": 7 })).toEqual([]);
        expect(vm({ sameKey: { v: 7 } })).toEqual([]); // compound array form
    });

    it("accepts an unknown field under a union (conservative — union parent is non-structural)", () => {
        expect(vm({ "poly.ghost": 1 })).toEqual([]);
    });

    it("accepts a path into a discriminated union (opaque leaf)", () => {
        expect(vm({ "du.c1": "x" })).toEqual([]);
        expect(vm({ "du.ghost": 1 })).toEqual([]);
    });

    it("still flags an unknown field under a plain object", () => {
        expect(vm({ "contact.ghost": 1 })).toMatchObject([{ reason: "unknown_field", path: "contact.ghost" }]);
    });
});

describe("validateWhereFilter — nested array-element filters (mirror the matcher)", () => {
    it("flags an unknown field inside $elemMatch on an object array", () => {
        expect(vm({ children: { $elemMatch: { ghost: 1 } } })).toMatchObject([{ reason: "unknown_field", path: "children.ghost" }]);
    });

    it("flags an unknown field in the operator-free compound array form", () => {
        expect(vm({ children: { ghost: 1 } })).toMatchObject([{ reason: "unknown_field", path: "children.ghost" }]);
    });

    it("flags a type mismatch inside a nested array element (both forms)", () => {
        expect(vm({ children: { $elemMatch: { age: "old" } } })).toMatchObject([{ reason: "type_mismatch", path: "children.age" }]);
        expect(vm({ children: { name: 5 } })).toMatchObject([{ reason: "type_mismatch", path: "children.name" }]);
    });

    it("flags a non-finite (NaN) number inside a nested array element", () => {
        expect(vm({ children: { $elemMatch: { age: { $gt: NaN } } } })).toMatchObject([{ reason: "non_finite", path: "children.age" }]);
    });

    it("flags issues in an array-within-an-array, with the full scope-chain path", () => {
        expect(vm({ "children.grandchildren": { ghost: 1 } })).toMatchObject([{ reason: "unknown_field", path: "children.grandchildren.ghost" }]);
        expect(vm({ children: { $elemMatch: { "grandchildren.gname": 1 } } })).toMatchObject([{ reason: "type_mismatch", path: "children.grandchildren.gname" }]);
    });

    it("accepts valid nested array-element filters", () => {
        expect(vm({ children: { name: "Bob" } })).toEqual([]);
        expect(vm({ children: { $elemMatch: { name: "Bob", age: 20 } } })).toEqual([]);
        expect(vm({ children: { $elemMatch: { "grandchildren.gname": "Rita" } } })).toEqual([]);
    });

    it("does not descend array-level operators the matcher handles atomically", () => {
        expect(vm({ children: { $size: 1 } })).toEqual([]);
        expect(vm({ children: { $exists: true } })).toEqual([]);
        expect(vm({ children: { $type: "array" } })).toEqual([]);
        expect(vm({ children: { $in: [1] } })).toEqual([]);
        expect(vm({ children: { $elemMatch: { $gt: 5 } } })).toEqual([]); // operator-only $elemMatch body → not descended
    });

    it("descends $and inside an object-array (compound and $elemMatch forms) — the matcher applies it per-element", () => {
        expect(vm({ children: { $and: [{ ghost: 1 }] } })).toMatchObject([{ reason: "unknown_field", path: "children.ghost" }]);
        expect(vm({ children: { $elemMatch: { $and: [{ age: "old" }] } } })).toMatchObject([{ reason: "type_mismatch", path: "children.age" }]);
    });

    it("does not flag a logic-rescued arm inside an object-array ($or sibling can match; $nor matches missing)", () => {
        expect(vm({ children: { $or: [{ ghost: 1 }, { name: "Bob" }] } })).toEqual([]);
        expect(vm({ children: { $nor: [{ ghost: 1 }] } })).toEqual([]);
    });

    it("leaves scalar arrays unvalidated (conservative)", () => {
        expect(vm({ tags: { ghost: 1 } })).toEqual([]);
        expect(vm({ tags: "x" })).toEqual([]);
    });

    it("treats an object-valued compound key as an opaque deep-eql leaf (does not descend non-arrays)", () => {
        expect(vm({ poly: { v: 5 } })).toEqual([]); // poly is a union object, not an array → not descended
    });
});

describe("validateWhereFilter — non-strict objects fail-allow (unknown_field fires only under .strict())", () => {
    const Loose = z.object({ id: z.string(), age: z.number() }).passthrough();
    const vLoose = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, Loose);

    it("does not flag an unknown key under a default (strip) object — the engine stores rows un-normalised, so the key may be present", () => {
        const Strip = z.object({ id: z.string(), age: z.number() }); // default = strip mode
        const vStrip = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, Strip);
        expect(vStrip({ ghost: 1 })).toEqual([]);
        expect(vStrip({ age: "old" })).toMatchObject([{ reason: "type_mismatch", path: "age" }]); // known field still type-checked
    });

    it("does not flag an unknown key under a top-level passthrough object", () => {
        expect(vLoose({ ghost: 1 })).toEqual([]);
        expect(vLoose({ ghost: { $gt: 5 } })).toEqual([]);
        expect(vLoose({ "ghost.deep": "x" })).toEqual([]);
    });

    it("still validates KNOWN fields under a passthrough object (fail-allow is unknown-key-only)", () => {
        expect(vLoose({ age: "old" })).toMatchObject([{ reason: "type_mismatch", path: "age" }]);
        expect(vLoose({ age: NaN })).toMatchObject([{ reason: "non_finite", path: "age" }]);
    });

    it("does not flag an unknown key under a .catchall() object", () => {
        const Catchall = z.object({ id: z.string() }).catchall(z.number());
        expect(validateWhereFilter({ ghost: 1 } as WhereFilterDefinition<Record<string, unknown>>, Catchall)).toEqual([]);
    });

    const Nested = z.object({
        id: z.string(),
        inner: z.object({ a: z.string() }).passthrough(),
        wrapped: z.object({ b: z.string() }).passthrough().optional(),
        strictInner: z.object({ c: z.string() }).strict(),
    }).strict();
    const vNested = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, Nested);

    it("does not flag an unknown key under a nested or wrapper-wrapped passthrough object", () => {
        expect(vNested({ "inner.ghost": 1 })).toEqual([]);
        expect(vNested({ "wrapped.ghost": 1 })).toEqual([]); // passthrough().optional() — catchall is on the unwrapped inner
    });

    it("still flags an unknown key under a sibling strict object", () => {
        expect(vNested({ "strictInner.ghost": 1 })).toMatchObject([{ reason: "unknown_field", path: "strictInner.ghost" }]);
        expect(vNested({ ghost: 1 })).toMatchObject([{ reason: "unknown_field", path: "ghost" }]); // root is strict → undeclared key flagged
    });
});

describe("validateWhereFilter — mixed-strictness unions (a tolerant variant can carry the key, so never flag)", () => {
    // A strict variant declares `a`; a passthrough sibling omits it and tolerates extras. A passthrough-variant
    // conforming row can carry `a` (or any undeclared key) of any type, which the matcher matches.
    const MixedOmit = z.object({
        poly: z.union([
            z.object({ t: z.literal("x"), a: z.string() }).strict(),
            z.object({ t: z.literal("y") }).passthrough(),
        ]),
    }).strict();
    const vMixed = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, MixedOmit);

    it("does not flag an undeclared key under a mixed-strictness union", () => {
        expect(vMixed({ "poly.ghost": 1 })).toEqual([]);
    });
    it("does not type-check a key that a fail-open sibling variant omits", () => {
        expect(vMixed({ "poly.a": 5 })).toEqual([]);
        expect(vMixed({ "poly.a": { $in: [5] } })).toEqual([]);
    });
    it("metamorphic: a conforming passthrough-variant row carrying the extra key is matched, never flagged", () => {
        const row = { poly: { t: "y", a: 5, ghost: 7 } };
        expect(MixedOmit.safeParse(row).success).toBe(true);
        expect(matchJavascriptObject(row, { "poly.a": 5 } as WhereFilterDefinition<any>)).toBe(true);
        expect(matchJavascriptObject(row, { "poly.ghost": 7 } as WhereFilterDefinition<any>)).toBe(true);
        expect(vMixed({ "poly.a": 5 })).toEqual([]);
        expect(vMixed({ "poly.ghost": 7 })).toEqual([]);
    });

    // An all-strict union genuinely excludes undeclared/mistyped keys → still flagged.
    const AllStrict = z.object({
        poly: z.union([
            z.object({ t: z.literal("x"), a: z.string() }).strict(),
            z.object({ t: z.literal("y"), b: z.number() }).strict(),
        ]),
    }).strict();
    const vAll = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, AllStrict);
    it("still flags an undeclared key and a mistype under an all-strict union", () => {
        expect(vAll({ "poly.ghost": 1 })).toMatchObject([{ reason: "unknown_field", path: "poly.ghost" }]);
        expect(vAll({ "poly.a": 5 })).toMatchObject([{ reason: "type_mismatch", path: "poly.a" }]);
    });

    it("still type-checks a declared field under a single non-strict object (declared types are parse-enforced)", () => {
        const Strip = z.object({ age: z.number() }); // default strip
        expect(validateWhereFilter({ age: "old" } as WhereFilterDefinition<Record<string, unknown>>, Strip)).toMatchObject([{ reason: "type_mismatch", path: "age" }]);
    });
});

describe("validateWhereFilter — malformed operands (flagged statically, regardless of data or logic polarity)", () => {
    const S = z.object({ id: z.string(), age: z.number(), children: z.array(z.object({ name: z.string() }).strict()) }).strict();
    const v = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, S);

    it("flags an un-compilable $regex pattern at top level, nested, and under $or", () => {
        expect(v({ id: { $regex: "[" } })).toMatchObject([{ reason: "malformed", path: "id" }]);
        expect(v({ children: { $elemMatch: { name: { $regex: "(" } } } })).toMatchObject([{ reason: "malformed", path: "children.name" }]);
        // Under $or the matcher short-circuits — the `{id:"x"}` arm can match, so the malformed arm is NOT
        // flagged here (that would be a false positive); the write engine's runtime dry-run catches it instead.
        expect(v({ $or: [{ id: "x" }, { id: { $regex: "[" } }] })).toEqual([]);
    });
    it("flags a non-number/string range operand", () => {
        expect(v({ age: { $gt: undefined } })).toMatchObject([{ reason: "malformed", path: "age" }]);
        expect(v({ age: { $lt: null } })).toMatchObject([{ reason: "malformed", path: "age" }]);
    });
    it("does not flag a valid $regex or a number/string range operand (incl. Infinity)", () => {
        expect(v({ id: { $regex: "^a.*z$" } })).toEqual([]);
        expect(v({ age: { $lt: Infinity } })).toEqual([]);
        expect(v({ age: { $gte: 5 } })).toEqual([]);
    });
});

describe("validateWhereFilter — malformed operands rescued by short-circuit/broadening are NOT flagged (fuzz regressions)", () => {
    // Each shape was false-positived before the polarity gate: the matcher short-circuits ($or.some / $nor.some
    // / $and.every) or $not matches a missing field, so the malformed operand is never evaluated and the filter
    // MATCHES the row below. Flagging any would be a false positive. (A malformed operand a row actually reaches
    // is caught by the write engine's runtime dry-run, covered in the invalid-filter write tests.)
    const S = z.object({
        id: z.string(),
        age: z.number().optional(),
        flag: z.boolean().optional(),
        note: z.string().optional(),
    }).strict();
    const v = (f: unknown) => validateWhereFilter(f as WhereFilterDefinition<Record<string, unknown>>, S);
    const row = { id: "x" }; // age / flag / note absent

    const rescued: unknown[] = [
        { $or: [{ id: "x" }, { id: { $regex: "[" } }] }, // $or matches via the first arm; regex arm short-circuited
        { $or: [{ id: "x" }, { age: { $gt: undefined } }] },
        { $nor: [{ note: { $regex: "[" } }] }, // note absent → regex never compiled → $nor matches
        { $nor: [{ age: { $lt: true } }] },
        { $nor: [{ id: "y" }, { flag: true, age: { $gt: true } }] }, // age clause short-circuited by flag:true failing
        { note: { $not: { $regex: "[" } } }, // $not matches the missing note
        { age: { $not: { $gt: undefined } } },
    ];

    it.each(rescued.map((f, i) => [i, f] as const))("#%i: matcher matches the row, so validator must not flag", (_i, f) => {
        expect(matchJavascriptObject(row, f as WhereFilterDefinition<typeof row>)).toBe(true);
        expect(v(f)).toEqual([]);
    });
});

/**
 * Metamorphic safety net: the validator must NEVER reject a filter the matcher would actually match.
 * The single property holds for *every* filter (no exceptions, including `$or`/`$nor`):
 *
 *   `validate(f) flags ⟹ matchJavascriptObject matches 0 of these items`.
 *
 * A flagged filter that matches even one item is a false positive — the bug this round eliminates. The
 * corpus deliberately mixes broadening operators, logic-rescued arms, and would-throw (malformed) filters,
 * which are the forms that previously false-positived. A matcher throw counts as neither match nor no-match,
 * so flagging a would-throw filter stays conservative.
 */
describe("validateWhereFilter — metamorphic (never rejects what the matcher matches)", () => {
    const items: M[] = [
        { id: "1", age: 30, active: true, score: null, tags: ["x"], meta: { x: "y" }, contact: { email: "a@b" }, children: [{ name: "Bob", age: 20, grandchildren: [{ gname: "Rita" }] }], items: [{ kind: "a", a: "hi" }], sameKey: [{ v: 7 }], poly: { t: "y", v: 5 }, du: { dk: "c1", c1: "z" } },
        { id: "2", age: 1, active: false, score: 9, tags: ["q"], meta: {}, contact: { email: "c@d" }, children: [], items: [{ kind: "b", b: 7 }], sameKey: [{ v: "s" }], poly: { t: "x", v: "hi" }, du: { dk: "c2", c2: 5 } },
        { id: "3", age: 50, active: true, score: null, tags: [], meta: { k: "v" }, contact: { email: "e@f", phone: "1" }, children: [{ name: "Al", age: 2, grandchildren: [] }], items: [], sameKey: [], poly: { t: "y", v: 9 }, du: { dk: "c1", c1: "w" }, optArr: [{ oa: "z" }] },
    ];

    it("the corpus rows all conform to the schema (guards the unknown_field assumption)", () => {
        for (const it of items) expect(M.safeParse(it).success).toBe(true);
    });

    const matchCount = (f: unknown): number => {
        let n = 0;
        for (const it of items) {
            try { if (matchJavascriptObject(it, f as WhereFilterDefinition<M>)) n++; } catch { /* throw ≠ match and ≠ no-match */ }
        }
        return n;
    };

    const corpus: unknown[] = [
        // — valid, matcher may match (antecedent false → vacuously safe) —
        {}, { id: "1" }, { age: { $gte: 18 } }, { active: true }, { "contact.email": "a@b" },
        { tags: "x" }, { tags: { $size: 1 } }, { "meta.anything": "x" }, { score: null },
        { children: { name: "Bob" } }, { children: { $elemMatch: { age: 20 } } },
        { "children.grandchildren": { gname: "Rita" } }, { "poly.v": 5 }, { "poly.v": "hi" },
        { "sameKey.v": 7 }, { "sameKey.v": "s" }, { items: { a: "hi" } }, { "du.c1": "z" },
        { children: { $exists: true } }, { children: { $type: "array" } }, { optArr: { $elemMatch: { oa: "z" } } },
        // — broadening / logic-rescued: MATCH MANY rows, so flagging any of these would be a false positive —
        { age: { $ne: 999 } }, { id: { $ne: 5 } }, { ghost: { $ne: 5 } }, { ghost: null },
        { ghost: { $exists: false } }, { nickname: { $exists: false } }, { age: { $nin: [1, 2] } },
        { age: { $in: [1, Infinity] } }, { age: { $in: [1, "a"] } }, { age: { $lt: Infinity } },
        { $or: [{ id: "1" }, { ghost: 1 }] }, { $nor: [{ ghost: 1 }] },
        { children: { $or: [{ ghost: 1 }, { name: "Bob" }] } }, { children: { $nor: [{ ghost: 1 }] } }, // array-logic rescue → match, not flagged
        // — invalid: flagged AND matches nothing (positive contradictions + would-throw) —
        { ghost: 1 }, { "contact.ghost": 1 }, { age: "old" }, { id: 5 }, { active: "yes" },
        { age: { $gt: Infinity } }, { children: { $elemMatch: { age: { $gt: Infinity } } } }, // ±Infinity in a zero-match position → flagged, matches 0
        { age: { $in: ["a"] } }, { age: NaN }, { age: { $gt: NaN } },
        { children: { ghost: 1 } }, { children: { $elemMatch: { ghost: 1 } } },
        { children: { age: "wrong" } }, { children: { $elemMatch: { age: { $gt: NaN } } } },
        { "children.grandchildren": { ghost: 1 } }, { children: { $elemMatch: { "grandchildren.gname": 1 } } },
        { items: { a: 7 } }, // only variant 'a' has key 'a' (string) → flagged, matcher matches 0
        { children: { $and: [{ ghost: 1 }] } }, { children: { $elemMatch: { $and: [{ age: "old" }] } } }, // array-logic must-match → flagged, matches 0
        null, [], { $or: [null] }, { $and: [{ id: "1" }, { ghost: 1 }] }, // malformed (throws) + $and must-match
    ];

    it.each(corpus.map((f, i) => [i, f] as const))("#%i: a flagged filter matches zero items", (_i, f) => {
        if (vm(f).length > 0) expect(matchCount(f)).toBe(0);
    });
});
