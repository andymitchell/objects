import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateWriteAction } from "./validateWriteAction.ts";
import type { WriteAction } from "./types.ts";

const Schema = z.object({ id: z.string(), count: z.number(), label: z.string() }).strict();
type Row = z.infer<typeof Schema>;

const SUBSET = { requireSerialisableJsonSubset: true } as const;

/** Build a write action from a (sometimes deliberately out-of-contract) payload, for runtime testing. */
const wa = (payload: unknown): WriteAction<Row> => ({ type: "write", ts: 0, uuid: "U", payload: payload as WriteAction<Row>["payload"] });

// A schema with an object-array field, so a nested `array_scope.action.where` / `pull.items_where` resolves
// to the element schema — exercising the whole-tree where gate (F1), not just the top-level `where`.
const NestedSchema = z.object({
    id: z.string(),
    children: z.array(z.object({ cid: z.string(), score: z.number().optional() }).strict()).optional(),
}).strict();
type NestedRow = z.infer<typeof NestedSchema>;
const wn = (payload: unknown): WriteAction<NestedRow> => ({ type: "write", ts: 0, uuid: "U", payload: payload as WriteAction<NestedRow>["payload"] });

describe("validateWriteAction — runtime gate for a whole WriteAction (written values + top-level where)", () => {
    describe("written values — always checked, schema-agnostic (the unconditional JSON-value gate)", () => {
        it("accepts a fully JSON-safe action", () => {
            expect(validateWriteAction(wa({ type: "create", data: { id: "1", count: 3, label: "a" } }), Schema, SUBSET)).toEqual([]);
        });

        it("flags a non-finite written value as invalid_data_value/non_finite at its path", () => {
            expect(validateWriteAction(wa({ type: "create", data: { id: "1", count: Infinity, label: "a" } }), Schema, SUBSET))
                .toMatchObject([{ type: "invalid_data_value", reason: "non_finite", data_path: "count" }]);
        });

        it("flags a non-JSON written value (a bigint extra) as invalid_data_value/malformed", () => {
            expect(validateWriteAction(wa({ type: "create", data: { id: "1", count: 1, label: "a", extra: 5n } }), Schema, SUBSET))
                .toMatchObject([{ type: "invalid_data_value", reason: "malformed", data_path: "extra" }]);
        });

        it("checks written values even without the subset flag — the value gate is unconditional", () => {
            expect(validateWriteAction(wa({ type: "create", data: { id: "1", count: Infinity, label: "a" } }), Schema))
                .toMatchObject([{ type: "invalid_data_value", reason: "non_finite", data_path: "count" }]);
        });
    });

    describe("top-level where — held to the serialisable subset only when the flag is set", () => {
        it("rejects a satisfiable non-finite where bound as invalid_filter ONLY under the flag", () => {
            const a = wa({ type: "update", data: { label: "b" }, where: { count: { $lt: Infinity } } });
            expect(validateWriteAction(a, Schema)).toEqual([]); // no flag → a satisfiable bound is accepted
            expect(validateWriteAction(a, Schema, SUBSET)).toMatchObject([{ type: "invalid_filter", reason: "non_finite", where_path: "count.$lt" }]);
        });

        it("rejects a non-JSON where operand (a Date) as invalid_filter/malformed", () => {
            expect(validateWriteAction(wa({ type: "update", data: { label: "b" }, where: { count: new Date() } }), Schema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "count" }]);
        });

        it("rejects an undefined where operand on a delete as invalid_filter/malformed", () => {
            expect(validateWriteAction(wa({ type: "delete", where: { label: undefined } }), Schema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "label" }]);
        });

        it("accepts a serialisable where (a finite bound)", () => {
            expect(validateWriteAction(wa({ type: "update", data: { label: "b" }, where: { count: { $gte: 1 } } }), Schema, SUBSET)).toEqual([]);
        });
    });

    describe("tags each fault by its source within the payload", () => {
        it("reports BOTH a bad written value and a bad where, each tagged to its source", () => {
            const errs = validateWriteAction(wa({ type: "update", data: { count: Infinity }, where: { count: new Date() } }), Schema, SUBSET);
            expect(errs).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: "invalid_data_value", reason: "non_finite", data_path: "count" }),
                expect.objectContaining({ type: "invalid_filter", reason: "malformed", where_path: "count" }),
            ]));
            expect(errs).toHaveLength(2);
        });
    });

    // The F1 fix: the gate must span the WHOLE where-tree, not just the top-level `where`. A nested operand the
    // gate misses would otherwise reach a stacking store's JSON-roundtripped idempotency ledger and throw there.
    describe("nested where — array_scope.action.where and pull.items_where held to the same subset (F1)", () => {
        it("rejects a non-JSON (bigint) operand nested in an array_scope action.where, with the full scope-chain where_path", () => {
            const a = wn({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { score: 1 }, where: { cid: { $ne: 5n } } } });
            expect(validateWriteAction(a, NestedSchema, SUBSET)).toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "children.cid.$ne" }]);
        });

        it("rejects a satisfiable non-finite bound nested in an array_scope action.where (subset-only — the schema walk accepts $lt:Infinity)", () => {
            const a = wn({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { score: 1 }, where: { score: { $lt: Infinity } } } });
            expect(validateWriteAction(a, NestedSchema, SUBSET)).toMatchObject([{ type: "invalid_filter", reason: "non_finite", where_path: "children.score.$lt" }]);
        });

        it("rejects a non-JSON (Date) operand in a pull.items_where, scoping the where_path to the array", () => {
            const a = wn({ type: "pull", path: "children", items_where: { cid: new Date() }, where: { id: "1" } });
            expect(validateWriteAction(a, NestedSchema, SUBSET)).toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "children.cid" }]);
        });

        it("rejects an undefined operand nested in an array_scope action.where (a dropped key degrades to match-all)", () => {
            const a = wn({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "delete", where: { cid: undefined } } });
            expect(validateWriteAction(a, NestedSchema, SUBSET)).toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "children.cid" }]);
        });

        it("accepts a clean nested where", () => {
            const a = wn({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { score: 1 }, where: { cid: "c1" } } });
            expect(validateWriteAction(a, NestedSchema, SUBSET)).toEqual([]);
        });

        it("honours the caller's options at nested levels too — without the flag, a satisfiable nested bound is accepted", () => {
            const a = wn({ type: "array_scope", scope: "children", where: { id: "1" }, action: { type: "update", data: { score: 1 }, where: { score: { $lt: Infinity } } } });
            expect(validateWriteAction(a, NestedSchema)).toEqual([]);
        });
    });
});
