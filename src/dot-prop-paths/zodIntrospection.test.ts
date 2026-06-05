import { describe, it, expect } from "vitest";
import { z } from "zod";
import { objectRejectsUnknownKeys } from "./zodIntrospection.ts";

/**
 * `objectRejectsUnknownKeys` reads zod's UNDOCUMENTED `_zod.def.catchall`. These tests pin its behaviour to
 * the installed zod so a version bump that changes the internal representation fails loudly here — rather
 * than silently shifting where-filter unknown_field flagging (e.g. a strict object misread as non-strict).
 */
describe("objectRejectsUnknownKeys (pinned to the installed zod)", () => {
    describe("objects that REJECT unknown keys → true (a written row cannot carry an extra key)", () => {
        it("detects .strict()", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict())).toBe(true);
        });
        it("detects z.strictObject", () => {
            expect(objectRejectsUnknownKeys(z.strictObject({ a: z.string() }))).toBe(true);
        });
    });

    describe("objects that TOLERATE or KEEP unknown keys → false (a row may carry an extra key)", () => {
        it("treats a default (strip) object as not rejecting", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }))).toBe(false);
        });
        it("treats .passthrough(), z.looseObject and .catchall(x) as not rejecting", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).passthrough())).toBe(false);
            expect(objectRejectsUnknownKeys(z.looseObject({ a: z.string() }))).toBe(false);
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).catchall(z.number()))).toBe(false);
        });
        it("treats non-object schemas as not rejecting", () => {
            expect(objectRejectsUnknownKeys(z.string())).toBe(false);
            expect(objectRejectsUnknownKeys(z.array(z.string()))).toBe(false);
            expect(objectRejectsUnknownKeys(z.record(z.string(), z.string()))).toBe(false);
        });
    });

    describe("unwraps transparent wrappers before deciding (the catchall sits on the inner object)", () => {
        it("sees through .optional()", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().optional())).toBe(true);
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).passthrough().optional())).toBe(false);
        });
        it("sees through .nullable() and .default()", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().nullable())).toBe(true);
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().default({ a: "x" }))).toBe(true);
        });
        it("treats a refined strict object as rejecting (refine does not wrap)", () => {
            expect(objectRejectsUnknownKeys(z.object({ a: z.string() }).strict().refine(() => true))).toBe(true);
        });
    });
});
