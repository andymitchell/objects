import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { findNormalizingPaths } from './schema-normalization.ts';

describe('findNormalizingPaths — flags schema features a schema-driven backend cannot replicate', () => {

    it('flags a z.coerce.* field by its path', () => {
        const r = findNormalizingPaths(z.object({ id: z.string(), n: z.coerce.number() }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['n']);
        expect(r[0]!.reason).toBe('coerce');
    });

    it('flags a .transform() field', () => {
        const r = findNormalizingPaths(z.object({ s: z.string().transform((v) => v.length) }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['s']);
    });

    it('flags a .pipe() field', () => {
        const r = findNormalizingPaths(z.object({ s: z.string().pipe(z.coerce.number()) }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['s']);
    });

    it('flags a z.preprocess() field', () => {
        const r = findNormalizingPaths(z.object({ s: z.preprocess((v) => String(v), z.string()) }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['s']);
    });

    it('flags a coerce nested under an array element, at the array path', () => {
        const r = findNormalizingPaths(z.object({ tags: z.array(z.coerce.number()) }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['tags']);
    });

    it('flags a coerce reached through a transparent wrapper (optional)', () => {
        const r = findNormalizingPaths(z.object({ n: z.coerce.number().optional() }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['n']);
    });

    it('flags a coerce inside a nested object, at the dotted path', () => {
        const r = findNormalizingPaths(z.object({ meta: z.object({ when: z.coerce.date() }) }));
        expect(r.map((x) => x.dotprop_path)).toEqual(['meta.when']);
    });

    it('does NOT flag a plain structural schema', () => {
        const r = findNormalizingPaths(z.object({
            id: z.string(),
            age: z.number(),
            on: z.boolean(),
            tags: z.array(z.string()),
            meta: z.object({ x: z.boolean() }),
            who: z.union([z.string(), z.number()]),
        }));
        expect(r).toEqual([]);
    });

    it('does NOT flag refine/default/catch (they do not normalize a present, conforming value)', () => {
        const r = findNormalizingPaths(z.object({
            a: z.string().refine((v) => v.length > 0),
            b: z.number().default(0),
            c: z.string().catch('x'),
        }));
        expect(r).toEqual([]);
    });
});
