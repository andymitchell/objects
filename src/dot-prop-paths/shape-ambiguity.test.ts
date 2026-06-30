import { z } from "zod";
import { findShapeAmbiguousPaths, findMultiScalarUnionPaths } from "./shape-ambiguity.ts";
import { ContactSchema } from "../where-filter/standardTests.ts";

/**
 * The detector exists so callers that demand JS↔SQL parity can reject a schema a schema-driven engine
 * cannot represent: one whose field is BOTH an array and a non-array (a scalar or an object) at the same
 * path. These tests pin exactly which shapes are ambiguous (must reject) versus representable (must pass).
 */
describe("findShapeAmbiguousPaths", () => {
    const paths = (schema: z.ZodType): string[] => findShapeAmbiguousPaths(schema).map((a) => a.dotprop_path);

    describe("flags a field that is declared as both a scalar and an array", () => {
        test("string | string[]", () => {
            expect(paths(z.object({ owner: z.union([z.string(), z.array(z.string())]) }))).toEqual(["owner"]);
        });
        test("number | number[]", () => {
            expect(paths(z.object({ score: z.union([z.number(), z.array(z.number())]) }))).toEqual(["score"]);
        });
        test("boolean | boolean[]", () => {
            expect(paths(z.object({ flag: z.union([z.boolean(), z.array(z.boolean())]) }))).toEqual(["flag"]);
        });
        test("the arm order does not matter (array arm first)", () => {
            expect(paths(z.object({ owner: z.union([z.array(z.string()), z.string()]) }))).toEqual(["owner"]);
        });
        test("an ambiguous union behind a transparent wrapper is still flagged", () => {
            expect(paths(z.object({ owner: z.union([z.string(), z.array(z.string())]).optional() }))).toEqual(["owner"]);
        });
    });

    describe("does NOT flag a shape a schema-driven engine can represent", () => {
        test("scalar | scalar (string | number)", () => {
            expect(paths(z.object({ v: z.union([z.string(), z.number()]) }))).toEqual([]);
        });
        test("scalar | null", () => {
            expect(paths(z.object({ v: z.union([z.string(), z.null()]) }))).toEqual([]);
        });
        test("array | null (a nullable array, not ambiguous)", () => {
            expect(paths(z.object({ v: z.union([z.array(z.string()), z.null()]) }))).toEqual([]);
        });
        test("array | array", () => {
            expect(paths(z.object({ v: z.union([z.array(z.string()), z.array(z.number())]) }))).toEqual([]);
        });
        test("a plain array field", () => {
            expect(paths(z.object({ tags: z.array(z.string()) }))).toEqual([]);
        });
        test("object | null (the intermediate union behind a nested dot-path)", () => {
            expect(paths(z.object({ meta: z.union([z.object({ owner_id: z.string() }), z.null()]) }))).toEqual([]);
        });
        test("a flat scalar object (incl. an id field)", () => {
            expect(paths(z.object({ id: z.string(), name: z.string() }))).toEqual([]);
        });
        test("a discriminated union stays opaque — not descended, not flagged", () => {
            const schema = z.object({
                shape: z.discriminatedUnion("t", [
                    z.object({ t: z.literal("a"), x: z.string() }),
                    z.object({ t: z.literal("b"), y: z.array(z.string()) }),
                ]),
            });
            expect(paths(schema)).toEqual([]);
        });
    });

    describe("walks nested structures and reports the full dot-prop path", () => {
        test("a nested ambiguous field", () => {
            expect(paths(z.object({ meta: z.object({ owner: z.union([z.string(), z.array(z.string())]) }) }))).toEqual([
                "meta.owner",
            ]);
        });
        test("an ambiguous field inside an array element (nameless — same path as the array)", () => {
            expect(
                paths(z.object({ items: z.array(z.object({ owner: z.union([z.string(), z.array(z.string())]) })) })),
            ).toEqual(["items.owner"]);
        });
        test("an ambiguous field inside the object arm of an object|null union", () => {
            const schema = z.object({
                meta: z.union([z.object({ owner: z.union([z.string(), z.array(z.string())]) }), z.null()]),
            });
            expect(paths(schema)).toEqual(["meta.owner"]);
        });
        test("reports every ambiguous field", () => {
            const schema = z.object({
                a: z.union([z.string(), z.array(z.string())]),
                b: z.string(),
                c: z.union([z.number(), z.array(z.number())]),
            });
            expect(paths(schema).sort()).toEqual(["a", "c"]);
        });
    });

    describe("reports which arm-kinds collided, for a debuggable error message", () => {
        test("names both the scalar and the array kind", () => {
            const [hit] = findShapeAmbiguousPaths(z.object({ owner: z.union([z.string(), z.array(z.string())]) }));
            expect(hit?.arm_kinds).toEqual(expect.arrayContaining(["string", "array"]));
        });
    });

    describe("flattens nested union arms before deciding (a union arm hides no shape)", () => {
        test("array | union([string, number]) is ambiguous even though no single arm is both", () => {
            const schema = z.object({ v: z.union([z.array(z.string()), z.union([z.string(), z.number()])]) });
            expect(paths(schema)).toEqual(["v"]);
        });
        test("union([string, number]) | union([array, array]) is ambiguous", () => {
            const schema = z.object({
                v: z.union([z.union([z.string(), z.number()]), z.union([z.array(z.string()), z.array(z.number())])]),
            });
            expect(paths(schema)).toEqual(["v"]);
        });
    });

    describe("classifies a literal by its value, so a null literal is null (not scalar)", () => {
        test("literal(null) | array is the supported nullable-array — NOT flagged", () => {
            const schema = z.object({ v: z.union([z.literal(null), z.array(z.string())]) });
            expect(paths(schema)).toEqual([]);
        });
        test("a non-null literal | array IS flagged (a string literal is scalar)", () => {
            const schema = z.object({ v: z.union([z.literal("x"), z.array(z.string())]) });
            expect(paths(schema)).toEqual(["v"]);
        });
    });
});

/**
 * The multi-scalar detector flags a union of ≥2 distinct scalar kinds (no array/object) so a schema-driven engine
 * compares it as a raw JSON value rather than coercing every row through one column cast.
 */
describe("findMultiScalarUnionPaths", () => {
    const paths = (schema: z.ZodType): string[] => findMultiScalarUnionPaths(schema).map((m) => m.dotprop_path);

    describe("flags a union spanning more than one scalar kind", () => {
        test("boolean | number | string | null", () => {
            const schema = z.object({ secret: z.union([z.boolean(), z.number(), z.string(), z.null()]) });
            expect(paths(schema)).toEqual(["secret"]);
        });
        test("string | number (no null)", () => {
            expect(paths(z.object({ v: z.union([z.string(), z.number()]) }))).toEqual(["v"]);
        });
        test("reports the distinct scalar kinds", () => {
            const [hit] = findMultiScalarUnionPaths(z.object({ secret: z.union([z.boolean(), z.number(), z.string()]) }));
            expect(hit?.scalar_kinds.slice().sort()).toEqual(["boolean", "number", "string"]);
        });
        test("a nested-union flatten still counts the kinds (number | union([string, boolean]))", () => {
            const schema = z.object({ v: z.union([z.number(), z.union([z.string(), z.boolean()])]) });
            expect(paths(schema)).toEqual(["v"]);
        });
    });

    describe("does NOT flag a union that has one faithful column cast", () => {
        test("boolean | null (single scalar kind + null — keeps its typed cast)", () => {
            expect(paths(z.object({ deleted: z.union([z.boolean(), z.null()]) }))).toEqual([]);
        });
        test("string | null", () => {
            expect(paths(z.object({ v: z.union([z.string(), z.null()]) }))).toEqual([]);
        });
        test("a plain scalar field", () => {
            expect(paths(z.object({ name: z.string() }))).toEqual([]);
        });
        test("a shape-ambiguous scalar|array field is reported by the OTHER detector, never here", () => {
            const schema = z.object({ owner: z.union([z.string(), z.array(z.string())]) });
            expect(paths(schema)).toEqual([]);
            expect(findShapeAmbiguousPaths(schema).map((a) => a.dotprop_path)).toEqual(["owner"]);
        });
    });
});

/**
 * The defining miss in earlier rounds: the rule reasoned about a union NODE locally, so a path that is a scalar in
 * one object arm and an array in a sibling arm — the same path, two arms — slipped through. These tests pin that
 * the rule now judges every alternative reaching a path together, and that widening to "array coexists with a
 * non-array" (tuple counts as array, discriminated union as object) closes the silent holes without over-flagging.
 */
describe("findShapeAmbiguousPaths — completeness of the array/non-array rule", () => {
    const paths = (schema: z.ZodType): string[] => findShapeAmbiguousPaths(schema).map((a) => a.dotprop_path);

    describe("flags a path that is an array in one arm and a non-array in a sibling object arm (the cross-arm miss)", () => {
        test("a field that is a string in one object arm and an array in another", () => {
            const schema = z.object({
                k: z.union([z.object({ v: z.string() }), z.object({ v: z.array(z.string()) })]),
            });
            expect(paths(schema)).toEqual(["k.v"]);
        });
        test("the collision is found however deep the shared sub-path is", () => {
            const schema = z.object({
                record: z.union([
                    z.object({ meta: z.object({ owner: z.string() }) }),
                    z.object({ meta: z.object({ owner: z.array(z.string()) }) }),
                ]),
            });
            expect(paths(schema)).toEqual(["record.meta.owner"]);
        });
        test("the collision is found when the colliding arms live inside an array element", () => {
            const schema = z.object({
                items: z.array(z.union([z.object({ v: z.string() }), z.object({ v: z.array(z.string()) })])),
            });
            expect(paths(schema)).toEqual(["items.v"]);
        });
    });

    describe("flags an array coexisting with an object at one path", () => {
        test("an array arm beside an object arm", () => {
            expect(paths(z.object({ k: z.union([z.array(z.string()), z.object({ a: z.string() })]) }))).toEqual(["k"]);
        });
        test("an array-of-objects arm beside an object arm (the parent collision is enough)", () => {
            const schema = z.object({
                k: z.union([z.array(z.object({ v: z.string() })), z.object({ v: z.array(z.string()) })]),
            });
            expect(paths(schema)).toEqual(["k"]);
        });
    });

    describe("flags through the tuple→array and discriminatedUnion→object classifications (the silent holes)", () => {
        test("a tuple (an array) beside a scalar", () => {
            expect(paths(z.object({ k: z.union([z.tuple([z.string()]), z.string()]) }))).toEqual(["k"]);
        });
        test("a tuple (an array) beside an object", () => {
            expect(paths(z.object({ k: z.union([z.tuple([z.string()]), z.object({ a: z.string() })]) }))).toEqual(["k"]);
        });
        test("a discriminated union (an object) beside an array", () => {
            const schema = z.object({
                k: z.union([
                    z.discriminatedUnion("t", [z.object({ t: z.literal("a") }), z.object({ t: z.literal("b") })]),
                    z.array(z.string()),
                ]),
            });
            expect(paths(schema)).toEqual(["k"]);
        });
        test("a record (an object) beside an array", () => {
            expect(
                paths(z.object({ k: z.union([z.record(z.string(), z.string()), z.array(z.string())]) })),
            ).toEqual(["k"]);
        });
    });

    describe("does NOT over-flag a single tuple / record shape (a classification widens the category, not the descent)", () => {
        test("a bare tuple field is one array shape", () => {
            expect(paths(z.object({ k: z.tuple([z.string(), z.number()]) }))).toEqual([]);
        });
        test("a tuple beside null is a nullable array", () => {
            expect(paths(z.object({ k: z.union([z.tuple([z.string()]), z.null()]) }))).toEqual([]);
        });
        test("an array beside a tuple are both arrays", () => {
            expect(paths(z.object({ k: z.union([z.array(z.string()), z.tuple([z.number()])]) }))).toEqual([]);
        });
        test("a discriminated union beside an object are both objects", () => {
            const schema = z.object({
                k: z.union([
                    z.discriminatedUnion("t", [z.object({ t: z.literal("a") }), z.object({ t: z.literal("b") })]),
                    z.object({ a: z.string() }),
                ]),
            });
            expect(paths(schema)).toEqual([]);
        });
        test("a record beside an object are both objects", () => {
            expect(
                paths(z.object({ k: z.union([z.record(z.string(), z.string()), z.object({ a: z.string() })]) })),
            ).toEqual([]);
        });
        test("a bare record field is one object shape", () => {
            expect(paths(z.object({ k: z.record(z.string(), z.string()) }))).toEqual([]);
        });
    });

    describe("does NOT flag a scalar coexisting with an object — no array, so no spread-vs-cast choice to make", () => {
        test("scalar arm first", () => {
            expect(paths(z.object({ k: z.union([z.string(), z.object({ a: z.string() })]) }))).toEqual([]);
        });
        test("object arm first (arm order does not change the verdict)", () => {
            expect(paths(z.object({ k: z.union([z.object({ a: z.string() }), z.string()]) }))).toEqual([]);
        });
    });

    describe("is arm-order invariant", () => {
        test("a scalar|array collision is flagged with the scalar arm first", () => {
            expect(paths(z.object({ v: z.union([z.string(), z.array(z.string())]) }))).toEqual(["v"]);
        });
        test("a scalar|array collision is flagged with the array arm first", () => {
            expect(paths(z.object({ v: z.union([z.array(z.string()), z.string()]) }))).toEqual(["v"]);
        });
        test("a null-literal nullable array passes with either arm first", () => {
            expect(paths(z.object({ v: z.union([z.literal(null), z.array(z.string())]) }))).toEqual([]);
            expect(paths(z.object({ v: z.union([z.array(z.string()), z.literal(null)]) }))).toEqual([]);
        });
        test("a z.null() nullable array passes with either arm first", () => {
            expect(paths(z.object({ v: z.union([z.null(), z.array(z.string())]) }))).toEqual([]);
            expect(paths(z.object({ v: z.union([z.array(z.string()), z.null()]) }))).toEqual([]);
        });
    });

    describe("names both colliding kinds, for a debuggable message", () => {
        test("an array|object collision names array and object", () => {
            const [hit] = findShapeAmbiguousPaths(
                z.object({ k: z.union([z.array(z.string()), z.object({ a: z.string() })]) }),
            );
            expect(hit?.arm_kinds).toEqual(expect.arrayContaining(["array", "object"]));
        });
    });
});

/**
 * The cross-arm fix reaches the multi-scalar detector too: a field that is one scalar kind in one object arm and a
 * different scalar kind in a sibling arm has no single column cast, so it must be reported as a nested multi-scalar
 * path — the in-code half of the SQL-emission guard.
 */
describe("findMultiScalarUnionPaths — cross-arm aggregation", () => {
    test("flags a field that is a different scalar kind in each sibling object arm", () => {
        const schema = z.object({ k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]) });
        const [hit] = findMultiScalarUnionPaths(schema);
        expect(hit?.dotprop_path).toBe("k.a");
        expect(hit?.scalar_kinds.slice().sort()).toEqual(["number", "string"]);
    });
    test("the same cross-arm field is NOT a shape-ambiguity (no array is involved)", () => {
        const schema = z.object({ k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]) });
        expect(findShapeAmbiguousPaths(schema)).toEqual([]);
    });
    test("a string-array arm beside a number-array arm makes the shared element a multi-scalar path", () => {
        // The two array arms share one nameless element path; merging their elements is what lets a cross-array-arm
        // scalar|array collision be caught, and here it surfaces the element as multi-scalar — a string[] and a
        // number[] must be compared by raw JSON value, not one element-column cast. (Not a shape-ambiguity: no path
        // is both an array and a non-array.)
        const schema = z.object({ v: z.union([z.array(z.string()), z.array(z.number())]) });
        expect(findShapeAmbiguousPaths(schema)).toEqual([]);
        const [hit] = findMultiScalarUnionPaths(schema);
        expect(hit?.dotprop_path).toBe("v");
        expect(hit?.scalar_kinds.slice().sort()).toEqual(["number", "string"]);
    });
});

describe("findMultiScalarUnionPaths — enum members classified by runtime value", () => {
    enum NumE { A = 0, B = 1, C = 2 }
    enum StrE { A = "a", B = "b" }

    test("flags string | enum(numeric) as multi-scalar — a numeric enum is a number, not a string", () => {
        const [hit] = findMultiScalarUnionPaths(z.object({ kind: z.union([z.string(), z.enum(NumE)]) }));
        expect(hit?.dotprop_path).toBe("kind");
        expect(hit?.scalar_kinds.slice().sort()).toEqual(["number", "string"]);
    });

    test("does NOT flag string | enum(string) — both arms are string", () => {
        expect(findMultiScalarUnionPaths(z.object({ kind: z.union([z.string(), z.enum(StrE)]) }))).toEqual([]);
    });

    test("does NOT flag a bare numeric enum — a single scalar kind", () => {
        expect(findMultiScalarUnionPaths(z.object({ kind: z.enum(NumE) }))).toEqual([]);
        expect(findShapeAmbiguousPaths(z.object({ kind: z.enum(NumE) }))).toEqual([]);
    });
});

/**
 * The load-bearing decision is that `scalar|object` (no array) is representable and must NOT be rejected. The real
 * `ContactSchema.contact.locations` is exactly that — an array whose element is `string | number | object` — and is
 * exercised by dozens of passing SQL tests. Both detectors must leave it (and an isolated copy) untouched, or the
 * rule has over-reached.
 */
describe("a representable schema stays unflagged by BOTH detectors (the widening regression guard)", () => {
    test("the real ContactSchema fixture (a string|number|object array element) is representable", () => {
        expect(findShapeAmbiguousPaths(ContactSchema)).toEqual([]);
        expect(findMultiScalarUnionPaths(ContactSchema)).toEqual([]);
    });
    test("an isolated string|number|object array element is representable (no array coexists with the object)", () => {
        const schema = z.object({
            x: z.array(z.union([z.string(), z.number(), z.object({ a: z.string() })])),
        });
        expect(findShapeAmbiguousPaths(schema)).toEqual([]);
        expect(findMultiScalarUnionPaths(schema)).toEqual([]);
    });
});
