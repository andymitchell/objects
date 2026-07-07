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
