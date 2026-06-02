import { z } from "zod";

/**
 * Type-guards an unknown value as a Zod schema via its canonical v4 `_zod` brand.
 *
 * Brands on `_zod` rather than the deprecated `_def` back-compat getter (which a later zod minor
 * could drop), so the guard stays correct on a pure-v4 codebase.
 *
 * @example isZodSchema(z.string()) // true;  isZodSchema({ a: 1 }) // false
 */
export function isZodSchema(x: unknown): x is z.ZodType {
    return typeof x === 'object' && x !== null && '_zod' in x;
}
