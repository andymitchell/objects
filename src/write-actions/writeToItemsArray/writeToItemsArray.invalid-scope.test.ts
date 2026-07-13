import { describe, it, expect } from "vitest";
import { z } from "zod";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { getWriteFailures } from "../helpers.ts";
import { WriteErrorSchema } from "../write-action-schemas.ts";
import type { DDL } from "../../ddl/types.ts";
import type { WriteAction } from "../types.ts";

// A scope is attacker-suppliable payload data. Whatever it holds — an inherited name reachable through a
// plain object's prototype chain, a typo, or a declared field that just isn't an array of objects — the
// engine must reject the action as a value (`invalid_scope`), never throw, and mutate nothing.
const NestedSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    profile: z.object({ n: z.string() }).strict().optional(),
    children: z.array(z.object({
        cid: z.string(),
        label: z.string().optional(),
        items: z.array(z.object({ iid: z.string(), value: z.number().optional() }).strict()),
    }).strict()).optional(),
}).strict();
type Nested = z.infer<typeof NestedSchema>;
const nestedDdl: DDL<Nested> = {
    version: 1,
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        "children": { primary_key: "cid" },
        "children.items": { primary_key: "iid" },
    },
};
const seedNested = (): Nested[] => [{ id: "1", profile: { n: "p" }, children: [{ cid: "c1", items: [{ iid: "i1", value: 0 }] }] }];
/** Build an array_scope action; payload cast since a deliberately-bad scope is not type-valid. */
const scoped = (payload: unknown, uuid = "u"): WriteAction<Nested> => ({ type: "write", ts: 0, uuid, payload: payload as WriteAction<Nested>["payload"] });
const scopedUpdate = (scope: string, uuid = "u") =>
    scoped({ type: "array_scope", scope, where: { id: "1" }, action: { type: "update", data: { label: "x" }, where: { cid: "c1" } } }, uuid);

describe("writeToItemsArray — unwritable array_scope scope (errors as values)", () => {

    const badScopes: Array<[scope: string, reason: string]> = [
        ["constructor", "disallowed_segment"],
        ["children.constructor", "disallowed_segment"],
        ["toString", "unknown_path"],
        ["nonexistent", "unknown_path"],
        ["id", "not_an_object_array"],
        ["profile", "not_an_object_array"],
    ];

    it.each(badScopes)("rejects scope %j as invalid_scope (%s) without throwing, mutating nothing", (scope, reason) => {
        const items = seedNested();
        expect(() => writeToItemsArray([scopedUpdate(scope)], items, NestedSchema, nestedDdl)).not.toThrow();

        const result = writeToItemsArray([scopedUpdate(scope)], seedNested(), NestedSchema, nestedDdl);
        expect(result.ok).toBe(false);
        const failure = getWriteFailures(result)[0]!;
        expect(failure.errors[0]).toMatchObject({ type: "invalid_scope", scope, reason });
        expect(failure.unrecoverable).toBe(true);
        expect(result.changes.final_items).toEqual(seedNested());
    });

    it.each([["constructor"], ["id"]])("rejects scope %j identically under { atomic: true }", (scope) => {
        const result = writeToItemsArray([scopedUpdate(scope)], seedNested(), NestedSchema, nestedDdl, { atomic: true });
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_scope", scope });
        expect(result.changes.final_items).toEqual(seedNested());
    });

    it("rolls back the whole atomic batch when one action's scope is unwritable", () => {
        const actions = [
            scoped({ type: "create", data: { id: "2" } }, "a"),
            scopedUpdate("nonexistent", "b"),
        ];
        const result = writeToItemsArray(actions, seedNested(), NestedSchema, nestedDdl, { atomic: true });
        expect(result.ok).toBe(false);
        expect(result.changes.final_items.map((r) => r.id)).toEqual(["1"]); // created '2' rolled back
    });

    it("blocks a following action when a scope is unwritable, like any unrecoverable failure", () => {
        const actions = [
            scopedUpdate("constructor", "a1"),
            scoped({ type: "create", data: { id: "2" } }, "a2"),
        ];
        const result = writeToItemsArray(actions, seedNested(), NestedSchema, nestedDdl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result).find((f) => f.action_uuid === "a2")?.blocked_by_action_uuid).toBe("a1");
    });

    it("rejects a bad scope NESTED under a valid one up-front, with the full scope-chain path and zero mutation", () => {
        // The rejection must come from the static preflight — before the per-item pass — so no item is
        // touched even in non-atomic mode, where a partial mutation would otherwise stand.
        const action = scoped({
            type: "array_scope", scope: "children", where: { id: "1" },
            action: { type: "array_scope", scope: "nonexistent", where: { cid: "c1" }, action: { type: "update", data: { value: 1 }, where: { iid: "i1" } } },
        });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);

        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_scope", scope: "children.nonexistent", reason: "unknown_path" });
        expect(result.changes.final_items).toEqual(seedNested());
    });

    it("rejects a bad nested scope even when the OUTER where matches no items (caught statically)", () => {
        const action = scoped({
            type: "array_scope", scope: "children", where: { id: "no-such-row" },
            action: { type: "array_scope", scope: "nonexistent", where: { cid: "c1" }, action: { type: "update", data: { value: 1 }, where: { iid: "i1" } } },
        });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);
        expect(result.ok).toBe(false);
        expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: "invalid_scope", scope: "children.nonexistent" });
    });

    it("round-trips an invalid_scope error through WriteErrorSchema", () => {
        expect(WriteErrorSchema.safeParse({ type: "invalid_scope", scope: "constructor", reason: "disallowed_segment" }).success).toBe(true);
        expect(WriteErrorSchema.safeParse({ type: "invalid_scope", scope: "x", reason: "nope" }).success).toBe(false); // bad reason
        expect(WriteErrorSchema.safeParse({ type: "invalid_scope", reason: "unknown_path" }).success).toBe(false); // scope required
    });
});

describe("writeToItemsArray — a valid scope over an item whose optional array is absent", () => {

    it("treats the absent array exactly like a present-but-empty one: zero targets, no throw", () => {
        const action = scopedUpdate("children");

        expect(() => writeToItemsArray([action], [{ id: "1" }], NestedSchema, nestedDdl)).not.toThrow();
        const absent = writeToItemsArray([action], [{ id: "1" }], NestedSchema, nestedDdl);
        const empty = writeToItemsArray([action], [{ id: "1", children: [] }], NestedSchema, nestedDdl);

        expect(absent.ok).toBe(true);
        expect(absent.ok).toBe(empty.ok);
        expect(absent.changes.changed).toBe(empty.changes.changed);
        expect(absent.changes.final_items).toEqual([{ id: "1" }]); // the field is not conjured into existence
        expect(empty.changes.final_items).toEqual([{ id: "1", children: [] }]);
    });
});

describe("writeToItemsArray — valid scopes still write end-to-end", () => {

    it("writes through a top-level scope", () => {
        const result = writeToItemsArray([scopedUpdate("children")], seedNested(), NestedSchema, nestedDdl);
        expect(result.ok).toBe(true);
        expect(result.changes.final_items[0]!.children![0]!.label).toBe("x");
    });

    it("writes through a nested scope", () => {
        const action = scoped({ type: "array_scope", scope: "children.items", where: { id: "1" }, action: { type: "update", data: { value: 9 }, where: { iid: "i1" } } });
        const result = writeToItemsArray([action], seedNested(), NestedSchema, nestedDdl);
        expect(result.ok).toBe(true);
        expect(result.changes.final_items[0]!.children![0]!.items[0]!.value).toBe(9);
    });

    it("writes through a DECLARED field named after an inherited member (own-property, not a denylist)", () => {
        const ToStringSchema = z.object({
            id: z.string(),
            toString: z.array(z.object({ tid: z.string(), mark: z.string().optional() }).strict()).optional(),
        }).strict();
        type Row = z.infer<typeof ToStringSchema>;
        const ddl: DDL<Row> = {
            version: 1,
            lists: {
                ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
                "toString": { primary_key: "tid" },
            },
        };
        const action = ({ type: "write", ts: 0, uuid: "u", payload: { type: "array_scope", scope: "toString", where: { id: "1" }, action: { type: "update", data: { mark: "m" }, where: { tid: "t1" } } } }) as unknown as WriteAction<Row>;
        const items: Row[] = [{ id: "1", toString: [{ tid: "t1" }] }];

        const result = writeToItemsArray([action], items, ToStringSchema, ddl);
        expect(result.ok).toBe(true);
        expect(result.changes.final_items[0]!.toString![0]!.mark).toBe("m");
    });
});
