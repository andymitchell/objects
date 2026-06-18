import { describe, it, expect } from "vitest";
import { findNonJsonValues, type NonJsonValueIssue } from "./findNonJsonValues.ts";

/** Walk `value` and return the collected issues — the test-friendly shape over the mutate-an-out-array API. */
function collect(value: unknown, opts?: { flagUndefined?: boolean }): NonJsonValueIssue[] {
    const out: NonJsonValueIssue[] = [];
    findNonJsonValues(value, "", out, opts);
    return out;
}

describe("findNonJsonValues — the SerialisableJsonSubset value walk", () => {

    describe("JSON primitives and round-trip-stable edges are safe", () => {
        it("strings, booleans and null carry no issue", () => {
            expect(collect("x")).toEqual([]);
            expect(collect(true)).toEqual([]);
            expect(collect(null)).toEqual([]);
        });
        it("finite numbers are safe, including -0 (which round-trips as 0)", () => {
            expect(collect(0)).toEqual([]);
            expect(collect(-0)).toEqual([]);
            expect(collect(-273.15)).toEqual([]);
        });
        it("a plain nested object/array of primitives is safe", () => {
            expect(collect({ a: 1, b: ["x", true, null], c: { d: 2 } })).toEqual([]);
        });
    });

    describe("non-finite numbers are non_finite (they serialise to null)", () => {
        it("NaN at the root", () => expect(collect(NaN)).toEqual([{ reason: "non_finite" }]));
        it("+Infinity at the root", () => expect(collect(Infinity)).toEqual([{ reason: "non_finite" }]));
        it("-Infinity at the root", () => expect(collect(-Infinity)).toEqual([{ reason: "non_finite" }]));
        it("a nested non-finite is reported at its dot-path", () => {
            expect(collect({ a: { b: Infinity } })).toEqual([{ reason: "non_finite", path: "a.b" }]);
        });
    });

    describe("non-JSON carriers are malformed (no faithful JSON form)", () => {
        it("bigint", () => expect(collect(5n)).toEqual([{ reason: "malformed" }]));
        it("symbol", () => expect(collect(Symbol("s"))).toEqual([{ reason: "malformed" }]));
        it("function", () => expect(collect(() => 1)).toEqual([{ reason: "malformed" }]));
        it("Date (a non-plain prototype)", () => expect(collect(new Date())).toEqual([{ reason: "malformed" }]));
        it("Map", () => expect(collect(new Map())).toEqual([{ reason: "malformed" }]));
        it("Set", () => expect(collect(new Set())).toEqual([{ reason: "malformed" }]));
        it("RegExp", () => expect(collect(/x/)).toEqual([{ reason: "malformed" }]));
        it("a class instance (prototype is neither Object.prototype nor null)", () => {
            class Point { constructor(public x = 1) {} }
            expect(collect(new Point())).toEqual([{ reason: "malformed" }]);
            // It is reported atomically, NOT recursed into — its own `x` is not separately walked.
        });
        it("nested carriers are reported at their dot-paths, in encounter order", () => {
            expect(collect({ when: new Date(), big: 5n })).toEqual([
                { reason: "malformed", path: "when" },
                { reason: "malformed", path: "big" },
            ]);
        });
    });

    describe("undefined is position-dependent via flagUndefined", () => {
        it("safe by default — a payload value treats undefined as a recoverable missing key", () => {
            expect(collect(undefined)).toEqual([]);
            expect(collect({ a: undefined })).toEqual([]);
        });
        it("malformed when flagUndefined is set — a where operand's dropped key degrades to match-all", () => {
            expect(collect(undefined, { flagUndefined: true })).toEqual([{ reason: "malformed" }]);
            expect(collect({ a: undefined }, { flagUndefined: true })).toEqual([{ reason: "malformed", path: "a" }]);
        });
    });

    describe("arrays recurse element-wise with index dot-paths", () => {
        it("an offending element is reported at its index", () => {
            expect(collect(["ok", 5n])).toEqual([{ reason: "malformed", path: "1" }]);
        });
        it("an array nested under an object key carries the full path", () => {
            expect(collect({ tags: ["a", Infinity] })).toEqual([{ reason: "non_finite", path: "tags.1" }]);
        });
    });

    describe("collects EVERY fault, not just the first", () => {
        it("two offending values yield two issues, each at its own path", () => {
            expect(collect({ a: Infinity, b: 5n })).toEqual([
                { reason: "non_finite", path: "a" },
                { reason: "malformed", path: "b" },
            ]);
        });
    });
});
