import { z } from "zod";
import { PrimaryKeyValueSchema } from '../utils/getKeyValue.ts';
import { CANONICAL_BIGINT_RE } from './sortCompare.ts';

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
 * Zod schema for EncodedBigInt — the tagged encoding of a bigint sort value:
 * `{ $bigint: '<decimal>' }` with no extra keys and a canonical payload (no leading zeros,
 * no `-0`). Parsed output is frozen, matching what `encodeSortValue` produces.
 */
export const EncodedBigIntSchema = z.strictObject({
    $bigint: z.string().regex(CANONICAL_BIGINT_RE),
}).readonly();

/**
 * Zod schema for EncodedSortValue — the normalised form of a sort-key value:
 * `string | number | EncodedBigInt | null`.
 * Runtime source of truth for the {@link EncodedSortValue} contract, used to validate boundary values.
 */
export const EncodedSortValueSchema = z.union([z.string(), z.number(), EncodedBigIntSchema, z.null()]);

/**
 * Zod schema for SortBoundary — a value-based pagination boundary: the encoded sort-key values
 * of the last row on a page, plus that row's primary key.
 *
 * Validates only structure (each value is a valid {@link EncodedSortValueSchema} member —
 * string, number, tagged bigint, or null — and pk is a valid primary key). The 1:1 alignment
 * of `values` with the user's `sort` is enforced by `SortAndSliceSchema`, which has the sort
 * in context.
 *
 * @example
 * const boundary = SortBoundarySchema.parse({ values: ['2024-01-01', 42], pk: 'row_9' });
 */
export const SortBoundarySchema = z.object({
    values: z.array(EncodedSortValueSchema),
    pk: PrimaryKeyValueSchema,
});

/**
 * Zod schema for SortAndSlice — the three mutually-exclusive pagination modes: `offset`,
 * `after_pk` (identity anchor) and `after_boundary` (value-based keyset). Composes
 * SortAndSliceBaseSchema with the pagination fields and enforces the cross-field rules the
 * type-level union cannot express at runtime:
 *
 * - at most one of `offset` / `after_pk` / `after_boundary` may be present;
 * - `after_pk` and `after_boundary` each require a non-empty `sort` (a keyset resume needs a
 *   deterministic order);
 * - an `after_boundary`'s `values` must align 1:1 with `sort` — one boundary value per sort key.
 *
 * @example
 * const parsed = SortAndSliceSchema.parse({ sort: [{ key: 'date', direction: -1 }], limit: 20 });
 *
 * @example
 * // Value-based keyset continuation: resume strictly after the last row of the previous page.
 * SortAndSliceSchema.parse({
 *   sort: [{ key: 'date', direction: -1 }],
 *   after_boundary: { values: ['2024-01-01'], pk: 'row_9' },
 * });
 */
export const SortAndSliceSchema = SortAndSliceBaseSchema.extend({
    offset: z.number().int().nonnegative().optional(),
    after_pk: PrimaryKeyValueSchema.optional(),
    after_boundary: SortBoundarySchema.optional(),
}).superRefine((data, ctx) => {
    if (data.offset !== undefined && data.after_pk !== undefined) {
        ctx.addIssue({ code: "custom", message: 'offset and after_pk are mutually exclusive' });
    }
    if (data.after_pk !== undefined && (!data.sort || data.sort.length === 0)) {
        ctx.addIssue({ code: "custom", message: 'after_pk requires a non-empty sort to define deterministic ordering' });
    }
    if (data.after_boundary !== undefined) {
        if (data.offset !== undefined) {
            ctx.addIssue({ code: "custom", message: 'offset and after_boundary are mutually exclusive' });
        }
        if (data.after_pk !== undefined) {
            ctx.addIssue({ code: "custom", message: 'after_pk and after_boundary are mutually exclusive' });
        }
        if (!data.sort || data.sort.length === 0) {
            ctx.addIssue({ code: "custom", message: 'after_boundary requires a non-empty sort to define deterministic ordering' });
        } else if (data.after_boundary.values.length !== data.sort.length) {
            ctx.addIssue({ code: "custom", message: 'after_boundary.values must align 1:1 with sort (one boundary value per sort key)' });
        }
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
