import { describe, it, expect } from "vitest";
import { z } from "zod";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { getWriteFailures } from "../helpers.ts";
import { WriteErrorSchema } from "../write-action-schemas.ts";
import type { DDL } from "../../ddl/types.ts";
import type { WriteAction } from "../types.ts";

// A property verb's `path` is attacker-suppliable payload data naming the write TARGET. Whatever it holds — an
// inherited name reachable through a plain object's prototype chain, a typo, or a declared field the schema
// will not let go undefined or absent — the engine must reject the action as a value
// (`invalid_property_path`), never throw, and mutate nothing.
const RowSchema = z.object({
    id: z.string(),
    label: z.string().optional(),
    required: z.string(),
    bag: z.record(z.string(), z.string()),
    children: z.array(z.object({ cid: z.string(), note: z.string().optional() }).strict()).optional(),
}).strict();
type Row = z.infer<typeof RowSchema>;

const ddl: DDL<Row> = {
    version: 1,
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        "children": { primary_key: "cid" },
    },
};

const seed = (): Row[] => [{ id: "1", required: "r", bag: { k: "v" }, children: [{ cid: "c1", note: "n" }] }];

/** Build a property-verb action; payload cast since a deliberately-unwritable path is not type-valid. */
const wa = (payload: unknown, uuid = "u"): WriteAction<Row> => ({ type: "write", ts: 0, uuid, payload: payload as WriteAction<Row>["payload"] });

describe("writeToItemsArray — unwritable property path (errors as values)", () => {

    const unwritable: Array<[verb: string, path: string, reason: string]> = [
        ["delete_property", "nope", "unknown_path"],
        ["delete_property", "required", "not_optional"],
        ["delete_property", "children", "object_array_property"],
        ["delete_property", "children.cid", "traverses_array"],
        ["delete_property", "constructor", "disallowed_segment"],
        ["delete_property", "bag.", "disallowed_segment"],
        ["set_property_undefined", "required", "not_undefinable"],
        ["set_property_undefined", "bag.k", "not_undefinable"],
    ];

    it.each(unwritable)("rejects %s of %j as invalid_property_path (%s) without throwing, mutating nothing", (type, path, reason) => {
        const action = wa({ type, path, where: { id: "1" } });
        expect(() => writeToItemsArray([action], seed(), RowSchema, ddl)).not.toThrow();

        const result = writeToItemsArray([action], seed(), RowSchema, ddl);
        expect(result.ok).toBe(false);
        const failure = getWriteFailures(result)[0]!;
        expect(failure.errors[0]).toMatchObject({ type: "invalid_property_path", path, reason });
        expect(failure.unrecoverable).toBe(true);
        expect(result.changes.final_items).toEqual(seed());
    });

    it("rejects an unwritable path even when the where matches no items — the fault is static, not per-item", () => {
        const action = wa({ type: "delete_property", path: "required", where: { id: "no-such-row" } });
        const result = writeToItemsArray([action], seed(), RowSchema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_property_path", path: "required", reason: "not_optional" });
    });

    it("rejects an unwritable path even against an EMPTY collection", () => {
        const action = wa({ type: "delete_property", path: "required", where: {} });
        const result = writeToItemsArray([action], [], RowSchema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_property_path", path: "required" });
    });

    it("judges a nested path against the element schema, reporting the full scope-chain path", () => {
        const action = wa({
            type: "array_scope", scope: "children", where: { id: "1" },
            action: { type: "delete_property", path: "cid", where: { cid: "c1" } },
        });
        const result = writeToItemsArray([action], seed(), RowSchema, ddl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_property_path", path: "children.cid", reason: "not_optional" });
        expect(result.changes.final_items).toEqual(seed());
    });

    it("blocks a following action when a path is unwritable, like any unrecoverable failure", () => {
        const actions = [
            wa({ type: "delete_property", path: "required", where: { id: "1" } }, "a1"),
            wa({ type: "create", data: { id: "2", required: "r", bag: {} } }, "a2"),
        ];
        const result = writeToItemsArray(actions, seed(), RowSchema, ddl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result).find((f) => f.action_uuid === "a2")?.blocked_by_action_uuid).toBe("a1");
    });

    it("rolls back the whole atomic batch when one action's path is unwritable", () => {
        const actions = [
            wa({ type: "create", data: { id: "2", required: "r", bag: {} } }, "a"),
            wa({ type: "delete_property", path: "required", where: { id: "1" } }, "b"),
        ];
        const result = writeToItemsArray(actions, seed(), RowSchema, ddl, { atomic: true });
        expect(result.ok).toBe(false);
        expect(result.changes.final_items.map((r) => r.id)).toEqual(["1"]); // created '2' rolled back
    });

    it("round-trips an invalid_property_path error through WriteErrorSchema", () => {
        expect(WriteErrorSchema.safeParse({ type: "invalid_property_path", path: "required", reason: "not_optional" }).success).toBe(true);
        expect(WriteErrorSchema.safeParse({ type: "invalid_property_path", path: "x", reason: "nope" }).success).toBe(false); // bad reason
        expect(WriteErrorSchema.safeParse({ type: "invalid_property_path", reason: "unknown_path" }).success).toBe(false); // path required
    });
});
