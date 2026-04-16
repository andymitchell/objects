import { z } from "zod";
import { PrimaryKeyValueSchema } from '../utils/getKeyValue.ts';

/**
 * Zod schema for a single sort entry: { key: string, direction: 1 | -1 }.
 * Runtime source of truth for SortEntry shape.
 */
export const SortEntrySchema = z.object({
    key: z.string(),
    direction: z.union([z.literal(1), z.literal(-1)]),
});

/**
 * Zod schema for SortDefinition — array of sort entries.
 * Validates sort keys exist and directions are 1 | -1.
 *
 * @note The generic DotPropPaths<T> constraint is compile-time only.
 *       At runtime, keys are validated as strings; path validity against a
 *       specific schema is checked by the SQL builders (via convertDotPropPath*).
 */
export const SortDefinitionSchema = z.array(SortEntrySchema);

/**
 * Zod schema for SortAndSliceBase — shared sort + limit fields.
 * Base for both SortAndSliceSchema and SortAndSliceCursorSchema.
 */
export const SortAndSliceBaseSchema = z.object({
    sort: SortDefinitionSchema.optional(),
    limit: z.number().int().nonnegative().optional(),
});

/**
 * Zod schema for SortAndSlice — offset/after_pk pagination.
 * Composes SortAndSliceBaseSchema with offset/after_pk fields.
 * Enforces: offset/after_pk mutual exclusion, after_pk requires non-empty sort.
 *
 * @example
 * const parsed = SortAndSliceSchema.parse({ sort: [{ key: 'date', direction: -1 }], limit: 20 });
 */
export const SortAndSliceSchema = SortAndSliceBaseSchema.extend({
    offset: z.number().int().nonnegative().optional(),
    after_pk: PrimaryKeyValueSchema.optional(),
}).superRefine((data, ctx) => {
    if (data.offset !== undefined && data.after_pk !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'offset and after_pk are mutually exclusive' });
    }
    if (data.after_pk !== undefined && (!data.sort || data.sort.length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'after_pk requires a non-empty sort to define deterministic ordering' });
    }
});

/**
 * Zod schema for SortAndSliceCursor — opaque cursor pagination for API bridges.
 *
 * @example
 * const parsed = SortAndSliceCursorSchema.parse({ limit: 20, cursor: 'abc123' });
 */
export const SortAndSliceCursorSchema = SortAndSliceBaseSchema.extend({
    cursor: z.string().optional(),
});
