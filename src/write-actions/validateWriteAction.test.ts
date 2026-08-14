import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateWriteAction } from "./validateWriteAction.ts";
import type { WriteAction } from "./types.ts";

const Schema = z.object({ id: z.string(), count: z.number(), label: z.string() }).strict();
type Row = z.infer<typeof Schema>;

const SUBSET = { requireSerialisableJsonSubset: true } as const;

/** Build a write action from a (sometimes deliberately out-of-contract) payload, for runtime testing. */
const wa = (payload: unknown): WriteAction<Row> => ({ type: "write", ts: 0, uuid: "U", payload: payload as WriteAction<Row>["payload"] });

// A schema with an object-array field (`children`) so a nested `array_scope.action.where` / object-form
// `pull.items_where` resolves to the element schema, AND a scalar-array field (`tags`) so a `pull.items_where`
// is a plain value-list — exercising the whole-tree where gate across BOTH `items_where` shapes.
const NestedSchema = z.object({
    id: z.string(),
    children: z.array(z.object({ cid: z.string(), score: z.number().optional() }).strict()).optional(),
    tags: z.array(z.number()).optional(),
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

    // A scope is attacker-suppliable payload data, and an inherited name (`constructor`, `toString`, …) is
    // reachable through a plain object's prototype chain rather than a declared field. The gate must reject
    // any unwritable scope as a value (`invalid_scope`) — never a crash — and report a hostile inherited name
    // no differently from an equivalent benign failure.
    describe("a hostile array_scope.scope naming an inherited member never crashes the gate", () => {
        const scopedAction = (scope: string) =>
            wn({ type: "array_scope", scope, where: { id: "1" }, action: { type: "update", data: { score: 1 }, where: { cid: "c1" } } });

        it("reports an undeclared inherited-name scope with the same error as a genuinely absent scope", () => {
            for (const scope of ["toString", "nonexistent"]) {
                expect(() => validateWriteAction(scopedAction(scope), NestedSchema, SUBSET)).not.toThrow();
                expect(validateWriteAction(scopedAction(scope), NestedSchema, SUBSET)).toEqual([{ type: "invalid_scope", scope, reason: "unknown_path" }]);
            }
        });

        it("rejects a scope containing a segment the runtime reader can never traverse, at any depth", () => {
            for (const scope of ["constructor", "children.constructor"]) {
                expect(() => validateWriteAction(scopedAction(scope), NestedSchema, SUBSET)).not.toThrow();
                expect(validateWriteAction(scopedAction(scope), NestedSchema, SUBSET)).toEqual([{ type: "invalid_scope", scope, reason: "disallowed_segment" }]);
            }
        });

        it("still catches a non-JSON nested operand under a hostile scope — the subset fallback keeps running", () => {
            const a = wn({ type: "array_scope", scope: "constructor", where: { id: "1" }, action: { type: "update", data: { score: 1 }, where: { cid: { $ne: 5n } } } });
            expect(validateWriteAction(a, NestedSchema, SUBSET)).toMatchObject([
                { type: "invalid_scope", scope: "constructor", reason: "disallowed_segment" },
                { type: "invalid_filter", reason: "malformed", where_path: "constructor.cid.$ne" },
            ]);
        });
    });

    // A pull on a SCALAR array carries `items_where` as a plain value-list (the match targets applyPull removes by
    // deepEquals), NOT a where-filter — so the filter walk never inspects its members. Yet they ride the
    // JSON-roundtripped idempotency ledger like any operand, so a non-JSON member must be rejected up-front, tagged
    // to the same `invalid_filter`/`items_where.<i>` slot as the rest of the filter tree.
    describe("scalar pull.items_where — value-list members held to the same subset", () => {
        const pullTags = (members: unknown[]) => wn({ type: "pull", path: "tags", items_where: members, where: { id: "1" } });

        it("rejects a non-finite member as invalid_filter/non_finite, indexed to its position", () => {
            expect(validateWriteAction(pullTags([Infinity]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "non_finite", where_path: "items_where.0" }]);
        });

        it("rejects a NaN member as invalid_filter/non_finite (it degrades to null across the boundary)", () => {
            expect(validateWriteAction(pullTags([NaN]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "non_finite", where_path: "items_where.0" }]);
        });

        it("rejects a non-JSON (bigint) member as invalid_filter/malformed", () => {
            expect(validateWriteAction(pullTags([5n]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "items_where.0" }]);
        });

        it("rejects a non-JSON (Date) member as invalid_filter/malformed", () => {
            expect(validateWriteAction(pullTags([new Date()]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "items_where.0" }]);
        });

        it("rejects an undefined member as invalid_filter/malformed (it shifts the removal set when dropped to null)", () => {
            expect(validateWriteAction(pullTags([undefined]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "items_where.0" }]);
        });

        it("rejects a -Infinity member as invalid_filter/non_finite (the negative pole of the non-finite family)", () => {
            expect(validateWriteAction(pullTags([-Infinity]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "non_finite", where_path: "items_where.0" }]);
        });

        it("rejects a Symbol member as invalid_filter/malformed", () => {
            expect(validateWriteAction(pullTags([Symbol("s")]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "items_where.0" }]);
        });

        it("rejects a function member as invalid_filter/malformed", () => {
            expect(validateWriteAction(pullTags([() => 1]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "items_where.0" }]);
        });

        it("recurses into a member object, flagging a nested non-JSON at its deep where_path", () => {
            expect(validateWriteAction(pullTags([{ x: 5n }]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "malformed", where_path: "items_where.0.x" }]);
        });

        it("indexes the fault to the offending member, not always the first", () => {
            expect(validateWriteAction(pullTags([1, Infinity]), NestedSchema, SUBSET))
                .toMatchObject([{ type: "invalid_filter", reason: "non_finite", where_path: "items_where.1" }]);
        });

        it("accepts a fully JSON-safe value-list (no over-rejection)", () => {
            expect(validateWriteAction(pullTags([1, 2]), NestedSchema, SUBSET)).toEqual([]);
        });

        it("leaves the value-list opaque without the flag — the subset narrowing is off by default", () => {
            expect(validateWriteAction(pullTags([Infinity]), NestedSchema)).toEqual([]);
        });
    });

    // `where` paths speak the escaped path grammar: `rank\.value` is ONE key named `rank.value` — the
    // spelling the typed path unions offer. The gate must resolve it to the declared field, or a mistyped
    // dotted-key filter slips preflight and silently matches nothing at run time.
    describe("where paths speak the escaped dotted-key grammar", () => {
        const DottedSchema = z.object({ id: z.string(), 'rank.value': z.number() }).strict();
        type DottedRow = z.infer<typeof DottedSchema>;
        const wd = (payload: unknown): WriteAction<DottedRow> => ({ type: "write", ts: 0, uuid: "U", payload: payload as WriteAction<DottedRow>["payload"] });

        it("reports a type mismatch on an escaped dotted-key where path as invalid_filter", () => {
            expect(validateWriteAction(wd({ type: "update", data: { id: "1" }, where: { 'rank\\.value': 'x' } }), DottedSchema))
                .toMatchObject([{ type: "invalid_filter", reason: "type_mismatch", where_path: 'rank\\.value' }]);
        });

        it("accepts a well-typed escaped dotted-key where", () => {
            expect(validateWriteAction(wd({ type: "update", data: { id: "1" }, where: { 'rank\\.value': 1 } }), DottedSchema)).toEqual([]);
        });
    });
});
