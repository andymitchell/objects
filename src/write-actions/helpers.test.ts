import { describe, it, expect, expectTypeOf } from "vitest";
import { isUpdateOrDeleteWritePayload } from "./helpers.ts";
import type { WritePayload } from "./types.ts";

// Keyed off a shallow single-array type, where `WritePayload<T>['type']` resolves cleanly to every arm (it
// collapses to `unknown` for a nested-array T).
type Canary = { id: string; score: number; tags: { tid: string }[] };

describe("isUpdateOrDeleteWritePayload — narrowing to the payloads that act on existing items", () => {

    // A writer matches these against the items it already holds, so a verb missing from the accepted set
    // silently never matches anything: the write reports success and changes nothing. Keying the runtime
    // list off the payload union makes a newly-added verb a compile error here rather than a silent no-op.
    const acceptedVerbs: Record<Exclude<WritePayload<Canary>["type"], "create">, true> = {
        update: true,
        delete: true,
        array_scope: true,
        add_to_set: true,
        push: true,
        pull: true,
        inc: true,
        set_property_undefined: true,
        delete_property: true,
    };

    it.each(Object.keys(acceptedVerbs))("accepts %s — it names existing items through a where", (type) => {
        expect(isUpdateOrDeleteWritePayload({ type, where: {} })).toBe(true);
    });

    it("rejects a create — it defines a whole new item, with nothing to match", () => {
        expect(isUpdateOrDeleteWritePayload({ type: "create", data: { id: "1" } })).toBe(false);
    });

    it("rejects anything that is not a discriminated payload", () => {
        for (const notAPayload of [null, undefined, "update", 7, [], {}, { type: "frobnicate" }]) {
            expect(isUpdateOrDeleteWritePayload(notAPayload)).toBe(false);
        }
    });

    it("narrows a payload so its where is reachable without re-testing the discriminant", () => {
        const payload = { type: "delete_property", path: "label", where: { id: "1" } } as unknown as WritePayload<Canary>;
        if (isUpdateOrDeleteWritePayload<Canary>(payload)) {
            expectTypeOf(payload.where).not.toBeAny();
            expect(payload.where).toEqual({ id: "1" });
        } else {
            expect.unreachable("a delete_property payload acts on existing items");
        }
    });
});
