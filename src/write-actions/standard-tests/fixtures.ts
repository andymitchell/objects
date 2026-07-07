import { z } from "zod";
import type { DDL } from "../../ddl/types.ts";

// ═══════════════════════════════════════════════════════════════════
// Test Schemas & DDLs
// ═══════════════════════════════════════════════════════════════════

export const FlatSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    count: z.number().optional(),
    tags: z.array(z.string()).optional(),
}).strict();
export type Flat = z.infer<typeof FlatSchema>;

export const flatDdl: DDL<Flat> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
    },
};

export const NestedSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    children: z.array(
        z.object({
            cid: z.string(),
            label: z.string().optional(),
            items: z.array(
                z.object({
                    iid: z.string(),
                    value: z.number().optional(),
                }).strict()
            ),
        }).strict()
    ).optional(),
}).strict();
export type Nested = z.infer<typeof NestedSchema>;

export const nestedDdl: DDL<Nested> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'children': { primary_key: 'cid' },
        'children.items': { primary_key: 'iid' },
    },
};

export const FlatWithSubItemsSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    count: z.number().optional(),
    tags: z.array(z.string()).optional(),
    sub_items: z.array(z.object({
        sid: z.string(),
        val: z.number().optional(),
    }).strict()).optional(),
}).strict();
export type FlatWithSubItems = z.infer<typeof FlatWithSubItemsSchema>;

export const flatWithSubItemsDdl: DDL<FlatWithSubItems> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'sub_items': { primary_key: 'sid' },
    },
};

// ═══════════════════════════════════════════════════════════════════
// Extended fixtures (numeric PK, nested plain objects, nullable fields, deep sets, bounds, matching)
// ═══════════════════════════════════════════════════════════════════

/**
 * Numeric primary key — for the falsy-PK trap tests (0 / NaN treated as missing_key).
 *
 * @remarks NEVER put a falsy PK (`id: 0`) in `initialItems`: `safeKeyValue` THROWS while building the
 * existing-id set (getKeyValue.ts:14-21). Seed falsy-PK cases via `create` actions only.
 */
export const NumericPkSchema = z.object({
    id: z.number(),
    text: z.string().optional(),
}).strict();
export type NumericPk = z.infer<typeof NumericPkSchema>;

export const numericPkDdl: DDL<NumericPk> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
    },
};

/** Nested PLAIN object + nullable scalars — assign/merge divergence, nested undefined-delete, null-kept. */
export const NestedObjSchema = z.object({
    id: z.string(),
    note: z.string().nullable().optional(),
    meta: z.object({
        a: z.string().nullable().optional(),
        b: z.string().optional(),
    }).strict().optional(),
}).strict();
export type NestedObj = z.infer<typeof NestedObjSchema>;

export const nestedObjDdl: DDL<NestedObj> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
    },
};

/** Nullable array + nullable number — custom-error-on-null tests (null can be seeded legitimately, NO casts). */
export const NullableFieldsSchema = z.object({
    id: z.string(),
    tags: z.array(z.string()).nullable().optional(),
    rows: z.array(z.object({ sid: z.string(), val: z.number().optional() }).strict()).nullable().optional(),
    n: z.number().nullable().optional(),
}).strict();
export type NullableFields = z.infer<typeof NullableFieldsSchema>;

export const nullableFieldsDdl: DDL<NullableFields> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'rows': { primary_key: 'sid' },
    },
};

/** add_to_set deep_equals nuances — undefined≡missing, null≠undefined, nested-array order sensitivity. */
export const DeepSetSchema = z.object({
    id: z.string(),
    entries: z.array(z.object({
        k: z.string(),
        n: z.number().nullable().optional(),
        seq: z.array(z.number()).optional(),
    }).strict()).optional(),
}).strict();
export type DeepSet = z.infer<typeof DeepSetSchema>;

export const deepSetDdl: DDL<DeepSet> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'entries': { primary_key: 'k' },
    },
};

/**
 * Bounded number — §17 multi-match post-merge schema fail. Seeding `count: 20` (> max 10) is a valid
 * `number` so NO cast is needed; the bound only bites at write-time post-merge validation.
 */
export const BoundedSchema = z.object({
    id: z.string(),
    grp: z.string().optional(),
    text: z.string().optional(),
    count: z.number().max(10).optional(),
}).strict();
export type Bounded = z.infer<typeof BoundedSchema>;

export const boundedDdl: DDL<Bounded> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
    },
};

/** Where-behavioural corpus (§15) — nullable scalar, scalar array, and object sub-array in one shape. */
export const MatchSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    n: z.number().optional(),
    note: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    sub_items: z.array(z.object({ sid: z.string(), val: z.number().optional() }).strict()).optional(),
}).strict();
export type Match = z.infer<typeof MatchSchema>;

export const matchDdl: DDL<Match> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'sub_items': { primary_key: 'sid' },
    },
};
