// Fixtures for the where-filter conformance battery. Moved verbatim from the pre-split monolith
// (only `export` added). Kept schema-only so any section file can import just what it needs.
import { z } from "zod";

export const ContactSchema = z.object({
    contact: z.object({
        name: z.string(),
        age: z.number().optional(),
        emailAddress: z.string().optional(),
        locations: z.array(z.union([
            z.string(),
            z.number(),
            z.object({
                city: z.string().optional(),
                country: z.string().optional(),
                flights: z.array(z.string()).optional()
            })
        ])).optional()
    })

})


export const FormzSchema = z.object({
    emailCvID: z.object({
        threadIDG2: z.string(),
        threadIDG3: z.string()
    }),
    softDeletedAtTs: z.number().optional()
})

export const NullableAgeContactSchema = z.object({
    contact: z.object({
        name: z.string(),
        age: z.number().optional().nullable(),
    })
});

export const BooleanContactSchema = z.object({
    contact: z.object({
        name: z.string(),
        isVIP: z.boolean(),
    })
});

export const SpreadNestedSchema = z.object({
    parent_name: z.string(),
    children: z.array(
        z.object({
            child_name: z.string(),
            grandchildren: z.array(
                z.object({
                    grandchild_name: z.string(),
                    age: z.number().optional()
                })
            )
        })
    )
});
export type SpreadNested = z.infer<typeof SpreadNestedSchema>;

export const CachedGmailThreadSchema = z.object({
    threadId: z.string(),
    labelIds: z.array(z.string()),
    rfc822msgids: z.array(z.string()),
    messages: z.array(z.object({
        messageId: z.string(),
        labelIds: z.array(z.string()),
        rfc822msgid: z.string(),
    }))
});
export type CachedGmailThread = z.infer<typeof CachedGmailThreadSchema>;

// ═══════════════════════════════════════════════════════════════════
// Fixtures for the expanded example battery (sections 11–23).
// Kept small and single-purpose; each names the operator family it exercises.
// `.strict()` at top level documents intent — the SQL harnesses do not validate
// the stored object against the schema, so it never rejects a deliberately
// non-conforming (cast) row.
// ═══════════════════════════════════════════════════════════════════

/** Plain string fields — $regex / LIKE fidelity. */
export const RegexSchema = z.object({ id: z.string(), name: z.string(), note: z.string().optional() }).strict();
export type Regex = z.infer<typeof RegexSchema>;

/** Scalar arrays (string + number) — $in/$nin/$all/$size/$elemMatch on arrays, empty-list operands. */
export const TagsSchema = z.object({ id: z.string(), tags: z.array(z.string()), nums: z.array(z.number()) }).strict();
export type Tags = z.infer<typeof TagsSchema>;

/** Array of objects — compound-object filters, $all containment, $size inside $elemMatch. */
export const ObjArraySchema = z.object({
    id: z.string(),
    items: z.array(z.object({ k: z.string(), v: z.number().optional(), tags: z.array(z.string()).optional() }))
}).strict();
export type ObjArray = z.infer<typeof ObjArraySchema>;

/** Array of objects with a nested object array — nested $elemMatch recursion. */
export const NestedItemsSchema = z.object({
    id: z.string(),
    items: z.array(z.object({ k: z.string(), sub: z.array(z.object({ n: z.number() })) }))
}).strict();
export type NestedItems = z.infer<typeof NestedItemsSchema>;

/** Nullable + optional scalars/array — the missing/null nullish matrix. */
export const NullishGridSchema = z.object({
    id: z.string(),
    n: z.number().nullable().optional(),
    s: z.string().nullable().optional(),
    arr: z.array(z.number()).nullable().optional()
}).strict();
export type NullishGrid = z.infer<typeof NullishGridSchema>;

/** A multi-scalar union field — type-faithful equality, typed-range fallthrough. */
export const MultiScalarSchema = z.object({ id: z.string(), secret: z.union([z.boolean(), z.number(), z.string()]) }).strict();
export type MultiScalar = z.infer<typeof MultiScalarSchema>;

/** String enum — ::text cast path. */
export const StringEnumSchema = z.object({ id: z.string(), status: z.enum(['active', 'archived']) }).strict();
export type StringEnum = z.infer<typeof StringEnumSchema>;

/** Numeric enum — ::numeric cast path. */
export const NumEnumSchema = z.object({ id: z.string(), rank: z.union([z.literal(0), z.literal(1)]) }).strict();
export type NumEnum = z.infer<typeof NumEnumSchema>;

/** Mixed (number|string) enum — the raw, no-cast path. */
export const MixedEnumSchema = z.object({ id: z.string(), kind: z.union([z.literal(0), z.literal('a')]) }).strict();
export type MixedEnum = z.infer<typeof MixedEnumSchema>;

/** A single number field — big-int boundaries, NaN/±0/±Infinity. */
export const BigNumSchema = z.object({ id: z.string(), n: z.number() }).strict();
export type BigNum = z.infer<typeof BigNumSchema>;

/** A single string field — unicode normalisation, emoji, null-byte, huge strings. */
export const UnicodeSchema = z.object({ id: z.string(), s: z.string() }).strict();
export type Unicode = z.infer<typeof UnicodeSchema>;

/** Three (four with `d`) nested spreading arrays — deep dot-prop spread paths. */
export const DeepSpread3Schema = z.object({
    a: z.array(z.object({
        b: z.array(z.object({
            c: z.array(z.object({
                leaf: z.string(),
                d: z.array(z.object({ leaf: z.string() })).optional()
            }))
        }))
    }))
}).strict();
export type DeepSpread3 = z.infer<typeof DeepSpread3Schema>;

/** A literal-dot data key — dot-prop escape vs raw-split. */
export const DottedKeySchema = z.object({ id: z.string(), 'a.b': z.string() }).strict();
export type DottedKey = z.infer<typeof DottedKeySchema>;

/** A field literally named `$or` — logic-operator-vs-data-key ambiguity. */
export const DollarKeySchema = z.object({ id: z.string(), '$or': z.string() }).strict();
export type DollarKey = z.infer<typeof DollarKeySchema>;

/** An array of (string | object) — scalar-element match in a mixed array. */
export const MixedArraySchema = z.object({ id: z.string(), mixed: z.array(z.union([z.string(), z.object({ k: z.string() })])) }).strict();
export type MixedArray = z.infer<typeof MixedArraySchema>;
