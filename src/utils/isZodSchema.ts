import { z } from "zod";

export function isZodSchema(x: unknown): x is z.ZodSchema {
    return typeof x === 'object' && x !== null && '_def' in x;
}