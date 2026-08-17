import { describe, it, expect } from "vitest";
import { findNonJsonValues, type NonJsonValueIssue } from "./findNonJsonValues.ts";
import { parseDotPropPathSegments } from "../dot-prop-paths/dotPropPathSegments.ts";

/** Walk `value` and return the collected issues — the test-friendly shape over the mutate-an-out-array API. */
function collect(value: unknown, opts?: { flagUndefined?: boolean | "array_elements" }): NonJsonValueIssue[] {
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
        it("safe by default — a position where an absent key means the same thing lets undefined through", () => {
            expect(collect(undefined)).toEqual([]);
            expect(collect({ a: undefined })).toEqual([]);
        });
        it("malformed when flagUndefined is set — a dropped key silently changes what the value means", () => {
            expect(collect(undefined, { flagUndefined: true })).toEqual([{ reason: "malformed", undefined_value: true }]);
            expect(collect({ a: undefined }, { flagUndefined: true })).toEqual([{ reason: "malformed", path: "a", undefined_value: true }]);
        });
        it("marks only the undefined values, so a caller can offer a remedy specific to them", () => {
            expect(collect({ a: undefined, big: 5n }, { flagUndefined: true })).toEqual([
                { reason: "malformed", path: "a", undefined_value: true },
                { reason: "malformed", path: "big" },
            ]);
        });
    });

    /**
     * A dropped key and a dropped element degrade differently, so a caller may want the second flagged without the
     * first: `JSON.stringify` erases an undefined KEY, which reads back as the absent key it already resembles,
     * but rewrites an undefined ELEMENT as `null` — a value the list did not hold before.
     */
    describe("an undefined list element is its own fault, separable from an undefined key", () => {
        it("flags an element under either setting, since a list position cannot be left out", () => {
            expect(collect(["ok", undefined], { flagUndefined: true })).toEqual([{ reason: "malformed", path: "1", undefined_value: true }]);
            expect(collect(["ok", undefined], { flagUndefined: "array_elements" })).toEqual([{ reason: "malformed", path: "1", undefined_value: true }]);
        });

        it("leaves an undefined key alone under the element-only setting, wherever the key sits", () => {
            expect(collect({ a: undefined }, { flagUndefined: "array_elements" })).toEqual([]);
            expect(collect([{ a: undefined }], { flagUndefined: "array_elements" })).toEqual([]);
            expect(collect({ rows: [{ a: undefined }] }, { flagUndefined: "array_elements" })).toEqual([]);
        });

        it("flags an element nested at any depth, and names it by its index path", () => {
            expect(collect({ rows: [{ tags: ["a", undefined] }] }, { flagUndefined: "array_elements" }))
                .toEqual([{ reason: "malformed", path: "rows.0.tags.1", undefined_value: true }]);
        });

        it("leaves the walk root alone under the element-only setting, since a root is no list position", () => {
            expect(collect(undefined, { flagUndefined: "array_elements" })).toEqual([]);
        });

        it("flags a gap in a sparse list, which is the same absence and serialises the same way", () => {
            // eslint-disable-next-line no-sparse-arrays -- a hole is exactly the input under test: it reads as undefined and JSON writes it as null
            expect(collect([, 1], { flagUndefined: "array_elements" })).toEqual([{ reason: "malformed", path: "0", undefined_value: true }]);
        });

        it("still flags nothing when undefined is not being flagged at all", () => {
            expect(collect(["ok", undefined])).toEqual([]);
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

    describe("a structure that leads back into itself is malformed, and answered rather than followed", () => {
        it("an object holding itself is reported where the loop closes", () => {
            const looping: Record<string, unknown> = { a: 1 };
            looping["self"] = looping;
            expect(collect(looping)).toEqual([{ reason: "malformed", path: "self" }]);
        });

        it("an array holding itself is reported at the index that closes it", () => {
            const looping: unknown[] = ["a"];
            looping.push(looping);
            expect(collect(looping)).toEqual([{ reason: "malformed", path: "1" }]);
        });

        it("a loop back to an ancestor, rather than to the value itself, is still a loop", () => {
            const root: Record<string, unknown> = { child: {} };
            (root["child"] as Record<string, unknown>)["parent"] = root;
            expect(collect(root)).toEqual([{ reason: "malformed", path: "child.parent" }]);
        });

        it("one value named twice is written out twice, not refused", () => {
            const shared = { tag: "t" };
            expect(collect({ a: shared, b: shared })).toEqual([]);
        });

        it("one value named twice at different depths is still not a loop", () => {
            const shared = { tag: "t" };
            expect(collect({ a: shared, b: { deeper: [shared, shared] } })).toEqual([]);
        });
    });

    describe("a reported path can be read back to the keys that were walked", () => {
        it("a key holding a literal dot is escaped, so it stays one key", () => {
            const [issue] = collect({ "a.b": 5n });
            expect(parseDotPropPathSegments(issue!.path!)).toEqual(["a.b"]);
        });

        it("a key holding a dot keeps its ancestors and descendants distinct from it", () => {
            const [issue] = collect({ outer: { "a.b": { inner: 5n } } });
            expect(parseDotPropPathSegments(issue!.path!)).toEqual(["outer", "a.b", "inner"]);
        });

        it("an ordinary nested key reads back as the keys it names", () => {
            const [issue] = collect({ outer: { inner: 5n } });
            expect(issue!.path).toBe("outer.inner");
            expect(parseDotPropPathSegments(issue!.path!)).toEqual(["outer", "inner"]);
        });
    });
});
