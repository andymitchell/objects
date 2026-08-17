import { z } from "zod";
import { describe, it, expect } from "vitest";
import { writeToItemsArray } from "./writeToItemsArray/writeToItemsArray.ts";
import type { WriteAction } from "./types.ts";
import { isDraft, produce } from "immer";
import { type EngineRow, idKeyedDdl, storedBy } from "./write-action-schemas.harness.ts";

/**
 * A stored item is never the caller's action.
 *
 * An action is a document the caller keeps: it may be retried, logged, compared against the outcome, or replayed
 * from a queue, and it has to still say what it said when it was written. Items, by contrast, are edited in
 * place as later writes land on them. Letting a stored item hold values from the action would join the two, so a
 * write applied afterwards would silently rewrite the record of a write already made.
 */
describe("a stored item never aliases the action that wrote it", () => {

    const AliasRowSchema = z.object({
        id: z.string(),
        meta: z.object({ tag: z.string() }).optional(),
        tags: z.array(z.string()).optional(),
    });

    /** A row whose list holds objects, so an appended element has an interior of its own to be copied. */
    const ObjectListRowSchema = z.object({
        id: z.string(),
        rows: z.array(z.object({ rid: z.string() })).optional(),
    });

    it("leaves an earlier create action untouched when a later write in the same batch changes the item", () => {
        const written = { id: "a", meta: { tag: "as written" } };
        const batch: WriteAction<EngineRow>[] = [
            { type: "write", ts: 1, uuid: "u1", payload: { type: "create", data: written } },
            { type: "write", ts: 2, uuid: "u2", payload: { type: "update", data: { meta: { tag: "changed later" } }, where: { id: "a" } } },
        ];

        const result = writeToItemsArray<EngineRow>(batch, [], AliasRowSchema, idKeyedDdl, { mutate: true });

        expect(result.ok).toBe(true);
        expect(written).toStrictEqual({ id: "a", meta: { tag: "as written" } });
    });

    it("stores a copy of a create's data rather than the data itself", () => {
        const data = { id: "a", meta: { tag: "t" } };
        const stored = storedBy(AliasRowSchema, { type: "create", data });
        expect(stored[0]).toStrictEqual(data); // the same value …
        expect(stored[0]).not.toBe(data); // … held separately
        expect(stored[0]?.meta).not.toBe(data.meta);
    });

    it("stores a copy of an array an update installs", () => {
        const data = { tags: ["x"] };
        const stored = storedBy(AliasRowSchema, { type: "update", data, where: { id: "a" } }, [{ id: "a" }]);
        expect(stored[0]?.tags).toStrictEqual(["x"]);
        expect(stored[0]?.tags).not.toBe(data.tags);
    });

    it("stores a copy of every value an assigning update installs", () => {
        const data = { meta: { tag: "new" } };
        const stored = storedBy(AliasRowSchema, { type: "update", data, where: { id: "a" }, method: "assign" }, [{ id: "a", meta: { tag: "old" } }]);
        expect(stored[0]?.meta).toStrictEqual({ tag: "new" });
        expect(stored[0]?.meta).not.toBe(data.meta);
    });

    /**
     * Callers compose objects behind proxies — an Immer draft inside a producer, a reactive object from a UI
     * framework — and a proxy over plain data is plain data: it round-trips JSON unchanged, so the gate accepts
     * it. Taking the copy is the engine's own step, and it cannot be the thing that refuses a write the gate
     * already allowed.
     */
    describe("even when the caller composed that action behind a proxy", () => {

        it("stores data written through a plain proxy, detached from what the proxy stood for", () => {
            const behind = { id: "a", meta: { tag: "t" } };

            const stored = storedBy(AliasRowSchema, { type: "create", data: new Proxy(behind, {}) });

            expect(stored[0]).toStrictEqual({ id: "a", meta: { tag: "t" } });
            behind.meta.tag = "changed after the write";
            expect(stored[0]?.meta?.tag).toBe("t");
        });

        it("stores data written from inside a draft, which cannot be handed on once the draft is done", () => {
            let stored: EngineRow[] = [];
            produce({ id: "a", meta: { tag: "t" } }, (draft) => {
                stored = storedBy(AliasRowSchema, { type: "create", data: draft });
            });

            expect(stored[0]).toStrictEqual({ id: "a", meta: { tag: "t" } });
            expect(isDraft(stored[0])).toBe(false);
        });

        it("stores an update's values written through a proxy", () => {
            const behind = { meta: { tag: "new" } };

            const stored = storedBy(AliasRowSchema, { type: "update", data: new Proxy(behind, {}), where: { id: "a" } }, [{ id: "a", meta: { tag: "old" } }]);

            expect(stored[0]?.meta).toStrictEqual({ tag: "new" });
            expect(stored[0]?.meta).not.toBe(behind.meta);
        });

        it("appends elements composed inside a draft, which the draft cannot be asked for once it is done", () => {
            let stored: EngineRow[] = [];
            produce({ id: "a", tags: ["kept"] }, (draft) => {
                stored = storedBy(AliasRowSchema, { type: "push", path: "tags", items: draft.tags, where: { id: "a" } }, [{ id: "a", tags: [] }]);
            });

            expect(stored[0]?.tags).toStrictEqual(["kept"]);
            expect(isDraft(stored[0]?.tags)).toBe(false);
        });

        it("adds elements composed inside a draft, deciding what is already there before taking the copy", () => {
            let stored: EngineRow[] = [];
            produce({ id: "a", rows: [{ rid: "r1" }, { rid: "r2" }] }, (draft) => {
                stored = storedBy(
                    ObjectListRowSchema,
                    { type: "add_to_set", path: "rows", items: draft.rows, unique_by: "deep_equals", where: { id: "a" } },
                    [{ id: "a", rows: [{ rid: "r1" }] }],
                );
            });

            // The element already present is recognised through the proxy, so only the new one is appended.
            expect(stored[0]?.rows).toStrictEqual([{ rid: "r1" }, { rid: "r2" }]);
            expect(isDraft(stored[0]?.rows?.[1])).toBe(false);
        });
    });

    /**
     * A list the caller keeps writing to is not the list that was stored.
     *
     * `items` is carried by reference all the way to the engine, which is what lets a caller compare the action it
     * sent against the outcome it got. The copy the engine takes is therefore the only thing standing between a
     * later edit of that action and a silent rewrite of a record already written.
     */
    describe("even when the caller goes on editing the list it wrote", () => {

        it("stores elements held separately from the ones the action carries", () => {
            const items = [{ rid: "r1" }];
            const stored = storedBy(ObjectListRowSchema, { type: "push", path: "rows", items, where: { id: "a" } }, [{ id: "a", rows: [] }]);

            expect(stored[0]?.rows).toStrictEqual([{ rid: "r1" }]);
            expect(stored[0]?.rows?.[0]).not.toBe(items[0]);
        });

        it("leaves the stored elements as they were when a later edit changes the action's own", () => {
            const items = [{ rid: "r1" }];
            const stored = storedBy(ObjectListRowSchema, { type: "add_to_set", path: "rows", items, unique_by: "deep_equals", where: { id: "a" } }, [{ id: "a", rows: [] }]);

            items[0]!.rid = "changed after the write";

            expect(stored[0]?.rows).toStrictEqual([{ rid: "r1" }]);
        });
    });
});
