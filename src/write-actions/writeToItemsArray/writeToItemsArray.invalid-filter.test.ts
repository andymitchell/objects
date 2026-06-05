import { describe, it, expect } from "vitest";
import { z } from "zod";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { getWriteFailures } from "../helpers.ts";
import { WriteErrorSchema } from "../write-action-schemas.ts";
import type { DDL } from "../../ddl/types.ts";
import type { WriteAction } from "../types.ts";
import type { WhereFilterDefinition } from "../../where-filter/types.ts";

// `.strict()`: unknown_field is flagged only under strict objects (the only mode the engine enforces
// no-extra-keys on writes), so the unknown-field cases below require a strict schema.
const Schema = z.object({
    id: z.string(),
    text: z.string().optional(),
    age: z.number().optional(),
}).strict();
type Row = z.infer<typeof Schema>;

const ddl: DDL<Row> = {
    version: 1,
    ownership: { type: "none" },
    lists: { ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } } },
};

const seed = (): Row[] => [{ id: "1", text: "a" }];

/** Cast an arbitrary (often deliberately-invalid) where to the filter type for runtime testing. */
const where = (w: unknown) => w as WhereFilterDefinition<Row>;
const update = (w: unknown, uuid = "u"): WriteAction<Row> => ({ type: "write", ts: 0, uuid, payload: { type: "update", data: { text: "z" }, where: where(w) } });
const del = (w: unknown, uuid = "u"): WriteAction<Row> => ({ type: "write", ts: 0, uuid, payload: { type: "delete", where: where(w) } });
const create = (data: Row, uuid = "u"): WriteAction<Row> => ({ type: "write", ts: 0, uuid, payload: { type: "create", data } });

describe("writeToItemsArray — invalid where clause", () => {
    it("rejects an update whose where references an unknown field, mutating nothing", () => {
        const items = seed();
        const result = writeToItemsArray([update({ ghost: 1 })], items, Schema, ddl);

        expect(result.ok).toBe(false);
        const failure = getWriteFailures(result)[0]!;
        expect(failure.errors[0]).toMatchObject({ type: "invalid_filter", reason: "unknown_field", where_path: "ghost" });
        expect(failure.unrecoverable).toBe(true);
        expect(result.changes.final_items).toEqual([{ id: "1", text: "a" }]); // unchanged
    });

    it("rejects a delete with an unknown-field where, leaving the row in place", () => {
        const result = writeToItemsArray([del({ ghost: 1 })], seed(), Schema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "unknown_field" });
        expect(result.changes.final_items).toEqual([{ id: "1", text: "a" }]);
    });

    it("rejects a type-contradicting where as invalid_filter", () => {
        const result = writeToItemsArray([update({ age: "old" })], seed(), Schema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "type_mismatch", where_path: "age" });
    });

    it("rejects a malformed (null) where as invalid_filter instead of throwing at match time", () => {
        const result = writeToItemsArray([update(null)], seed(), Schema, ddl);
        expect(result.ok).toBe(false);
        const error = getWriteFailures(result)[0]!.errors[0]!;
        expect(error).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(error.type === "invalid_filter" && error.where_path).toBeUndefined(); // malformed has no field path
        expect(result.changes.final_items).toEqual([{ id: "1", text: "a" }]); // unchanged
    });

    it("returns invalid_filter (does NOT throw) when a where operand makes the matcher throw at match time", () => {
        // An un-compilable $regex and an undefined range operand pass structural validation but throw inside
        // matchJavascriptObject; preflightActionWhere dry-runs the match up-front and reports a clean invalid_filter.
        expect(() => writeToItemsArray([update({ id: { $regex: "[" } })], seed(), Schema, ddl)).not.toThrow();

        const regexResult = writeToItemsArray([update({ id: { $regex: "[" } })], seed(), Schema, ddl);
        expect(regexResult.ok).toBe(false);
        expect(getWriteFailures(regexResult)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(regexResult.changes.final_items).toEqual([{ id: "1", text: "a" }]); // unchanged

        // age must be present on the row for the range comparison to reach (and throw on) the bad operand.
        const rangeResult = writeToItemsArray([update({ age: { $gt: undefined } })], [{ id: "1", text: "a", age: 5 }], Schema, ddl);
        expect(rangeResult.ok).toBe(false);
        expect(getWriteFailures(rangeResult)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
    });

    it("an invalid (throwing) filter mutates nothing, even when an earlier item would have matched", () => {
        // $or matches item '1' via the id arm; the regex arm then throws on item '2'. The up-front preflight
        // dry-runs the match and rejects the action before any mutation, so item '1' is left untouched.
        const items = [{ id: "1", text: "a" }, { id: "2", text: "b" }];
        const result = writeToItemsArray([update({ $or: [{ id: "1" }, { text: { $regex: "[" } }] })], items, Schema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(result.changes.update).toHaveLength(0);
        expect(result.changes.final_items).toEqual([{ id: "1", text: "a" }, { id: "2", text: "b" }]); // no partial mutation
    });

    it("flags a malformed where on an EMPTY list (caught statically, no row needed)", () => {
        const result = writeToItemsArray([update({ id: { $regex: "[" } })], [], Schema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
    });

    it("applies an update with a valid where", () => {
        const result = writeToItemsArray([update({ id: "1" })], seed(), Schema, ddl);
        expect(result.ok).toBe(true);
        expect(result.changes.final_items).toEqual([{ id: "1", text: "z" }]);
    });

    it("does not validate creates (they carry no where)", () => {
        const result = writeToItemsArray([create({ id: "2", text: "b" })], seed(), Schema, ddl);
        expect(result.ok).toBe(true);
        expect(result.changes.final_items.map((r) => r.id)).toEqual(["1", "2"]);
    });

    it("rolls back the whole atomic batch when one action's where is invalid", () => {
        const items = seed();
        const result = writeToItemsArray(
            [create({ id: "2", text: "b" }, "a"), update({ ghost: 1 }, "b")],
            items,
            Schema,
            ddl,
            undefined,
            { atomic: true },
        );
        expect(result.ok).toBe(false);
        expect(result.changes.final_items).toEqual([{ id: "1", text: "a" }]); // create '2' rolled back
    });

    it("round-trips an invalid_filter error through WriteErrorSchema", () => {
        expect(WriteErrorSchema.safeParse({ type: "invalid_filter", where_path: "ghost", reason: "unknown_field" }).success).toBe(true);
        expect(WriteErrorSchema.safeParse({ type: "invalid_filter", reason: "malformed" }).success).toBe(true); // where_path optional
        expect(WriteErrorSchema.safeParse({ type: "invalid_filter", reason: "nope" }).success).toBe(false); // bad reason
    });
});

// ── Nested object-array schema (mirrors standardTests' NestedSchema) for array_scope cases ──
const NestedSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    children: z.array(z.object({
        cid: z.string(),
        label: z.string().optional(),
        items: z.array(z.object({ iid: z.string(), value: z.number().optional() }).strict()),
    }).strict()).optional(),
}).strict();
type Nested = z.infer<typeof NestedSchema>;
const nestedDdl: DDL<Nested> = {
    version: 1,
    ownership: { type: "none" },
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        "children": { primary_key: "cid" },
        "children.items": { primary_key: "iid" },
    },
};
/** Build a (often deliberately-invalid) array_scope action; payload cast since the bad nested where is not type-valid. */
const nestedAction = (payload: unknown, uuid = "u"): WriteAction<Nested> => ({ type: "write", ts: 0, uuid, payload: payload as WriteAction<Nested>["payload"] });

describe("writeToItemsArray — invalid where nested in array_scope", () => {
    const seedNested = (): Nested[] => [{ id: "1", children: [{ cid: "c1", items: [{ iid: "i1", value: 0 }] }] }];

    it("rejects an array_scope whose nested action.where references an unknown field, scoping the path", () => {
        const items = seedNested();
        const action = nestedAction({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: { ghost: 1 } } });
        const result = writeToItemsArray([action], items, NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "unknown_field", where_path: "children.ghost" });
        expect(result.changes.final_items).toEqual(seedNested()); // nothing mutated
    });

    it("rejects a nested invalid where even when the OUTER where matches no parent items", () => {
        // The per-item recursion never runs here, so only the up-front validator can catch it.
        const action = nestedAction({ type: "array_scope", scope: "children", where: { id: "nonexistent" }, action: { type: "update", data: { label: "x" }, where: { ghost: 1 } } });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", where_path: "children.ghost" });
    });

    it("rejects a nested invalid where even when the scoped array is empty", () => {
        const action = nestedAction({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: { ghost: 1 } } });
        const result = writeToItemsArray([action], [{ id: "1", children: [] }], NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", where_path: "children.ghost" });
    });

    it("rejects an invalid where at the innermost level of nested array_scopes, with the full scope-chain path", () => {
        const action = nestedAction({
            type: "array_scope", scope: "children", where: { id: "1" },
            action: { type: "array_scope", scope: "items", where: { cid: "c1" }, action: { type: "update", data: { value: 1 }, where: { ghost: 1 } } },
        });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", where_path: "children.items.ghost" });
    });

    it("rejects a nested array_scope whose action.where is malformed (null)", () => {
        const action = nestedAction({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: null } });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(result.changes.final_items).toEqual(seedNested()); // nothing mutated
    });

    it("propagates a nested array_scope runtime-throwing where (invalid $regex) as invalid_filter, not a silent ok", () => {
        // The nested where compiles a bad regex against a present label, so it throws at match time. The scoped
        // recursion catches it as an itemless invalid_filter; the parent must surface it rather than report ok:true.
        const items: Nested[] = [{ id: "1", children: [{ cid: "c1", label: "foo", items: [] }] }];
        const action = nestedAction({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: { label: { $regex: "[" } } } });
        const result = writeToItemsArray([action], items, NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(result.changes.final_items).toEqual(items); // nothing mutated
    });

    it("flags a malformed nested array_scope where even when the OUTER where matches no rows (caught statically)", () => {
        const action = nestedAction({ type: "array_scope", scope: "children", where: { id: "nonexistent" }, action: { type: "update", data: { label: "x" }, where: { label: { $regex: "[" } } } });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
    });

    it("applies a deep array_scope when every where is valid", () => {
        const action = nestedAction({ type: "array_scope", scope: "children.items", where: { id: "1" }, action: { type: "update", data: { value: 9 }, where: { iid: "i1" } } });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(true);
        expect(result.changes.final_items[0]!.children![0]!.items[0]!.value).toBe(9);
    });

    it("rolls back the whole atomic batch when a nested array_scope where is invalid", () => {
        const actions = [
            { type: "write", ts: 0, uuid: "a", payload: { type: "create", data: { id: "2" } } } as WriteAction<Nested>,
            nestedAction({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: { ghost: 1 } } }, "b"),
        ];
        const result = writeToItemsArray(actions, seedNested(), NestedSchema, nestedDdl, undefined, { atomic: true });

        expect(result.ok).toBe(false);
        expect(result.changes.final_items.map((r) => r.id)).toEqual(["1"]); // created '2' rolled back
    });

    it("blocks a following action when a nested array_scope where is invalid", () => {
        const actions = [
            nestedAction({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: { ghost: 1 } } }, "a1"),
            { type: "write", ts: 0, uuid: "a2", payload: { type: "create", data: { id: "2" } } } as WriteAction<Nested>,
        ];
        const result = writeToItemsArray(actions, seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result).find((f) => f.action.uuid === "a2")?.blocked_by_action_uuid).toBe("a1");
    });
});

// ── Object/scalar array schema (mirrors standardTests' FlatWithSubItems) for pull.items_where cases ──
const SubSchema = z.object({
    id: z.string(),
    tags: z.array(z.string()).optional(),
    sub_items: z.array(z.object({ sid: z.string(), val: z.number().optional() }).strict()).optional(),
}).strict();
type Sub = z.infer<typeof SubSchema>;
const subDdl: DDL<Sub> = {
    version: 1,
    ownership: { type: "none" },
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        "sub_items": { primary_key: "sid" },
    },
};
const pullAction = (payload: unknown, uuid = "u"): WriteAction<Sub> => ({ type: "write", ts: 0, uuid, payload: payload as WriteAction<Sub>["payload"] });

describe("writeToItemsArray — invalid pull.items_where", () => {
    it("rejects an object items_where referencing an unknown field, scoping the path to the array", () => {
        const items: Sub[] = [{ id: "1", sub_items: [{ sid: "s1", val: 1 }] }];
        const result = writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { ghost: 1 }, where: { id: "1" } })], items, SubSchema, subDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "unknown_field", where_path: "sub_items.ghost" });
        expect(result.changes.final_items[0]!.sub_items).toEqual([{ sid: "s1", val: 1 }]); // unchanged
    });

    it("rejects an object items_where that contradicts a field's type", () => {
        const items: Sub[] = [{ id: "1", sub_items: [{ sid: "s1", val: 1 }] }];
        const result = writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { val: "x" }, where: { id: "1" } })], items, SubSchema, subDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "type_mismatch", where_path: "sub_items.val" });
    });

    it("rejects an object items_where that is malformed (a structurally-invalid logic arm)", () => {
        const items: Sub[] = [{ id: "1", sub_items: [{ sid: "s1", val: 1 }] }];
        const result = writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { $or: [null] }, where: { id: "1" } })], items, SubSchema, subDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(result.changes.final_items[0]!.sub_items).toEqual([{ sid: "s1", val: 1 }]); // unchanged
    });

    it("returns invalid_filter (does NOT throw) when an items_where operand makes the matcher throw at match time", () => {
        const items: Sub[] = [{ id: "1", sub_items: [{ sid: "s1", val: 1 }] }];
        expect(() => writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { sid: { $regex: "[" } }, where: { id: "1" } })], items, SubSchema, subDdl)).not.toThrow();

        const result = writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { val: { $gt: undefined } }, where: { id: "1" } })], items, SubSchema, subDdl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
        expect(result.changes.final_items[0]!.sub_items).toEqual([{ sid: "s1", val: 1 }]); // unchanged
    });

    it("flags a malformed items_where even when the parent where matches NO rows (caught statically)", () => {
        const items: Sub[] = [{ id: "1", sub_items: [{ sid: "s1", val: 1 }] }];
        const result = writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { sid: { $regex: "[" } }, where: { id: "nonexistent" } })], items, SubSchema, subDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_filter", reason: "malformed" });
    });

    it("applies a valid object items_where, removing matching elements", () => {
        const items: Sub[] = [{ id: "1", sub_items: [{ sid: "s1", val: 1 }, { sid: "s2", val: 2 }] }];
        const result = writeToItemsArray([pullAction({ type: "pull", path: "sub_items", items_where: { val: 1 }, where: { id: "1" } })], items, SubSchema, subDdl);

        expect(result.ok).toBe(true);
        expect(result.changes.final_items[0]!.sub_items).toEqual([{ sid: "s2", val: 2 }]);
    });

    it("does not treat a scalar-array value-list items_where as a where (no false reject)", () => {
        const items: Sub[] = [{ id: "1", tags: ["a", "b"] }];
        const result = writeToItemsArray([pullAction({ type: "pull", path: "tags", items_where: ["a"], where: { id: "1" } })], items, SubSchema, subDdl);

        expect(result.ok).toBe(true);
        expect(result.changes.final_items[0]!.tags).toEqual(["b"]);
    });
});
