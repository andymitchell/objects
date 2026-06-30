import { describe, it, expect } from "vitest";
import { z } from "zod";
import { objectRejectsUnknownKeys, getSchemaChildren, getLiteralValues, getEnumValues, getZodKind } from "./introspection.ts";

/**
 * `objectRejectsUnknownKeys` reads zod's UNDOCUMENTED `_zod.def.catchall`. These tests pin its behaviour to
 * the installed zod so a version bump that changes the internal representation fails loudly here — rather
 * than silently shifting where-filter unknown_field flagging (e.g. a strict object misread as non-strict).
 */
describe("objectRejectsUnknownKeys (pinned to the installed zod)", () => {
    describe("objects that REJECT unknown keys → true (a written row cannot carry an extra key)", () => {
        it("detects .strict()", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict())).toBe(true);
        });
        it("detects z.strictObject", () => {
            expect(objectRejectsUnknownKeys(z.strictObject({ a: z.string() }))).toBe(true);
        });
    });

    describe("objects that TOLERATE or KEEP unknown keys → false (a row may carry an extra key)", () => {
        it("treats a default (strip) object as not rejecting", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }))).toBe(false);
        });
        it("treats .passthrough(), z.looseObject and .catchall(x) as not rejecting", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).passthrough())).toBe(false);
            expect(objectRejectsUnknownKeys(z.looseObject({ a: z.string() }))).toBe(false);
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).catchall(z.number()))).toBe(false);
        });
        it("treats non-object schemas as not rejecting", () => {
            expect(objectRejectsUnknownKeys(z.string())).toBe(false);
            expect(objectRejectsUnknownKeys(z.array(z.string()))).toBe(false);
            expect(objectRejectsUnknownKeys(z.record(z.string(), z.string()))).toBe(false);
        });
    });

    describe("unwraps transparent wrappers before deciding (the catchall sits on the inner object)", () => {
        it("sees through .optional()", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().optional())).toBe(true);
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).passthrough().optional())).toBe(false);
        });
        it("sees through .nullable() and .default()", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().nullable())).toBe(true);
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().default({ a: "x" }))).toBe(true);
        });
        it("treats a refined strict object as rejecting (refine does not wrap)", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().refine(() => true))).toBe(true);
        });
    });
});

/**
 * `getSchemaChildren` reads several UNDOCUMENTED `_zod.def` fields (shape, element, valueType, options,
 * left/right, getter, items, catchall). These pins assert its per-kind output against the installed zod so a
 * version bump that renames or reshapes any field fails loudly here — rather than silently mis-walking a schema.
 */
describe("getSchemaChildren (pinned to the installed zod)", () => {
    const shape = (s: z.ZodType) => getSchemaChildren(s).map((c) => ({ relation: c.relation, key: c.key, kind: getZodKind(c.schema) }));

    it("object → one 'field' per shape key; a default object has no catchall child", () => {
        expect(shape(z.object({ a: z.string(), b: z.number() }))).toEqual([
            { relation: "field", key: "a", kind: "string" },
            { relation: "field", key: "b", kind: "number" },
        ]);
    });

    it("object catchall child: default→absent, strict→never, passthrough/loose→unknown, .catchall(x)→x", () => {
        const catchall = (s: z.ZodType) => getSchemaChildren(s).find((c) => c.relation === "catchall");
        expect(catchall(z.object({ a: z.string() }))).toBeUndefined();
        expect(getZodKind(catchall(z.object({ a: z.string() }).strict())!.schema)).toBe("never");
        expect(getZodKind(catchall(z.object({ a: z.string() }).passthrough())!.schema)).toBe("unknown");
        expect(getZodKind(catchall(z.looseObject({ a: z.string() }))!.schema)).toBe("unknown");
        expect(getZodKind(catchall(z.object({ a: z.string() }).catchall(z.bigint()))!.schema)).toBe("bigint");
    });

    it("array → 'element'; record → 'value'", () => {
        expect(shape(z.array(z.boolean()))).toEqual([{ relation: "element", key: undefined, kind: "boolean" }]);
        expect(shape(z.record(z.string(), z.bigint()))).toEqual([{ relation: "value", key: undefined, kind: "bigint" }]);
    });

    it("union → one 'variant' per option, including a discriminated union", () => {
        expect(shape(z.union([z.string(), z.number()]))).toEqual([
            { relation: "variant", key: undefined, kind: "string" },
            { relation: "variant", key: undefined, kind: "number" },
        ]);
        const du = z.discriminatedUnion("t", [
            z.object({ t: z.literal("a"), x: z.string() }),
            z.object({ t: z.literal("b"), y: z.number() }),
        ]);
        expect(getSchemaChildren(du).map((c) => c.relation)).toEqual(["variant", "variant"]);
    });

    it("intersection → both arms; lazy → 'wrapped' (thunk invoked)", () => {
        expect(shape(z.object({ a: z.string() }).and(z.object({ b: z.string() })))).toEqual([
            { relation: "intersection", key: undefined, kind: "object" },
            { relation: "intersection", key: undefined, kind: "object" },
        ]);
        expect(shape(z.lazy(() => z.string()))).toEqual([{ relation: "wrapped", key: undefined, kind: "string" }]);
    });

    it("tuple → 'item' per index, plus a rest 'element'", () => {
        expect(shape(z.tuple([z.string(), z.number()]))).toEqual([
            { relation: "item", key: 0, kind: "string" },
            { relation: "item", key: 1, kind: "number" },
        ]);
        expect(shape(z.tuple([z.string()]).rest(z.boolean()))).toEqual([
            { relation: "item", key: 0, kind: "string" },
            { relation: "element", key: undefined, kind: "boolean" },
        ]);
    });

    it("transparent wrappers → 'wrapped' inner", () => {
        expect(shape(z.string().optional())).toEqual([{ relation: "wrapped", key: undefined, kind: "string" }]);
        expect(shape(z.string().nullable())).toEqual([{ relation: "wrapped", key: undefined, kind: "string" }]);
        expect(shape(z.string().default("x"))).toEqual([{ relation: "wrapped", key: undefined, kind: "string" }]);
    });

    it("leaves and value-transforming/opaque kinds → [] (explicit, never reflectively crawled)", () => {
        expect(getSchemaChildren(z.string())).toEqual([]);
        expect(getSchemaChildren(z.literal("x"))).toEqual([]);
        expect(getSchemaChildren(z.string().transform((s) => s))).toEqual([]);
        expect(getSchemaChildren(z.string().pipe(z.string()))).toEqual([]);
    });
});

/**
 * `getLiteralValues` reads `_zod.def.values`. Pinned so a JSON-safety walk can value-check a literal — its
 * KIND is `literal` regardless, but a bigint/symbol/Date value cannot round-trip JSON.
 */
describe("getLiteralValues (pinned to the installed zod)", () => {
    it("returns the raw literal payloads, preserving a non-JSON type", () => {
        expect(getLiteralValues(z.literal("ok"))).toEqual(["ok"]);
        expect(getLiteralValues(z.literal(7))).toEqual([7]);
        const big = getLiteralValues(z.literal(5n));
        expect(big.length).toBe(1);
        expect(typeof big[0]).toBe("bigint");
    });
});

/**
 * `getEnumValues` reads `_zod.def.entries`. Pinned because a native numeric enum's reverse mapping makes the
 * accepted values un-readable from the entries object alone — so a consumer deciding a column's scalar kind can
 * tell a numeric enum from a string one.
 */
describe("getEnumValues (pinned to the installed zod)", () => {
    it("returns a string enum's string members", () => {
        expect([...getEnumValues(z.enum(["a", "b"]))].sort()).toEqual(["a", "b"]);
    });

    it("returns a native numeric enum's numbers (not the reverse-mapped member names)", () => {
        enum NumE { A = 0, B = 1, C = 2 }
        const vals = getEnumValues(z.enum(NumE));
        expect([...vals].sort()).toEqual([0, 1, 2]);
        expect(vals.every((v) => typeof v === "number")).toBe(true);
    });

    it("returns a native string enum's string values (not its keys)", () => {
        enum StrE { A = "a", B = "b" }
        expect([...getEnumValues(z.enum(StrE))].sort()).toEqual(["a", "b"]);
    });

    it("returns both runtime types for a mixed enum", () => {
        enum MixedE { A = "a", B = 1 }
        const vals = getEnumValues(z.enum(MixedE));
        expect(vals).toContain("a");
        expect(vals).toContain(1);
        expect(new Set(vals.map((v) => typeof v))).toEqual(new Set(["string", "number"]));
    });
});
