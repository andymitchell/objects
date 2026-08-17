import { describe, it, expect, expectTypeOf } from "vitest";
import { deepFreeze } from "@andyrmitchell/utils/deep-freeze";
import matchJavascriptObject from "../where-filter/matchJavascriptObject.ts";
import { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema } from "../where-filter/index.ts";
import { assertWriteArrayScope } from "./helpers.ts";
import { combineWriteActionsWhereFilters, type CombineWriteActionsWhereFiltersResult } from "./index.ts";
import type { WhereFilterDefinition } from "../where-filter/types.ts";
import type { DDL } from "../ddl/types.ts";
import type { WriteAction, WritePayload, WritePayloadCreate, WriteError } from "./types.ts";
import type { Obj, Child, NumObj, Arm } from "./combineWriteActionsWhereFilters.harness.ts";
import {
    ObjSchema, ddl, numDdl, DS,
    mulberry32, SEEDS,
    POOL, FLAT_SELECTIVE_POOL, ALL_ARMS, genBatch, wa,
    requiredRootIds, matchedIds, missingCoverage, sortedIds, hasTopLevelOr, stripDeletes,
} from "./combineWriteActionsWhereFilters.harness.ts";

/**
 * Single quarantined escape hatch: inject runtime-shaped data the static type forbids, to exercise the
 * function's boundary validation against malformed external input (e.g. deserialised JSON) the compiler
 * cannot see. Used ONLY by the missing-primary-key error tests — a required PK cannot be "wrong" without it.
 */
function raw<T>(data: Record<string, unknown>): T {
    return data as T;
}

describe("combineWriteActionsWhereFilters", () => {

    // ─────────────────────────────────────────────────────────────────────
    // Two-front discipline. Front A: never under-select (soundness, universal).
    // Front B: on flat batches, select EXACTLY the touched set (precision) — this is what a do-nothing
    // `filter: undefined` fails, so it is what keeps the suite honest.
    // ─────────────────────────────────────────────────────────────────────

    describe("never under-selects — the completeness safety net", () => {
        it("covers every row the batch could touch, across all arms, scopes and includeDelete modes", () => {
            const armsSeen = new Set<Arm>();
            let nonEmptyRequiredTrials = 0;
            for (const seed of SEEDS) {
                const rng = mulberry32(seed);
                for (let t = 0; t < 200; t++) {
                    const entries = genBatch(rng, POOL, 1, 6);
                    const actions = entries.map((e) => e.action);
                    entries.forEach((e) => armsSeen.add(e.arm));
                    for (const includeDelete of [true, false]) {
                        const res = combineWriteActionsWhereFilters(ddl, actions, includeDelete);
                        // Every create in the pool carries a valid PK, so a pool batch never errors.
                        expect(res.success, `seed ${seed} trial ${t}: unexpected failure`).toBe(true);
                        if (!res.success) continue;
                        const required = requiredRootIds(DS, actions, ddl, includeDelete);
                        if (required.size > 0) nonEmptyRequiredTrials++;
                        expect(
                            missingCoverage(res.filter, required),
                            `seed ${seed} trial ${t} includeDelete=${includeDelete}: filter=${JSON.stringify(res.filter)}`,
                        ).toEqual([]);
                    }
                }
            }
            // Anti-vacuity: the corpus really did exercise all arms and non-trivial required sets.
            expect(sortedIds(armsSeen)).toEqual([...ALL_ARMS].sort());
            expect(nonEmptyRequiredTrials).toBeGreaterThan(300);
        });
    });

    describe("pins the exact rows on flat batches — no over-selection", () => {
        it("selects exactly the touched set for array_scope-free batches, with negative-witness rows present", () => {
            let negativeWitnessTrials = 0;
            for (const seed of SEEDS) {
                const rng = mulberry32(seed);
                for (let t = 0; t < 200; t++) {
                    const actions = genBatch(rng, FLAT_SELECTIVE_POOL, 1, 5).map((e) => e.action);
                    const res = combineWriteActionsWhereFilters(ddl, actions, true);
                    expect(res.success).toBe(true);
                    if (!res.success) continue;
                    const required = requiredRootIds(DS, actions, ddl, true);
                    if (required.size < DS.length) negativeWitnessTrials++;
                    expect(
                        sortedIds(matchedIds(res.filter)),
                        `seed ${seed} trial ${t}: filter=${JSON.stringify(res.filter)}`,
                    ).toEqual(sortedIds(required));
                }
            }
            // Without negative-witness rows the equality above is vacuous, so require plenty of them.
            expect(negativeWitnessTrials).toBeGreaterThan(300);
        });
    });

    describe("selecting rows a create could overwrite", () => {
        it("selects the row a create would collide with, as a single bare term", () => {
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "create", data: { id: "r1", score: 0 } })]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(sortedIds(matchedIds(res.filter))).toEqual(["r1"]);
            expect(hasTopLevelOr(res.filter)).toBe(false);
        });
        it("treats a falsy-but-present empty-string primary key as valid", () => {
            const dsEmpty: Obj[] = [{ id: "", score: 1 }, { id: "other", score: 2 }];
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "create", data: { id: "", score: 0 } })]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(sortedIds(matchedIds(res.filter, dsEmpty))).toEqual([""]);
        });
        it("treats a numeric zero primary key as valid", () => {
            const nums: NumObj[] = [{ id: 0 }, { id: 1 }];
            const res = combineWriteActionsWhereFilters(numDdl, [{ type: "write", ts: 0, uuid: "n", payload: { type: "create", data: { id: 0 } } }]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            const matched = nums.filter((o) => (res.filter === undefined ? true : matchJavascriptObject(o, res.filter))).map((o) => o.id);
            expect(matched).toEqual([0]);
        });
    });

    describe("selecting rows a conditional mutation could change", () => {
        const mutators: { arm: Arm; action: WriteAction<Obj> }[] = [
            { arm: "inc", action: wa({ type: "inc", path: "score", amount: 1, where: { id: "r2" } }) },
            { arm: "add_to_set", action: wa({ type: "add_to_set", path: "children", items: [{ cid: "z", age: 0, children: [] }], unique_by: "pk", where: { id: "r2" } }) },
            { arm: "push", action: wa({ type: "push", path: "children", items: [{ cid: "z", age: 0, children: [] }], where: { id: "r2" } }) },
            { arm: "pull", action: wa({ type: "pull", path: "children", items_where: { cid: "a1" }, where: { id: "r2" } }) },
            { arm: "set_property_undefined", action: wa({ type: "set_property_undefined", path: "text", where: { id: "r2" } }) },
            { arm: "delete_property", action: wa({ type: "delete_property", path: "text", where: { id: "r2" } }) },
        ];
        it.each(mutators)("includes the $arm target row alongside a sibling update", ({ action }) => {
            const batch = [wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }), action];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r1", "r2"])).toEqual([]);
        });

        const operatorCases: { name: string; where: WhereFilterDefinition<Obj>; expected: string[] }[] = [
            { name: "$in", where: { id: { $in: ["r2", "r4"] } }, expected: ["r2", "r4"] },
            { name: "$nin", where: { id: { $nin: ["r1", "r2", "r3"] } }, expected: ["r4", "r5"] },
            { name: "$nor", where: { $nor: [{ id: "r1" }, { id: "r2" }] }, expected: ["r3", "r4", "r5"] },
            { name: "$not", where: { score: { $not: { $gt: 25 } } }, expected: ["r1", "r2"] },
            { name: "$exists", where: { text: { $exists: false } }, expected: ["r5"] },
            { name: "$regex", where: { text: { $regex: "^x$" } }, expected: ["r1", "r2"] },
            { name: "$gt", where: { score: { $gt: 30 } }, expected: ["r4", "r5"] },
        ];
        it.each(operatorCases)("passes the $name operator through untouched", ({ where, expected }) => {
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "update", data: { text: "u" }, where })]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            // Metamorphic: the derived filter selects each row exactly as the original where does.
            for (const row of DS) {
                const got = res.filter === undefined ? true : matchJavascriptObject(row, res.filter);
                expect(got, `row ${row.id}`).toBe(matchJavascriptObject(row, where));
            }
            expect(sortedIds(matchedIds(res.filter))).toEqual([...expected].sort());
        });
    });

    describe("reaching into nested array scopes", () => {
        it("selects only within the outer scope for a two-level nested change", () => {
            // r1 has child a1 whose grandchild is g1 → r1 is touchable. r2/r4 are inside the outer where but
            // lack the deep match; r3/r5 are outside it. Over-selection within {r1,r2,r4} is contract-legal,
            // but r3/r5 must never appear.
            const action = wa(assertWriteArrayScope<Obj, "children">({
                type: "array_scope", scope: "children", where: { id: { $in: ["r1", "r2", "r4"] } },
                action: assertWriteArrayScope<Child, "children">({
                    type: "array_scope", scope: "children", where: { cid: { $in: ["a1", "b1"] } },
                    action: { type: "update", data: {}, where: { ccid: "g1" } },
                }),
            }));
            const res = combineWriteActionsWhereFilters(ddl, [action]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r1"])).toEqual([]);
            const matched = matchedIds(res.filter);
            expect([...matched].every((id) => ["r1", "r2", "r4"].includes(id)), `matched=${[...matched]}`).toBe(true);
        });
        it("selects a parent whose empty array a scoped create would append to (Finding 1)", () => {
            const action = wa(assertWriteArrayScope<Obj, "children">({
                type: "array_scope", scope: "children", where: { id: "r3" },
                action: { type: "create", data: { cid: "new", age: 0, children: [] } },
            }));
            const res = combineWriteActionsWhereFilters(ddl, [action]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r3"])).toEqual([]);   // r3.children === [] must still be covered
        });
        it("selects a parent none of whose existing elements match a scoped create (Finding 1)", () => {
            const action = wa(assertWriteArrayScope<Obj, "children">({
                type: "array_scope", scope: "children", where: { id: "r4" },
                action: { type: "create", data: { cid: "new", age: 0, children: [] } },
            }));
            const res = combineWriteActionsWhereFilters(ddl, [action]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r4"])).toEqual([]);
        });
        it("covers both an unscoped target and a qualifying scoped root in one batch", () => {
            const batch = [
                wa({ type: "update", data: { text: "u" }, where: { id: "r2" } }),
                wa(assertWriteArrayScope<Obj, "children">({
                    type: "array_scope", scope: "children", where: { id: "r1" },
                    action: { type: "update", data: { age: 1 }, where: { cid: "a1" } },
                })),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r1", "r2"])).toEqual([]);
            expect(matchedIds(res.filter).has("r5")).toBe(false);
        });
        it("narrows to the elements a scoped property change would touch, without losing their parents", () => {
            // A property verb inside a scope changes only the matching ELEMENTS, so the derived filter is the
            // outer `where` narrowed by an element match — the same shape every other scoped mutation takes.
            // Its own fixture: only a removable element property can be named, which the shared `Obj` lacks.
            type Note = { id: string; rows: { rid: string; hint?: string }[] };
            const noteDdl: DDL<Note> = {
                version: 1,
                lists: { ".": { primary_key: "id", default_ordering_key: { key: "id", direction: 1 } }, "rows": { primary_key: "rid" } },
            };
            const noteRows: Note[] = [
                { id: "n1", rows: [{ rid: "a1", hint: "h" }] },
                { id: "n2", rows: [{ rid: "b1" }] },
                { id: "n3", rows: [] },
            ];
            const action: WriteAction<Note> = {
                type: "write", ts: 0, uuid: "u",
                payload: assertWriteArrayScope<Note, "rows">({
                    type: "array_scope", scope: "rows", where: { id: { $in: ["n1", "n2"] } },
                    action: { type: "delete_property", path: "hint", where: { rid: "a1" } },
                }),
            };
            const res = combineWriteActionsWhereFilters(noteDdl, [action]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(res.filter).toEqual({ $and: [{ id: { $in: ["n1", "n2"] } }, { rows: { $elemMatch: { rid: "a1" } } }] });
            // The row actually holding the targeted element is selected; the others are not.
            expect(noteRows.filter((r) => matchJavascriptObject(r, res.filter!)).map((r) => r.id)).toEqual(["n1"]);
        });
        it("still selects the root a scoped delete would remove an element from", () => {
            const action = wa(assertWriteArrayScope<Obj, "children">({
                type: "array_scope", scope: "children", where: { id: "r1" },
                action: { type: "delete", where: { cid: "a1" } },
            }));
            const res = combineWriteActionsWhereFilters(ddl, [action], true);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r1"])).toEqual([]);
        });
    });

    describe("folding a batch into one filter", () => {
        it("returns a lone distinct filter as a bare term, not a singleton union", () => {
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "update", data: { text: "u" }, where: { id: "r1" } })]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(hasTopLevelOr(res.filter)).toBe(false);
            expect(sortedIds(matchedIds(res.filter))).toEqual(["r1"]);
        });
        it("collapses identical actions to a single occurrence's selection", () => {
            const a = wa({ type: "update", data: { text: "u" }, where: { id: "r1" } });
            const one = combineWriteActionsWhereFilters(ddl, [a]);
            const many = combineWriteActionsWhereFilters(ddl, [a, wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }), a]);
            expect(one.success && many.success).toBe(true);
            if (!one.success || !many.success) return;
            expect(sortedIds(matchedIds(many.filter))).toEqual(sortedIds(matchedIds(one.filter)));
            expect(hasTopLevelOr(many.filter)).toBe(false);
        });
        it("unions overlapping wheres rather than intersecting them", () => {
            // both wheres involve text 'x' rows {r1,r2}; the union must be {r1,r2}, never the intersection {r1}.
            const batch = [
                wa({ type: "update", data: { text: "u" }, where: { text: "x" } }),
                wa({ type: "delete", where: { id: "r1" } }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(sortedIds(matchedIds(res.filter))).toEqual(["r1", "r2"]);
        });
        it("grows the selection monotonically as actions are added", () => {
            for (const seed of SEEDS) {
                const rng = mulberry32(seed);
                for (let t = 0; t < 40; t++) {
                    const base = genBatch(rng, POOL, 1, 4).map((e) => e.action);
                    const extra = genBatch(rng, POOL, 1, 1)[0]!.action;
                    const before = combineWriteActionsWhereFilters(ddl, base, true);
                    const after = combineWriteActionsWhereFilters(ddl, [...base, extra], true);
                    expect(before.success && after.success).toBe(true);
                    if (!before.success || !after.success) continue;
                    const b = matchedIds(before.filter), a = matchedIds(after.filter);
                    for (const id of b) expect(a.has(id), `adding an action dropped ${id}`).toBe(true);
                }
            }
        });
    });

    describe("when the batch constrains nothing", () => {
        it("returns no filter for an empty batch", () => {
            const res = combineWriteActionsWhereFilters(ddl, []);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(res.filter).toBeUndefined();
        });
        it("treats a match-all {} where as selecting every row", () => {
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "update", data: { text: "u" }, where: {} })]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(sortedIds(matchedIds(res.filter))).toEqual(sortedIds(DS.map((o) => o.id)));
        });
        it("returns no filter, not a match-none, for a single match-all where", () => {
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "update", data: { text: "u" }, where: {} })]);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(res.filter).toBeUndefined();
        });
        it("lets an unconditional property change widen the whole batch to every row", () => {
            const batch = [
                wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }),
                wa({ type: "delete_property", path: "text", where: {} }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(res.filter).toBeUndefined();
        });
    });

    describe("its output stays SQL-safe — match-all normalization (Finding 2)", () => {
        it("drops a match-all term instead of unioning an empty {} into the filter", () => {
            const batch = [
                wa({ type: "update", data: { text: "u" }, where: {} }),
                wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(true);
            if (!res.success) return;
            // A match-all action makes the whole batch match-all → no filter (never `$or:[{}, {id:'r1'}]`).
            expect(res.filter).toBeUndefined();
        });
        it("compiles a real union to well-formed SQLite with no empty compound operand", () => {
            const translator = new PropertyTranslatorSqliteJsonSchema(ObjSchema, "recordColumn");
            const batch = [
                wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }),
                wa({ type: "delete", where: { id: "r4" } }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(true);
            if (!res.success || res.filter === undefined) return;
            const clause = prepareWhereClauseForSqlite(res.filter, translator);
            expect(clause.success).toBe(true);
            if (!clause.success) return;
            const sql = clause.where_clause_statement;
            expect(sql, sql).not.toMatch(/\(\s*(OR|AND)\b/i);   // no `( OR ...` / `( AND ...`
            expect(sql, sql).not.toMatch(/\b(OR|AND)\s*\)/i);   // no `... OR )` / `... AND )`
        });
    });

    describe("when top-level deletes are excluded (includeRowDeletes=false)", () => {
        it("drops a delete-only batch to no filter", () => {
            const res = combineWriteActionsWhereFilters(ddl, [wa({ type: "delete", where: { id: "r1" } })], false);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(res.filter).toBeUndefined();
        });
        it("keeps a non-delete sibling while dropping the delete", () => {
            const batch = [
                wa({ type: "delete", where: { id: "r1" } }),
                wa({ type: "update", data: { text: "u" }, where: { id: "r2" } }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch, false);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r2"])).toEqual([]);
            expect(matchedIds(res.filter).has("r1")).toBe(false);   // the excluded delete's row is not selected
        });
        it("still selects the parent of a scoped delete — a child-removal is a modification, not a row deletion", () => {
            // Excluding row-deletes suppresses only whole-row deletes. A delete nested in an array_scope removes a
            // child element, which modifies (not deletes) r1 — so r1 must still be pre-read even under exclusion.
            const action = wa(assertWriteArrayScope<Obj, "children">({
                type: "array_scope", scope: "children", where: { id: "r1" },
                action: { type: "delete", where: { cid: "a1" } },
            }));
            const res = combineWriteActionsWhereFilters(ddl, [action], false);
            expect(res.success).toBe(true);
            if (!res.success) return;
            expect(missingCoverage(res.filter, ["r1"])).toEqual([]);
        });
        it("ignoring deletes selects exactly what removing them from the batch would, and stays sound", () => {
            for (const seed of SEEDS) {
                const rng = mulberry32(seed);
                for (let t = 0; t < 60; t++) {
                    const actions = genBatch(rng, POOL, 1, 5).map((e) => e.action);
                    const excluded = combineWriteActionsWhereFilters(ddl, actions, false);
                    const stripped = combineWriteActionsWhereFilters(ddl, stripDeletes(actions), true);
                    expect(excluded.success && stripped.success).toBe(true);
                    if (!excluded.success || !stripped.success) continue;
                    // Metamorphic: excluding deletes ≡ removing them from the batch entirely. (A naive
                    // exclusion ⊆ inclusion is FALSE — an all-suppressed batch collapses to undefined = match-all.)
                    expect(
                        sortedIds(matchedIds(excluded.filter)),
                        `seed ${seed} trial ${t}`,
                    ).toEqual(sortedIds(matchedIds(stripped.filter)));
                    // And it remains a sound superset of everything still touchable under exclusion.
                    expect(missingCoverage(excluded.filter, requiredRootIds(DS, actions, ddl, false))).toEqual([]);
                }
            }
        });
    });

    describe("when a create is missing its primary key", () => {
        /** What a create action carries: an item as the action spells it, which is narrower than the row type. */
        type ObjCreateData = WritePayloadCreate<Obj>["data"];

        const badPks: { name: string; data: Record<string, unknown> }[] = [
            { name: "absent", data: { score: 0 } },
            { name: "null", data: { id: null, score: 0 } },
            { name: "undefined", data: { id: undefined, score: 0 } },
            { name: "boolean", data: { id: true, score: 0 } },
            { name: "object", data: { id: {}, score: 0 } },
        ];
        it.each(badPks)("reports missing_key without throwing when the primary key is $name", ({ data }) => {
            const run = () => combineWriteActionsWhereFilters(ddl, [wa({ type: "create", data: raw<ObjCreateData>(data) })]);
            expect(run).not.toThrow();
            const res = run();
            expect(res.success).toBe(false);
            if (res.success) return;
            expect(res.errors).toEqual([{ type: "missing_key", primary_key: "id" }]);
        });
        it("collects every missing-key error rather than failing fast", () => {
            const batch = [
                wa({ type: "create", data: raw<ObjCreateData>({ score: 0 }) }),
                wa({ type: "create", data: raw<ObjCreateData>({ id: null, score: 0 }) }),
                wa({ type: "create", data: raw<ObjCreateData>({ id: true, score: 0 }) }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(false);
            if (res.success) return;
            expect(res.errors).toEqual([
                { type: "missing_key", primary_key: "id" },
                { type: "missing_key", primary_key: "id" },
                { type: "missing_key", primary_key: "id" },
            ]);
        });
        it("fails the whole batch when a valid action accompanies a bad create", () => {
            const batch = [
                wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }),
                wa({ type: "create", data: raw<ObjCreateData>({ score: 0 }) }),
            ];
            const res = combineWriteActionsWhereFilters(ddl, batch);
            expect(res.success).toBe(false);
            if (res.success) return;
            expect(res.errors).toEqual([{ type: "missing_key", primary_key: "id" }]);
        });
        it("names the nested list's primary key for a bad scoped create", () => {
            const action = wa(assertWriteArrayScope<Obj, "children">({
                type: "array_scope", scope: "children", where: { id: "r1" },
                action: { type: "create", data: raw<Child>({ age: 0, children: [] }) },   // missing cid
            }));
            const res = combineWriteActionsWhereFilters(ddl, [action]);
            expect(res.success).toBe(false);
            if (res.success) return;
            expect(res.errors).toEqual([{ type: "missing_key", primary_key: "cid" }]);
        });
    });

    describe("inputs are sacred — nothing is mutated", () => {
        it("does not mutate the ddl or the actions", () => {
            const freshDdl = structuredClone(ddl);
            const actions: WriteAction<Obj>[] = [
                wa({ type: "update", data: { text: "u" }, where: { id: "r1" } }),
                wa({ type: "create", data: { id: "r9", score: 0 } }),
                wa(assertWriteArrayScope<Obj, "children">({
                    type: "array_scope", scope: "children", where: { id: "r2" },
                    action: { type: "update", data: { age: 1 }, where: { cid: "b1" } },
                })),
            ];
            const ddlSnapshot = structuredClone(freshDdl);
            const actionsSnapshot = structuredClone(actions);
            deepFreeze(freshDdl);
            deepFreeze(actions);
            expect(() => combineWriteActionsWhereFilters(freshDdl, actions, true)).not.toThrow();
            expect(() => combineWriteActionsWhereFilters(freshDdl, actions, false)).not.toThrow();
            expect(freshDdl).toEqual(ddlSnapshot);
            expect(actions).toEqual(actionsSnapshot);
        });
    });

    describe("the type-level contract", () => {
        it("returns the declared discriminated result, with a precise filter on success", () => {
            const res = combineWriteActionsWhereFilters(ddl, []);
            expectTypeOf(res).toEqualTypeOf<CombineWriteActionsWhereFiltersResult<Obj>>();
            if (res.success) {
                expectTypeOf(res.filter).toEqualTypeOf<WhereFilterDefinition<Obj> | undefined>();
                expectTypeOf(res.filter).not.toBeAny();
                expectTypeOf(res.filter).not.toBeUnknown();
                // @ts-expect-error errors is not present on the success arm
                void res.errors;
            } else {
                expectTypeOf(res.errors).toEqualTypeOf<WriteError[]>();
                // @ts-expect-error filter is not present on the failure arm
                void res.filter;
            }
        });
        it("makes includeRowDeletes optional — a two-argument call type-checks", () => {
            const res = combineWriteActionsWhereFilters<Obj>(ddl, []);
            expectTypeOf(res).toEqualTypeOf<CombineWriteActionsWhereFiltersResult<Obj>>();
            // A defaulted parameter reflects as optional → `boolean | undefined`, not `boolean` (Finding 4).
            expectTypeOf(combineWriteActionsWhereFilters<Obj>).parameter(2).toEqualTypeOf<boolean | undefined>();
        });
        it("keeps the payload arm set exhaustive", () => {
            // Keyed off the fixture the whole suite writes against, so adding or removing a verb breaks this.
            type SourceArm = WritePayload<Obj>["type"];
            const _arms: Record<SourceArm, true> = {
                create: true, update: true, delete: true, array_scope: true,
                add_to_set: true, push: true, pull: true, inc: true,
                set_property_undefined: true, delete_property: true,
            };
            expectTypeOf<SourceArm>().toEqualTypeOf<Arm>();
            expect(Object.keys(_arms).sort()).toEqual([...ALL_ARMS].sort());
        });
        it("rejects a foreign payload arm", () => {
            type CanaryObj = { id: string; score: number; tags: { tid: string }[] };
            // @ts-expect-error 'frobnicate' is not a member of WritePayload
            const _bad: WritePayload<CanaryObj> = { type: "frobnicate" };
            void _bad;
        });
    });
});
