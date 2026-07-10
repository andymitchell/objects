import { describe, test, expect } from "vitest";
import { z } from "zod";
import { OPERATORS, valueOperatorNames, arrayOperatorNames, broadeningOperatorNames, isOperatorKey } from "./operators.ts";
import { parseFieldPredicate } from "./parseFieldPredicate.ts";
import { ValueOpsPayloadSchema, ArrayOpsPayloadSchema, isWhereFilterDefinition } from "../schemas.ts";
import { ValueComparisonRangeOperators } from "../consts.ts";
import type { Predicate } from "./predicate.ts";

/**
 * The operator registry is the single source of the filter language's operator vocabulary. These guards hold
 * the three places that must agree on that vocabulary — the registry, the gate ({@link ValueOpsPayloadSchema}
 * / {@link ArrayOpsPayloadSchema}), and the parser ({@link parseFieldPredicate}) — in lock-step, so adding an
 * operator to one and forgetting another reds a test rather than shipping a silent inconsistency.
 *
 * Two guarantees, kept distinct: the FREEZE block pins today's vocabulary verbatim (proving the consolidation
 * reproduced the previously hand-listed sets); the DRIFT block proves the three sources stay mutually
 * consistent for whatever the registry becomes.
 */

/**
 * The operator keys the gate's payload actually admits, read from the ZodObject's public `shape`.
 *
 * The payload is `z.lazy(() => custom.pipe(object.strict().refine(...)))`; reaching the object is two public
 * hops (`ZodLazy.unwrap()` → `ZodPipe.out`), pinned by the "reads a lazy(pipe(object)) shape" test below so a
 * Zod structural change reds loudly here rather than silently mis-reporting the gate's keys.
 */
function gateOperatorKeys(payload: z.ZodType): string[] {
    const unwrapped = payload instanceof z.ZodLazy ? payload.unwrap() : payload;
    if (!(unwrapped instanceof z.ZodPipe)) throw new Error("gate payload is not the expected lazy(pipe(...)) shape");
    const out = unwrapped.out;
    if (!(out instanceof z.ZodObject)) throw new Error("gate payload's pipe output is not a ZodObject");
    return Object.getOwnPropertyNames(out.shape);
}

describe("operator registry", () => {

    describe("FREEZE — the consolidation reproduced today's operator vocabulary verbatim", () => {
        test("the registry lists exactly the 16 field-condition operators", () => {
            expect(OPERATORS.map(o => o.name).sort()).toEqual(
                ["$all", "$elemMatch", "$eq", "$exists", "$gt", "$gte", "$in", "$lt", "$lte", "$ne", "$nin", "$not", "$options", "$regex", "$size", "$type"],
            );
        });
        test("the value operators are exactly the pre-consolidation ValueOperators set", () => {
            expect([...valueOperatorNames].sort()).toEqual(
                ["$eq", "$exists", "$gt", "$gte", "$in", "$lt", "$lte", "$ne", "$nin", "$not", "$options", "$regex", "$type"],
            );
        });
        test("the array operators are exactly the pre-consolidation ArrayOperators set", () => {
            expect([...arrayOperatorNames].sort()).toEqual(
                ["$all", "$elemMatch", "$exists", "$in", "$nin", "$not", "$size", "$type"],
            );
        });
        test("the broadening operators are exactly the validator's pre-consolidation BROADENING_OPS", () => {
            expect([...broadeningOperatorNames].sort()).toEqual(["$exists", "$ne", "$nin", "$not", "$type"]);
        });
        test("the range operator tuple keeps its order (the validator reports the first faulty bound, so order is behaviour)", () => {
            expect(ValueComparisonRangeOperators).toEqual(["$lt", "$gt", "$lte", "$gte"]);
        });
        test("no operator name is listed twice", () => {
            const names = OPERATORS.map(o => o.name);
            expect(new Set(names).size).toBe(names.length);
        });
    });

    describe("DRIFT — registry, gate and parser stay mutually consistent", () => {

        test("gateOperatorKeys reads a lazy(pipe(object)) shape (pins the two-hop unwrap against a Zod change)", () => {
            const schema = z.lazy(() => z.custom(() => true).pipe(z.object({ $probe: z.any().optional() }).strict()));
            expect(gateOperatorKeys(schema)).toEqual(["$probe"]);
        });

        test("the value payload admits exactly the registry's value operators", () => {
            expect(gateOperatorKeys(ValueOpsPayloadSchema).sort()).toEqual([...valueOperatorNames].sort());
        });
        test("the array payload admits exactly the registry's array operators", () => {
            expect(gateOperatorKeys(ArrayOpsPayloadSchema).sort()).toEqual([...arrayOperatorNames].sort());
        });

        // A valid operand and the predicate kind the parser must produce for each operator. `$options` is
        // excluded: it is not a standalone predicate (it rides with `$regex`) — its key membership is pinned
        // separately below. Every OTHER registry operator must appear here (the coverage test enforces it), so
        // adding an operator to the registry without a `parseOperator` case reds either this dispatch (the
        // parser throws "Unknown … operator") or the coverage test.
        const DISPATCH: { op: string; operand: unknown; kind: Predicate["kind"] }[] = [
            { op: "$eq", operand: 5, kind: "eq" },
            { op: "$ne", operand: 5, kind: "ne" },
            { op: "$regex", operand: "a", kind: "regex" },
            { op: "$lt", operand: 5, kind: "range" },
            { op: "$gt", operand: 5, kind: "range" },
            { op: "$lte", operand: 5, kind: "range" },
            { op: "$gte", operand: 5, kind: "range" },
            { op: "$in", operand: [1], kind: "in" },
            { op: "$nin", operand: [1], kind: "nin" },
            { op: "$not", operand: { $gt: 5 }, kind: "not" },
            { op: "$exists", operand: true, kind: "exists" },
            { op: "$type", operand: "string", kind: "type" },
            { op: "$elemMatch", operand: { $gt: 5 }, kind: "elemMatch" },
            { op: "$all", operand: [1], kind: "all" },
            { op: "$size", operand: 1, kind: "size" },
        ];

        test.each(DISPATCH)("the parser dispatches $op to a `$kind` predicate", ({ op, operand, kind }) => {
            expect(parseFieldPredicate({ [op]: operand }).kind).toBe(kind);
        });

        test("every registry operator except $options has a parser-dispatch fixture", () => {
            const covered = new Set(DISPATCH.map(d => d.op));
            const expected = OPERATORS.map(o => o.name).filter(n => n !== "$options");
            expect(expected.every(op => covered.has(op))).toBe(true);
            expect(covered.size).toBe(expected.length);
        });

        test("$options is an operator key (it rides with $regex; the gate rejects it alone)", () => {
            // Invisible to the gate/parser drift checks — a lone `$options` fails the gate and the parser skips
            // it — so its key membership is asserted directly, or a dropped registry entry would go unnoticed.
            expect(isOperatorKey("$options")).toBe(true);
            // `isWhereFilterDefinition` takes `unknown`, so the deliberately-malformed filter needs no cast.
            expect(isWhereFilterDefinition({ name: { $options: "i" } })).toBe(false);
        });

        test("the gate accepts a minimal single-operator payload for every dispatched operator", () => {
            for (const { op, operand } of DISPATCH) {
                // Each operator is valid in at least one category with this operand. `isWhereFilterDefinition`
                // takes `unknown`, so these probe filters need no cast.
                const asValue = isWhereFilterDefinition({ field: { [op]: operand } });
                const asArray = isWhereFilterDefinition({ tags: { [op]: operand } });
                expect(asValue || asArray).toBe(true);
            }
        });
    });
});
