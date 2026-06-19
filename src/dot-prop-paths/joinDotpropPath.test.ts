import { describe, it, expect } from "vitest";
import { joinDotpropPath } from "./joinDotpropPath.ts";

describe("joinDotpropPath — assembling canonical dot-prop ancestry", () => {
    it("returns the segment unchanged at the root (no prefix means no leading dot)", () => {
        expect(joinDotpropPath("", "child")).toBe("child");
    });

    it("joins a non-empty prefix and segment with a single dot", () => {
        expect(joinDotpropPath("a.b", "c")).toBe("a.b.c");
    });

    it("is associative — how the path is grouped never changes the assembled result", () => {
        // metamorphic: descending a.b.c in one step or two must agree
        const inOneGo = joinDotpropPath(joinDotpropPath("a", "b"), "c");
        const nested = joinDotpropPath("a", joinDotpropPath("b", "c"));
        expect(inOneGo).toBe(nested);
        expect(inOneGo).toBe("a.b.c");
    });
});
