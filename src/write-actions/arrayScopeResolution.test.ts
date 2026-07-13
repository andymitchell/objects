import { describe, it, expect } from "vitest";
import { z } from "zod";
import { resolveArrayScope } from "./arrayScopeResolution.ts";

describe('resolveArrayScope', () => {

    const schema = z.object({
        id: z.string(),
        profile: z.object({ n: z.string() }).optional(),
        children: z.array(z.object({
            cid: z.string(),
            items: z.array(z.object({ iid: z.string() })),
        })).optional(),
        tags: z.array(z.string()),
        matrix: z.array(z.array(z.number())),
        maybe_null: z.array(z.object({ x: z.string() })).nullable(),
    });

    describe('accepts a scope that targets an array of objects', () => {

        it('resolves a top-level array field to a schema that validates one element', () => {
            const result = resolveArrayScope(schema, 'children');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.elementSchema.safeParse({ cid: 'c1', items: [] }).success).toBe(true);
            expect(result.elementSchema.safeParse([{ cid: 'c1', items: [] }]).success).toBe(false);
        });

        it('resolves a nested scope reached through an outer array', () => {
            const result = resolveArrayScope(schema, 'children.items');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.elementSchema.safeParse({ iid: 'i1' }).success).toBe(true);
        });

        it('accepts a declared field named after an inherited member outside the disallowed trio', () => {
            const declaresToString = z.object({ id: z.string(), toString: z.array(z.object({ tid: z.string() })) });
            const result = resolveArrayScope(declaresToString, 'toString');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.elementSchema.safeParse({ tid: 't1' }).success).toBe(true);
        });
    });

    describe('rejects segments the runtime reader can never traverse', () => {

        it.each(['constructor', '__proto__', 'prototype'])('rejects a top-level %s scope', (scope) => {
            expect(resolveArrayScope(schema, scope)).toEqual({ ok: false, reason: 'disallowed_segment' });
        });

        it('rejects the segment nested under a valid scope', () => {
            expect(resolveArrayScope(schema, 'children.constructor')).toEqual({ ok: false, reason: 'disallowed_segment' });
        });

        it('rejects a declared constructor field, even though the schema resolves it', () => {
            const declaresConstructor = z.object({ id: z.string(), constructor: z.array(z.object({ kid: z.string() })) });
            expect(resolveArrayScope(declaresConstructor, 'constructor')).toEqual({ ok: false, reason: 'disallowed_segment' });
        });
    });

    describe('rejects a path the schema does not declare', () => {

        it.each(['nonexistent', 'children.nope', ''])('rejects %j as unknown', (scope) => {
            expect(resolveArrayScope(schema, scope)).toEqual({ ok: false, reason: 'unknown_path' });
        });

        it('treats an undeclared inherited name as unknown, not as a real field', () => {
            expect(resolveArrayScope(schema, 'toString')).toEqual({ ok: false, reason: 'unknown_path' });
        });
    });

    describe('rejects a declared path that is not an array of objects', () => {

        it.each([
            ['a scalar field', 'id'],
            ['a plain-object field', 'profile'],
            ['an array of scalars', 'tags'],
            ['an array of arrays', 'matrix'],
        ])('rejects %s', (_desc, scope) => {
            expect(resolveArrayScope(schema, scope)).toEqual({ ok: false, reason: 'not_an_object_array' });
        });

        it('rejects a nullable-wrapped array, which the write engine cannot scope into', () => {
            // The schema walker keeps a trailing nullable wrapper (unlike optional), so the engine's
            // scoped element schema would be the wrapper — it can never validate a written element.
            expect(resolveArrayScope(schema, 'maybe_null')).toEqual({ ok: false, reason: 'not_an_object_array' });
        });
    });
});
