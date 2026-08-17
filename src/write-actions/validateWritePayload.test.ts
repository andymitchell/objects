import { z } from "zod";
import { describe, it, expect } from "vitest";
import {
    validateWritePayloadSchema,
    validateWritePayloadValues,
    compileValidateWritePayload,
} from "./validateWritePayload.ts";
import { writeToItemsArray } from "./writeToItemsArray/writeToItemsArray.ts";
import type { WriteToItemsArrayResult } from "./writeToItemsArray/types.ts";
import type { WriteAction, WritePayload } from "./types.ts";
import type { DDL } from "../ddl/types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- This suite deliberately constructs malformed write payloads (non-JSON values, typed-out dot-paths) that the typed WritePayload<T>/WriteAction<T>/DDL<T> surface forbids by design; the validators and engine read them structurally at runtime. */

/** Build a write payload for tests, bypassing WritePayload<T>'s compile-time dot-path/array_scope typing (the validators read it structurally). */
const vp = (payload: unknown): WritePayload<any> => payload as WritePayload<any>;

// ═══════════════════════════════════════════════════════════════════
// validateWritePayloadSchema — construction-time schema JSON-safety
// ═══════════════════════════════════════════════════════════════════

describe("validateWritePayloadSchema — does a schema DECLARE only JSON-safe types?", () => {

    describe("accepts a provably JSON-safe single-object schema", () => {
        it("a flat object of JSON primitives has no issues", () => {
            expect(validateWritePayloadSchema(z.object({ id: z.string(), n: z.number(), ok: z.boolean(), nil: z.null() }))).toEqual([]);
        });
        it("nested objects, arrays, records, unions and optionals of JSON-safe types pass", () => {
            const schema = z.object({
                id: z.string(),
                meta: z.object({ tags: z.array(z.string()), count: z.number().optional() }),
                bag: z.record(z.string(), z.number()),
                choice: z.union([z.string(), z.number()]),
            });
            expect(validateWritePayloadSchema(schema)).toEqual([]);
        });
        it("a JSON-safe literal (string / number) is accepted", () => {
            expect(validateWritePayloadSchema(z.object({ tag: z.literal("x"), v: z.literal(1) }))).toEqual([]);
        });
        it("a self-referential z.lazy terminates rather than looping", () => {
            const node: z.ZodType = z.object({ id: z.string(), children: z.array(z.lazy(() => node)) });
            expect(validateWritePayloadSchema(z.object({ root: node }))).toEqual([]);
        });
    });

    describe("flags a non-JSON concrete type as `unsupported` / `non_json_type`, at its exact path", () => {
        it("a Date field, reported at the field path with its declared zod kind", () => {
            expect(validateWritePayloadSchema(z.object({ id: z.string(), when: z.date() }))).toEqual([
                { kind: "unsupported", reason: "non_json_type", declaredType: "date", path: "when", message: "Schema declares a non-JSON type 'date' at 'when'." },
            ]);
        });
        it("a non-JSON type nested inside an array element, reported at the [] path", () => {
            const issues = validateWritePayloadSchema(z.object({ rows: z.array(z.object({ at: z.date() })) }));
            expect(issues).toEqual([
                { kind: "unsupported", reason: "non_json_type", declaredType: "date", path: "rows[].at", message: "Schema declares a non-JSON type 'date' at 'rows[].at'." },
            ]);
        });
        it("a record whose VALUE type is non-JSON, reported at the {} path", () => {
            const issues = validateWritePayloadSchema(z.object({ bag: z.record(z.string(), z.bigint()) }));
            expect(issues).toEqual([
                { kind: "unsupported", reason: "non_json_type", declaredType: "bigint", path: "bag{}", message: "Schema declares a non-JSON type 'bigint' at 'bag{}'." },
            ]);
        });
        it("a z.nan() field — whose only value (NaN) JSON-serializes to null — is a non-JSON type", () => {
            expect(validateWritePayloadSchema(z.object({ id: z.string(), n: z.nan() }))).toEqual([
                { kind: "unsupported", reason: "non_json_type", declaredType: "nan", path: "n", message: "Schema declares a non-JSON type 'nan' at 'n'." },
            ]);
        });
    });

    describe("flags an unprovable branch as `indeterminate` / `indeterminate_branch`", () => {
        it("z.any() cannot be proven JSON-safe", () => {
            expect(validateWritePayloadSchema(z.object({ blob: z.any() }))).toEqual([
                { kind: "indeterminate", reason: "indeterminate_branch", declaredType: "any", path: "blob", message: "Schema branch 'any' at 'blob' cannot be proven JSON-safe." },
            ]);
        });
        it("a value-transforming branch (transform / codec) is indeterminate", () => {
            const issues = validateWritePayloadSchema(z.object({ s: z.string().transform((x) => x.length) }));
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({ kind: "indeterminate", reason: "indeterminate_branch" });
        });
    });

    describe("checks a literal's VALUE, not just its `literal` kind", () => {
        it("z.literal(1n) (bigint) is a non_json_literal", () => {
            expect(validateWritePayloadSchema(z.object({ tag: z.literal(1n) }))).toEqual([
                { kind: "unsupported", reason: "non_json_literal", declaredType: "literal", path: "tag", message: "Schema declares a non-JSON literal at 'tag'." },
            ]);
        });
    });

    describe("a typed non-JSON catchall is rejected, but a merely-open object is not", () => {
        it(".catchall(z.bigint()) is rejected — every undeclared extra would be a bigint", () => {
            expect(validateWritePayloadSchema(z.object({ id: z.string() }).catchall(z.bigint()))).toEqual([
                { kind: "unsupported", reason: "non_json_type", declaredType: "bigint", path: "{}", message: "Schema declares a non-JSON type 'bigint' at '{}'." },
            ]);
        });
        it(".passthrough() / .loose() / .strict() / default objects all pass (catchall is unknown/never/absent)", () => {
            expect(validateWritePayloadSchema(z.object({ id: z.string() }).passthrough())).toEqual([]);
            expect(validateWritePayloadSchema(z.looseObject({ id: z.string() }))).toEqual([]);
            expect(validateWritePayloadSchema(z.object({ id: z.string() }).strict())).toEqual([]);
            expect(validateWritePayloadSchema(z.object({ id: z.string() }))).toEqual([]);
        });
    });

    describe("flags a root that is not a single object shape as `bad_root_shape`", () => {
        it("a root union is rejected at the root (no path), naming the offending root kind", () => {
            const issues = validateWritePayloadSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]));
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({ kind: "indeterminate", reason: "bad_root_shape", declaredType: "union" });
            expect(issues[0]!.path).toBeUndefined();
            expect(issues[0]!.message).toContain("single object shape");
        });
        it("an intersection of object shapes (a grafted PK) is still a single shape and passes", () => {
            const schema = z.intersection(z.object({ id: z.string() }), z.object({ __pk__: z.string() }));
            expect(validateWritePayloadSchema(schema)).toEqual([]);
        });
        it("a non-object root (a bare array) is rejected", () => {
            const issues = validateWritePayloadSchema(z.array(z.string()));
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({ reason: "bad_root_shape", declaredType: "array" });
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// validateWritePayloadValues — per-write value JSON-safety (schema-agnostic)
// ═══════════════════════════════════════════════════════════════════

describe("validateWritePayloadValues — do a payload's WRITTEN VALUES round-trip JSON?", () => {

    describe("classifies an offending value by position and dot-path", () => {
        it("a non-finite number in create data → non_finite at the field path", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", n: Infinity } })).toEqual([{ reason: "non_finite", path: "n" }]);
        });
        it("a bigint in create data → malformed at the field path", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", big: 5n } })).toEqual([{ reason: "malformed", path: "big" }]);
        });
        it("a Symbol in create data → malformed at the field path", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", sym: Symbol("x") } })).toEqual([{ reason: "malformed", path: "sym" }]);
        });
        it("a function in update data → malformed at the field path", () => {
            expect(validateWritePayloadValues({ type: "update", data: { fn: () => 1 }, where: { id: "1" } })).toEqual([{ reason: "malformed", path: "fn" }]);
        });
        it("a function in a push item → malformed at the element index path", () => {
            expect(validateWritePayloadValues({ type: "push", path: "tags", items: [() => 1], where: { id: "1" } })).toEqual([{ reason: "malformed", path: "tags.0" }]);
        });
        it("a Date in update data → malformed at the field path", () => {
            expect(validateWritePayloadValues({ type: "update", data: { when: new Date() }, where: { id: "1" } })).toEqual([{ reason: "malformed", path: "when" }]);
        });
        it("an inc with a NaN amount → non_finite at the inc path", () => {
            expect(validateWritePayloadValues({ type: "inc", path: "count", amount: NaN, where: { id: "1" } })).toEqual([{ reason: "non_finite", path: "count" }]);
        });
        it("a non-JSON push item → malformed at the element index path", () => {
            expect(validateWritePayloadValues({ type: "push", path: "tags", items: ["ok", 2n], where: { id: "1" } })).toEqual([{ reason: "malformed", path: "tags.1" }]);
        });
        it("a non-JSON add_to_set item → malformed at the element index path", () => {
            expect(validateWritePayloadValues({ type: "add_to_set", path: "tags", items: [new Date()], unique_by: "deep_equals", where: { id: "1" } })).toEqual([{ reason: "malformed", path: "tags.0" }]);
        });
        it("a deeply nested non-finite → reported at the full dot-path", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", meta: { deep: { bad: -Infinity } } } })).toEqual([{ reason: "non_finite", path: "meta.deep.bad" }]);
        });
    });

    describe("recurses an array_scope into its nested action", () => {
        it("a non-JSON value in a nested create is reported at the nested data path", () => {
            const payload = vp({ type: "array_scope", scope: "children", action: { type: "create", data: { cid: "c1", when: new Date() } }, where: { id: "1" } });
            expect(validateWritePayloadValues(payload)).toEqual([{ reason: "malformed", path: "when" }]);
        });
    });

    describe("returns EVERY offending value, not just the first", () => {
        it("two bad values in one create → two issues", () => {
            expect(validateWritePayloadValues({ type: "create", data: { a: Infinity, b: 2n } })).toEqual([
                { reason: "non_finite", path: "a" },
                { reason: "malformed", path: "b" },
            ]);
        });
    });

    describe("is schema-agnostic — it walks values with no schema", () => {
        it("a non-finite in a plainly-numeric field is still caught (no schema to declare it away)", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", count: Infinity } })).toEqual([{ reason: "non_finite", path: "count" }]);
        });
    });

    describe("rejects an explicit undefined in the data a create or update writes", () => {
        it("a cleared field in an update is reported at its path, because JSON would drop the key entirely", () => {
            const issues = validateWritePayloadValues({ type: "update", data: { label: undefined }, where: { id: "1" } });
            expect(issues).toHaveLength(1);
            expect(issues[0]!.reason).toBe("malformed");
            expect(issues[0]!.path).toBe("label");
        });

        it("an update points the caller at the verbs that express clearing and removal", () => {
            const [issue] = validateWritePayloadValues({ type: "update", data: { label: undefined }, where: { id: "1" } });
            expect(issue!.message).toContain("set_property_undefined");
            expect(issue!.message).toContain("delete_property");
        });

        it("a create points the caller at omitting the key, since there is nothing yet to clear", () => {
            const [issue] = validateWritePayloadValues({ type: "create", data: { id: "1", label: undefined } });
            expect(issue!.path).toBe("label");
            expect(issue!.message).toContain("omit the key");
            expect(issue!.message).not.toContain("set_property_undefined");
        });

        it("the guidance says nothing about the data itself, so an error stays safe to log", () => {
            const [sparse] = validateWritePayloadValues({ type: "update", data: { label: undefined }, where: { id: "1" } });
            const [alongsideSecrets] = validateWritePayloadValues({
                type: "update",
                data: { label: undefined, api_key: "sk-live-9f3", email: "someone@example.com" },
                where: { id: "1" },
            });
            expect(alongsideSecrets!.message).toBe(sparse!.message);
            expect(alongsideSecrets!.message).not.toContain("sk-live-9f3");
            expect(alongsideSecrets!.message).not.toContain("someone@example.com");
        });

        it("is caught at any depth, including inside an array, where the type system stops looking", () => {
            expect(validateWritePayloadValues({ type: "update", data: { meta: { deep: { label: undefined } } }, where: { id: "1" } }))
                .toMatchObject([{ reason: "malformed", path: "meta.deep.label" }]);
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", rows: [{ rid: "r1", label: undefined }] } }))
                .toMatchObject([{ reason: "malformed", path: "rows.0.label" }]);
        });

        it("is caught inside an array_scope's nested create too", () => {
            const payload = vp({ type: "array_scope", scope: "children", action: { type: "create", data: { cid: "c1", label: undefined } }, where: { id: "1" } });
            expect(validateWritePayloadValues(payload)).toMatchObject([{ reason: "malformed", path: "label" }]);
        });

        it("leaves an undefined key inside a list item alone — those items are compared by deep equality, which reads an absent key the same way", () => {
            expect(validateWritePayloadValues({ type: "push", path: "rows", items: [{ rid: "r1", label: undefined }], where: { id: "1" } })).toEqual([]);
            expect(validateWritePayloadValues({ type: "add_to_set", path: "rows", items: [{ rid: "r1", label: undefined }], unique_by: "deep_equals", where: { id: "1" } })).toEqual([]);
        });
    });

    /**
     * A list position cannot be left empty. `JSON.stringify` writes an undefined element as `null`, so the list
     * arrives holding a value it never held — one the row schema may refuse on reload, and one that compares as
     * equal to an existing `null` where the undefined did not.
     */
    describe("rejects an explicit undefined element in the list a push or an add_to_set writes", () => {
        it("reports the element at its index beneath the array's own path", () => {
            const issues = validateWritePayloadValues({ type: "push", path: "tags", items: ["a", undefined], where: { id: "1" } });
            expect(issues).toHaveLength(1);
            expect(issues[0]!.reason).toBe("malformed");
            expect(issues[0]!.path).toBe("tags.1");
        });

        it("points the caller at leaving the element out, or writing the null that JSON would substitute", () => {
            const [issue] = validateWritePayloadValues({ type: "add_to_set", path: "tags", items: [undefined], unique_by: "deep_equals", where: { id: "1" } });
            expect(issue!.message).toContain("leave the element out");
            expect(issue!.message).toContain("null");
        });

        it("names every offending index, since which element to fix is the whole remedy", () => {
            const issues = validateWritePayloadValues({ type: "push", path: "tags", items: [undefined, "b", undefined], where: { id: "1" } });
            expect(issues.map((issue) => issue.path)).toEqual(["tags.0", "tags.2"]);
        });

        it("reaches an element nested inside an item, not only the outermost list", () => {
            const issues = validateWritePayloadValues({ type: "push", path: "rows", items: [{ rid: "r1", tags: ["a", undefined] }], where: { id: "1" } });
            expect(issues.map((issue) => issue.path)).toEqual(["rows.0.tags.1"]);
        });

        it("is caught inside an array_scope's nested push too, so both depths agree", () => {
            const payload = vp({ type: "array_scope", scope: "children", action: { type: "push", path: "tags", items: [undefined], where: { cid: "c1" } }, where: { id: "1" } });
            expect(validateWritePayloadValues(payload)).toMatchObject([{ reason: "malformed", path: "tags.0" }]);
        });

        it("says nothing about the data itself, so an error stays safe to log", () => {
            const [issue] = validateWritePayloadValues({ type: "push", path: "tags", items: [undefined, "sk-live-9f3"], where: { id: "1" } });
            expect(issue!.message).not.toContain("sk-live-9f3");
        });

        it("refuses the element before the substitution it would become can change an answer", () => {
            // What the refusal is worth: an undefined element becomes the null a list may already hold, and
            // add_to_set decides membership by comparing values. So the same action asked on either side of a
            // serialisation boundary gives different answers — appending an element where the list held null, and
            // finding it already present once JSON has rewritten it. (That null and undefined are distinct to
            // that comparison is pinned by the engine's own add_to_set semantics.)
            expect(JSON.parse(JSON.stringify([undefined]))).toEqual([null]);

            expect(validateWritePayloadValues({ type: "add_to_set", path: "entries", items: [undefined], unique_by: "deep_equals", where: { id: "1" } }))
                .toMatchObject([{ reason: "malformed", path: "entries.0" }]);
        });
    });

    describe("accepts JSON-safe payloads, incl. round-trip-stable edge values", () => {
        it("a clean create has no issues", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", n: 3, tags: ["a", "b"], meta: { ok: true } } })).toEqual([]);
        });
        it("-0 and null both round-trip safely", () => {
            expect(validateWritePayloadValues({ type: "create", data: { id: "1", z: -0, nil: null } })).toEqual([]);
        });
        it("delete and pull carry no written values, so never produce issues", () => {
            expect(validateWritePayloadValues({ type: "delete", where: { id: "1" } })).toEqual([]);
            expect(validateWritePayloadValues({ type: "pull", path: "tags", items_where: ["a"], where: { id: "1" } })).toEqual([]);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// compileValidateWritePayload — unified compile-once validator
// ═══════════════════════════════════════════════════════════════════

describe("compileValidateWritePayload — schema-check once at compile, value-check per payload", () => {

    it("over a JSON-safe schema, returns a validator that runs the value check", () => {
        const validate = compileValidateWritePayload(z.object({ id: z.string(), count: z.number().optional() }));
        expect(validate({ type: "create", data: { id: "1", count: 2 } })).toEqual([]);
        expect(validate({ type: "inc", path: "count", amount: NaN, where: { id: "1" } })).toEqual([{ reason: "non_finite", path: "count" }]);
    });

    it("THROWS at compile when the schema cannot round-trip JSON (fail-fast construction guard)", () => {
        expect(() => compileValidateWritePayload(z.object({ id: z.string(), at: z.date() }))).toThrow(/round-trip JSON/);
    });

    it("with { skipSchemaCheck: true }, does NOT throw on a bad schema — only the value check runs", () => {
        const validate = compileValidateWritePayload(z.object({ id: z.string(), at: z.date() }), { skipSchemaCheck: true });
        expect(validate({ type: "create", data: { id: "1" } })).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// writeToItemsArray — the up-front value gate, end to end
// ═══════════════════════════════════════════════════════════════════

// An OPEN schema: an undeclared non-JSON value is kept verbatim by Zod, so only the gate (not Zod) can reject it.
const OpenSchema = z.looseObject({ id: z.string(), count: z.number().optional(), tags: z.array(z.string()).optional() });
const openDdl: DDL<any> = { version: 1, lists: { ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } } } };

const NestedSchema = z.looseObject({ id: z.string(), children: z.array(z.looseObject({ cid: z.string() })).optional() });
const nestedDdl: DDL<{ id: string; children: { cid: string }[] }> = { version: 1, lists: { ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } }, "children": { primary_key: "cid" } } };

const wa = (uuid: string, payload: unknown): WriteAction<any> => ({ type: "write", ts: 0, uuid, payload: payload as WritePayload<any> });

/** Pull the single failed outcome from a result, narrowing it for typed assertions. */
function firstFailure<T extends Record<string, any>>(r: WriteToItemsArrayResult<T>) {
    const fail = r.actions.find((a) => !a.ok);
    if (!fail || fail.ok) throw new Error("expected a failed write outcome");
    return fail;
}

describe("writeToItemsArray — rejects a non-JSON value up-front, before any mutation", () => {

    it("an undeclared Date in a create is an unrecoverable invalid_data_value (gate, not Zod) and is never stored", () => {
        const r = writeToItemsArray<any>([wa("a1", { type: "create", data: { id: "1", when: new Date() } })], [], OpenSchema, openDdl);
        expect(r.ok).toBe(false);
        const fail = firstFailure(r);
        expect(fail.unrecoverable).toBe(true);
        const e = fail.errors[0];
        expect(e?.type).toBe("invalid_data_value");
        if (e?.type === "invalid_data_value") {
            expect(e.reason).toBe("malformed");
            expect(e.data_path).toBe("when");
        }
        expect(r.changes.final_items).toEqual([]); // nothing committed
    });

    it("an undeclared bigint in a create → invalid_data_value / malformed", () => {
        const r = writeToItemsArray<any>([wa("a1", { type: "create", data: { id: "1", big: 9n } })], [], OpenSchema, openDdl);
        const e = firstFailure(r).errors[0];
        expect(e?.type).toBe("invalid_data_value");
        if (e?.type === "invalid_data_value") expect(e.reason).toBe("malformed");
    });

    it("an undeclared Infinity in a create → invalid_data_value / non_finite", () => {
        const r = writeToItemsArray<any>([wa("a1", { type: "create", data: { id: "1", ratio: Infinity } })], [], OpenSchema, openDdl);
        const e = firstFailure(r).errors[0];
        expect(e?.type).toBe("invalid_data_value");
        if (e?.type === "invalid_data_value") expect(e.reason).toBe("non_finite");
    });

    it("an inc with NaN is reclassified from a recoverable 'custom' to an unrecoverable invalid_data_value", () => {
        const r = writeToItemsArray<any>([wa("a1", { type: "inc", path: "count", amount: NaN, where: { id: "1" } })], [{ id: "1", count: 1 }], OpenSchema, openDdl);
        const fail = firstFailure(r);
        expect(fail.unrecoverable).toBe(true);
        const e = fail.errors[0];
        expect(e?.type).toBe("invalid_data_value");
        if (e?.type === "invalid_data_value") expect(e.reason).toBe("non_finite");
        expect(r.changes.final_items[0]!.count).toBe(1); // unchanged
    });

    it("an array_scope's nested non-JSON value is caught on the outer action", () => {
        const r = writeToItemsArray<any>([wa("a1", { type: "array_scope", scope: "children", action: { type: "create", data: { cid: "c2", when: new Date() } }, where: { id: "1" } })], [{ id: "1", children: [] }], NestedSchema, nestedDdl);
        const e = firstFailure(r).errors[0];
        expect(e?.type).toBe("invalid_data_value");
        if (e?.type === "invalid_data_value") expect(e.reason).toBe("malformed");
    });

    it("under atomic, a good action plus a bad-value action rolls everything back", () => {
        const r = writeToItemsArray<any>([
            wa("a1", { type: "push", path: "tags", items: ["b"], where: { id: "1" } }),
            wa("a2", { type: "inc", path: "count", amount: NaN, where: { id: "1" } }),
        ], [{ id: "1", count: 5, tags: ["a"] }], OpenSchema, openDdl, { atomic: true });
        expect(r.ok).toBe(false);
        expect(r.changes.final_items[0]!.tags).toEqual(["a"]); // push rolled back
        expect(r.changes.final_items[0]!.count).toBe(5);
    });

    it("does not false-positive: a fully JSON-safe write still succeeds", () => {
        const r = writeToItemsArray<any>([wa("a1", { type: "create", data: { id: "1", count: 5 } })], [], OpenSchema, openDdl);
        expect(r.ok).toBe(true);
        expect(r.changes.final_items).toHaveLength(1);
    });
});
