import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateWriteAction } from "./validateWriteAction.ts";
import type { WriteAction } from "./types.ts";

const Schema = z.object({ id: z.string(), count: z.number(), label: z.string() }).strict();
type Row = z.infer<typeof Schema>;

const SUBSET = { requireSerialisableJsonSubset: true } as const;

/** Build a write action from a (sometimes deliberately out-of-contract) payload, for runtime testing. */
const wa = (payload: unknown): WriteAction<Row> => ({ type: "write", ts: 0, uuid: "U", payload: payload as WriteAction<Row>["payload"] });

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
});
