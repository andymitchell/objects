import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getArrayScopeSchemaAndDDL } from "./getArrayScopeItemAction.ts";
import { resolveDdlListRules } from "../../../ddl/resolveDdlListRules.ts";
import type { DDL } from "../../../ddl/types.ts";
import type { WriteAction } from "../../types.ts";

const schema = z.object({
    id: z.string(),
    subs: z.array(z.object({
        sid: z.string(),
        items: z.array(z.object({ iid: z.string() })),
    })),
});
type Row = z.infer<typeof schema>;

const ddl: DDL<Row> = {
    version: 1,
    lists: {
        ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } },
        subs: { primary_key: "sid" },
        "subs.items": { primary_key: "iid" },
    },
};

/** An `array_scope` action targeting `scope`, carrying a no-op update as its nested action. */
function scopedAction(scope: "subs" | "subs.items"): WriteAction<Row> {
    return {
        type: "write",
        ts: 1,
        uuid: "uuid-1",
        payload: { type: "array_scope", scope, where: {}, action: { type: "update", data: {}, where: {} } },
    };
}

describe("re-rooting a DDL at an array scope", () => {

    it("makes the scoped array's own rules answer to the root", () => {
        const { ddl: scoped } = getArrayScopeSchemaAndDDL<Row>(scopedAction("subs"), schema, ddl);

        expect(resolveDdlListRules(scoped, ".")?.primary_key).toBe("sid");
    });

    it("keeps a list nested below the scope resolvable by its scope-relative path", () => {
        const { ddl: scoped } = getArrayScopeSchemaAndDDL<Row>(scopedAction("subs"), schema, ddl);

        // The engine recurses using coordinates local to the scope, so it asks for `items`, not `subs.items`.
        expect(resolveDdlListRules(scoped, "items")?.primary_key).toBe("iid");
    });

    it("drops lists that lie outside the scope", () => {
        const { ddl: scoped } = getArrayScopeSchemaAndDDL<Row>(scopedAction("subs.items"), schema, ddl);

        expect(resolveDdlListRules(scoped, "subs")).toBeUndefined();
        expect(resolveDdlListRules(scoped, ".")?.primary_key).toBe("iid");
    });

    it("carries the version through unchanged", () => {
        const { ddl: scoped } = getArrayScopeSchemaAndDDL<Row>(scopedAction("subs"), schema, ddl);

        expect(scoped.version).toBe(1);
    });

    it("re-roots the nested action as a standalone write against the element", () => {
        const { writeAction } = getArrayScopeSchemaAndDDL<Row>(scopedAction("subs"), schema, ddl);

        expect(writeAction.payload.type).toBe("update");
        expect(writeAction.ts).toBe(1);
    });

    it("narrows the schema to one element of the scoped array", () => {
        const { schema: scopedSchema } = getArrayScopeSchemaAndDDL<Row>(scopedAction("subs"), schema, ddl);

        expect(scopedSchema.safeParse({ sid: "s1", items: [] }).success).toBe(true);
        expect(scopedSchema.safeParse({ id: "r1", subs: [] }).success).toBe(false);
    });

    it("refuses an action that is not an array scope", () => {
        const notScoped: WriteAction<Row> = {
            type: "write",
            ts: 1,
            uuid: "uuid-2",
            payload: { type: "update", data: {}, where: {} },
        };

        expect(() => getArrayScopeSchemaAndDDL<Row>(notScoped, schema, ddl)).toThrow();
    });
});
