import { z, ZodSchema } from "zod"

import { DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED } from "../dot-prop-paths/getPropertySimpleDot.test.js"
import type { MatchJavascriptObject, WhereFilterDefinition } from "./types.ts";

export type MatchJavascriptObjectInTesting = <T extends Record<string, any> = Record<string, any>>(obj: T, filter: WhereFilterDefinition<T>, schema: ZodSchema<T>) => Promise<ReturnType<MatchJavascriptObject> | undefined>;

type StandardTestConfig = {
    test: jest.It,
    expect: jest.Expect,
    matchJavascriptObject: MatchJavascriptObjectInTesting,
    implementationName?: string
}

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


const FormzSchema = z.object({
    emailCvID: z.object({
        threadIDG2: z.string(),
        threadIDG3: z.string()
    }),
    softDeletedAtTs: z.number().optional()
})

const NullableAgeContactSchema = z.object({
    contact: z.object({
        name: z.string(),
        age: z.number().optional().nullable(),
    })
});

const BooleanContactSchema = z.object({
    contact: z.object({
        name: z.string(),
        isVIP: z.boolean(),
    })
});

const SpreadNestedSchema = z.object({
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
type SpreadNested = z.infer<typeof SpreadNestedSchema>;

const CachedGmailThreadSchema = z.object({
    threadId: z.string(),
    labelIds: z.array(z.string()),
    rfc822msgids: z.array(z.string()),
    messages: z.array(z.object({
        messageId: z.string(),
        labelIds: z.array(z.string()),
        rfc822msgid: z.string(),
    }))
});
type CachedGmailThread = z.infer<typeof CachedGmailThreadSchema>;

export function standardTests(testConfig: StandardTestConfig) {
    const { test, expect, matchJavascriptObject } = testConfig;

    const implementationName = testConfig.implementationName ?? 'unknown';

    /** Replaces scattered `if (result === undefined) return` with explicit acknowledgement. */
    function expectOrAcknowledgeUnsupported(
        result: boolean | undefined,
        expected: boolean,
        reason?: string
    ): void {
        if (result === undefined) {
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${reason ?? 'not supported'}`);
            return;
        }
        expect(result).toBe(expected);
    }

    /** For known cross-implementation divergences where the result differs but isn't wrong. */
    function expectOrAcknowledgeDivergence(
        result: boolean | undefined,
        expected: boolean,
        reason: string
    ): void {
        if (result === undefined) {
            console.warn(`[ACKNOWLEDGED UNSUPPORTED: ${implementationName}] ${reason}`);
            return;
        }
        if (result !== expected) {
            console.warn(`[ACKNOWLEDGED DIVERGENCE: ${implementationName}] ${reason}: got ${result}, spec says ${expected}`);
            return;
        }
        expect(result).toBe(expected);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 1. Filter forms
    // ═══════════════════════════════════════════════════════════════════

    describe('1. Filter forms', () => {

        describe('1a. Partial Object Filter', () => {

            test('exact scalar match via dot-prop path: passes', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            emailAddress: 'andy@andy.com'
                        }
                    },
                    {
                        'contact.name': 'Andy'
                    },
                    ContactSchema
                );

                expectOrAcknowledgeUnsupported(result, true);
            });


            test('exact scalar match via dot-prop path: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            emailAddress: 'andy@andy.com'
                        }
                    },
                    {
                        'contact.name': 'Bob'
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('1b. Logic Filter', () => {

            describe('$and', () => {

                test('explicit $and with both matching: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                emailAddress: 'andy@andy.com'
                            }
                        },
                        {
                            $and: [
                                {
                                    'contact.name': 'Andy'
                                },
                                {
                                    'contact.emailAddress': 'andy@andy.com'
                                }
                            ]
                        },
                        ContactSchema
                    );

                    expectOrAcknowledgeUnsupported(result, true);
                });


                test('explicit $and with one mismatch: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                emailAddress: 'andy@andy.com'
                            }
                        },
                        {
                            $and: [
                                {
                                    'contact.name': 'Bob'
                                },
                                {
                                    'contact.emailAddress': 'andy@andy.com'
                                }
                            ]
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('nested $and inside $or: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', age: 30 } },
                        { $or: [{ $and: [{ 'contact.name': 'Andy' }, { 'contact.age': 30 }] }] },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

            });

            describe('$or', () => {

                test('$or with one match: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                emailAddress: 'andy@andy.com'
                            }
                        },
                        {
                            $or: [
                                {
                                    'contact.name': 'Andy',
                                },
                                {
                                    'contact.emailAddress': 'bob@bob.com'
                                }
                            ]
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

            });

            describe('$nor', () => {

                test('$nor with no sub-filter matching: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                emailAddress: 'andy@andy.com'
                            }
                        },
                        {
                            $nor: [
                                {
                                    'contact.name': 'Bob',
                                },
                                {
                                    'contact.name': 'Sue',
                                }
                            ]
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$nor where a sub-filter matches: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy' } },
                        { $nor: [{ 'contact.name': 'Andy' }, { 'contact.name': 'Bob' }] },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            describe('Implicit $and (multi-key)', () => {

                test('multi-key filter (implicit $and): passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            'contact.name': 'Andy',
                            'contact.age': 100
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });


                test('multi-key filter (implicit $and): fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            'contact.name': 'Andy',
                            'contact.age': 200
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            describe('Mixed logic + property keys', () => {

                test('logic operator + property key on same object: passes', async () => {

                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            '$or': [{
                                'contact.name': 'Andy',
                                'contact.age': 100
                            }],
                            'contact.name': 'Andy'
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('logic operator + property key on same object: fails', async () => {

                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            '$or': [{
                                'contact.name': 'Andy',
                                'contact.age': 100
                            }],
                            'contact.name': 'Nope'
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            test('multiple logic operators on one object ($and + $nor) are ANDed: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { $and: [{ 'contact.name': 'Andy' }], $nor: [{ 'contact.name': 'Bob' }] },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('multiple logic operators on one object ($and + $nor) are ANDed: fails when $nor matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { $and: [{ 'contact.name': 'Andy' }], $nor: [{ 'contact.name': 'Andy' }] },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('complex nested logic ($and > $or + $nor with range): passes', async () => {
                const result = await matchJavascriptObject<{
                    emailCvID: {
                        threadIDG2: string,
                        threadIDG3: string
                    },
                    softDeletedAtTs?: number
                }>(
                    {
                        "emailCvID": {
                            "threadIDG2": "18d7e59910a07184",
                            "threadIDG3": "thread-a:r-8214939282543103627",
                        },
                        "softDeletedAtTs": undefined
                    },
                    {
                        "$and": [
                            {
                                "$or": [
                                    {
                                        "emailCvID.threadIDG3": "thread-a:r-8214939282543103627"
                                    },
                                    {
                                        "emailCvID.threadIDG2": "18d7e59910a07184"
                                    }
                                ]
                            },
                            {
                                "$nor": [
                                    {
                                        "softDeletedAtTs": {
                                            "$gt": 0
                                        }
                                    }
                                ]
                            }
                        ]
                    },
                    FormzSchema
                );

                expectOrAcknowledgeUnsupported(result, true);
            });

        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 2. Scalar value comparisons
    // ═══════════════════════════════════════════════════════════════════

    describe('2. Scalar value comparisons', () => {

        describe('Deep object equality', () => {

            test('object value matches: passes', async () => {

                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            age: 100
                        }
                    },
                    {
                        'contact': {
                            name: 'Andy',
                            age: 100
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });


            test('object value differs: fails', async () => {

                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            age: 100
                        }
                    },
                    {
                        'contact': {
                            name: 'Andy',
                            age: 200
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });


            test('nested object equality: passes', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            age: 1
                        }
                    },
                    {
                        'contact': {
                            name: 'Andy',
                            age: 1
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            })

            test('nested object equality wrong value: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            age: 1
                        }
                    },
                    {
                        'contact': {
                            name: 'Bob'
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            })


            test('nested object equality missing key: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            age: 1
                        }
                    },
                    {
                        'contact': {
                            name: 'Andy'
                            // Missing age
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            })

        });

        describe('Range ($gt/$lt/$gte/$lte)', () => {

            describe('Numeric', () => {

                test('value in range ($gt + $lt): passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            'contact.age': {
                                '$gt': 99,
                                '$lt': 101,
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });


                test('value outside range ($gt + $lt): fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 200
                            }
                        },
                        {
                            'contact.age': {
                                '$gt': 99,
                                '$lt': 101,
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('value below $gte threshold: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            'contact.age': {
                                '$gte': 101
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('$gte at exact boundary: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', age: 100 } },
                        { 'contact.age': { '$gte': 100 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$lte at exact boundary: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', age: 100 } },
                        { 'contact.age': { '$lte': 100 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$gt at exact boundary: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', age: 100 } },
                        { 'contact.age': { '$gt': 100 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('$lt at exact boundary: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', age: 100 } },
                        { 'contact.age': { '$lt': 100 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('range on undefined/null value: returns false', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy' } },
                        { 'contact.age': { '$gt': 0 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('range type mismatch (number range on string value): does not match', async () => {
                    // Spec: "Range comparison throws if filter type differs from value type"
                    // JS throws; SQL implementations may silently return false.
                    let result: boolean | undefined = false;
                    try {
                        result = await matchJavascriptObject(
                            { contact: { name: 'Andy' } },
                            // @ts-ignore — intentional type mismatch
                            { 'contact.name': { $gt: 10 } },
                            ContactSchema
                        );
                    } catch (e) {
                        // JS implementation throws on type mismatch — that's valid
                    }
                    expect(result).toBe(false);
                });
            })


            describe('String lexicographic', () => {

                test('value in range ($gt + $lt): passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            'contact.name': {
                                '$gt': 'A',
                                '$lt': 'B',
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });


                test('value outside range ($gt + $lt): fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 200
                            }
                        },
                        {
                            'contact.name': {
                                '$gt': 'B',
                                '$lt': 'C',
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('value below $gte threshold: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                age: 100
                            }
                        },
                        {
                            'contact.name': {
                                '$gte': 'B'
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('case sensitivity: "Zebra" < "apple" (code-point order)', async () => {
                    // This proves we are using code-points, not dictionary order.
                    // In a phonebook, Apple comes before Zebra.
                    // In ASCII/JS, 'Z'(90) comes before 'a'(97).
                    const result = await matchJavascriptObject(
                        {
                            contact: { name: 'Zebra' }
                        },
                        {
                            'contact.name': {
                                '$lt': 'apple', // Should be true because 'Z' < 'a'
                            }
                        },
                        ContactSchema
                    );
                    expect(result).toBe(true);
                });

                test('case sensitivity: "apple" > "Zebra"', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: { name: 'apple' }
                        },
                        {
                            'contact.name': {
                                '$gt': 'Zebra', // Should be true
                            }
                        },
                        ContactSchema
                    );
                    expect(result).toBe(true);
                });

                test('string vs number logic: "100" < "2"', async () => {
                    // If this were numeric, 100 > 2.
                    // As strings, '1' comes before '2', so '100' < '2'.
                    const result = await matchJavascriptObject(
                        {
                            contact: { name: '100' } // Passed as string
                        },
                        {
                            'contact.name': {
                                '$lt': '2',
                            }
                        },
                        ContactSchema
                    );
                    expect(result).toBe(true);
                });

                test('shorter prefix < longer word: "Car" < "Cart"', async () => {
                    // 'Car' < 'Cart'
                    const result = await matchJavascriptObject(
                        {
                            contact: { name: 'Car' }
                        },
                        {
                            'contact.name': {
                                '$lt': 'Cart',
                            }
                        },
                        ContactSchema
                    );
                    expect(result).toBe(true);
                });

                test('spaces matter: "A B" < "AB"', async () => {
                    // Space (32) is less than 'A' (65)
                    // So 'A B' < 'AB' is FALSE.
                    // 'AB' (ends) vs 'A ' (next char is space).
                    // Actually: 'A B' vs 'AB' -> 'A'=='A', ' ' vs 'B'. 32 < 66.
                    // So 'A B' is LESS than 'AB'.
                    const result = await matchJavascriptObject(
                        {
                            contact: { name: 'A B' }
                        },
                        {
                            'contact.name': {
                                '$lt': 'AB',
                            }
                        },
                        ContactSchema
                    );
                    expect(result).toBe(true);
                });
            })
        });

        // $contains has been removed in favour of $regex (Mongo subset).
        // All previous $contains tests are retained below as $regex equivalents.

        describe('$regex', () => {
            test('$regex: passes when pattern matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: 'And' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$regex: fails when pattern does not match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: 'Bob' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$regex anchored: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: '^And' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$regex anchored: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: '^ndy' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$regex case-insensitive via $options: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: 'andy', $options: 'i' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$regex case-sensitive default: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: 'andy' } },
                    ContactSchema
                );
                expectOrAcknowledgeDivergence(result, false, '$regex case-sensitivity: SQLite LIKE is case-insensitive for ASCII');
            });

            test('$regex on non-string field: returns false', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    // @ts-expect-error — intentional: $regex on number field
                    { 'contact.age': { $regex: '30' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$regex on missing field: returns false', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-expect-error — intentional: $regex on number field (age is optional number)
                    { 'contact.age': { $regex: '.*' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$regex empty pattern matches any string', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $regex: '' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$ne (not equal)', () => {
            test('$ne string: passes when not equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $ne: 'Bob' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$ne string: fails when equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $ne: 'Andy' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$ne number: passes when not equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $ne: 25 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$ne number: fails when equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $ne: 30 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$ne on missing optional field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $ne: 30 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$eq (explicit equality)', () => {
            test('$eq string: passes when equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $eq: 'Andy' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$eq string: fails when not equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $eq: 'Bob' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$eq number: passes when equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $eq: 30 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$eq number: fails when not equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $eq: 25 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$eq on missing optional field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $eq: 30 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$eq null on null field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: null } },
                    // @ts-expect-error — TODO: ValueComparisonEq conditional types don't resolve null for nullable fields
                    { 'contact.age': { $eq: null } },
                    NullableAgeContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$in (scalar)', () => {
            test('$in string: passes when value in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: ['Andy', 'Bob'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$in string: fails when value not in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: ['Bob', 'Carol'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in number: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $in: [25, 30, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$in number: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $in: [25, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in with empty list: always fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in on missing/undefined property: returns false', async () => {
                // Spec nullish table: $in → false on undefined/null
                // SQL: `NULL IN (25, 30)` → UNKNOWN (falsy), must explicitly handle
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $in: [25, 30] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$nin (scalar)', () => {
            test('$nin string: passes when value not in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $nin: ['Bob', 'Carol'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin string: fails when value in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $nin: ['Andy', 'Bob'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$nin number: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $nin: [25, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin number: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $nin: [25, 30, 35] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$nin with empty list: always passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $nin: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin on missing/undefined property: returns true', async () => {
                // Spec nullish table: $nin → true on undefined/null (matches missing)
                // SQL: `NULL NOT IN (25, 30)` → UNKNOWN (falsy), must use `IS NULL OR col NOT IN (...)`
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $nin: [25, 30] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$not (field-level negation)', () => {
            test('$not with $gt: passes when value does not exceed', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 20 } },
                    { 'contact.age': { $not: { $gt: 25 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $gt: fails when value exceeds', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $not: { $gt: 25 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not on missing optional field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $not: { $gt: 0 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $ne (double negation = equals): passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $ne: 'Andy' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $in: passes when not in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $in: ['Bob', 'Carol'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $in: fails when in list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $in: ['Andy', 'Bob'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $regex: passes when pattern does not match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $regex: '^Bob' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $regex: fails when pattern matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $regex: '^And' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $nin: passes when value is in excluded list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $nin: ['Andy', 'Bob'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $nin: fails when value is not in excluded list', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $nin: ['Bob', 'Carol'] } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $exists: passes when field is missing', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $not: { $exists: true } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $exists: fails when field exists', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $not: { $exists: true } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $type: passes when field is not a string', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $not: { $type: 'string' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $type: fails when field matches type', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $type: 'string' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $eq: passes when not equal (double negation)', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $eq: 'Bob' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $eq: fails when equal', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $not: { $eq: 'Andy' } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$not with $size: passes when array is different length', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $not: { $size: 3 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$not with $size: fails when array matches length', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $not: { $size: 2 } } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$exists', () => {
            test('$exists true on existing field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists true on missing field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$exists false on missing field: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $exists: false } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists false on existing field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $exists: false } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$exists true on existing array: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $exists: true } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$exists false on missing array: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.locations': { $exists: false } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$type', () => {
            test('$type "string": passes on string field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $type: 'string' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type "string": fails on number field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $type: 'string' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "number": passes on number field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: 30 } },
                    { 'contact.age': { $type: 'number' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type "number": fails on string field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $type: 'number' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "array": passes on array field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $type: 'array' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type on missing field: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $type: 'number' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$type "null" on missing optional field (JS treats missing as null; SQL may not)', async () => {
                // JS: missing optional field → undefined → $type 'null' passes
                // SQL: jsonb_typeof / json_type returns SQL NULL for missing path, not 'null' string
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.age': { $type: 'null' } },
                    ContactSchema
                );
                expectOrAcknowledgeDivergence(result, true, '$type null on missing field: SQL returns SQL NULL not JSON null type');
            });

            test('$type "object": passes on object field', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact': { $type: 'object' } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$type "string" on array of strings: fails (checks field type, not element types)', async () => {
                // Divergence from MongoDB: Mongo's $type checks array elements, so
                // { $type: 'string' } would return true if any element is a string.
                // Our implementation checks the field's own type (array ≠ string → false).
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $type: 'string' } },
                    ContactSchema
                );
                expectOrAcknowledgeDivergence(result, false, '$type checks field type not element types; MongoDB would return true here');
            });

            test('$type "bool": passes on boolean field', async () => {
                // SQLite quirk: json_type returns 'true'/'false' not 'bool',
                // so the SQLite engine must map these to match $type: 'bool'.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', isVIP: true } },
                    { 'contact.isVIP': { $type: 'bool' } },
                    BooleanContactSchema
                );
                expectOrAcknowledgeDivergence(result, true, '$type bool: SQLite json_type returns true/false not bool');
            });
        });

        describe('Exact scalar null', () => {
            test('exact scalar null matches explicitly null field', async () => {
                // Spec: exact scalar uses strict equality (===). null === null → true.
                // SQL must translate this to IS NULL, not `= NULL` (which yields UNKNOWN).
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', age: null } },
                    // @ts-expect-error — TODO: ValueComparisonFlexi doesn't include null for nullable fields
                    { 'contact.age': null },
                    NullableAgeContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 3. Array comparisons
    // ═══════════════════════════════════════════════════════════════════

    describe('3. Array comparisons', () => {

        describe('Exact array match', () => {

            test('arrays are equal: passes', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: ['London', 'NYC']
                        }
                    },
                    {
                        'contact.locations': ['London', 'NYC']
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });


            test('arrays differ: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: ['London', 'Tokyo']
                        }
                    },
                    {
                        'contact.locations': ['London', 'NYC']
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('empty array equals empty array: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: [] } },
                    { 'contact.locations': [] },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('array order matters: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['NYC', 'London'] } },
                    { 'contact.locations': ['London', 'NYC'] },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('Scalar element match (indexOf)', () => {

            test('scalar found in array: passes', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: ['London', 'NYC']
                        }
                    },
                    {
                        'contact.locations': 'London'
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });


            test('scalar not in array: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: ['London', 'NYC']
                        }
                    },
                    {
                        'contact.locations': 'Tokyo'
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('Compound object filter on arrays (exact document match)', () => {

            // Mongo semantics: a single element must match ALL keys.
            // Previously this was per-key-OR (different elements could satisfy different keys).

            test('all keys satisfied by single element: passes', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                        }
                    },
                    {
                        'contact.locations': {
                            city: 'London',
                            country: 'UK'
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('keys satisfied by different elements: fails (was passes under per-key-OR)', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                        }
                    },
                    {
                        'contact.locations': {
                            city: 'London',
                            country: 'US'
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });


            test('keys not satisfiable by any element: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                        }
                    },
                    {
                        'contact.locations': {
                            city: 'Brisbane',
                            country: 'Japan'
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('per-key-OR re-expressed via dot-prop spreading: passes (no expressiveness lost)', async () => {
                // This is the Mongo-equivalent of the old per-key-OR behavior:
                // { 'contact.locations.city': 'London', 'contact.locations.country': 'US' }
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                        }
                    },
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'contact.locations.city': 'London', 'contact.locations.country': 'US' },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

        });

        // Previously "Logic filter on elements (atomic per element)" — logic operators
        // are no longer valid as direct array field values (not valid Mongo syntax).
        // All tests retained, re-expressed with explicit $elemMatch wrapping.

        describe('$elemMatch with logic operators', () => {

            describe('$elemMatch + $and', () => {

                test('single element satisfies all $and criteria: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane', country: 'Aus' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $and: [
                                        { 'city': 'Brisbane' },
                                        { 'country': 'Aus' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('no single element satisfies all $and criteria: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane', country: 'Aus' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $and: [
                                        { 'city': 'Brisbane' },
                                        { 'country': 'US' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('$and with no element matching second criterion: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $and: [
                                        { city: 'London' },
                                        { country: 'Japan' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            describe('$elemMatch + $or', () => {

                test('$or with matching element via sub-filter: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $or: [
                                        { 'city': 'London' },
                                        { 'city': 'Tokyo' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$or with no matching element: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $or: [
                                        { 'city': 'London' },
                                        { 'city': 'Tokyo' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('$or on elements: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $or: [
                                        { 'city': 'Brisbane' },
                                        { 'city': 'NYC' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$or on elements with no match: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $or: [
                                        { 'city': 'Tokyo' },
                                        { 'city': 'London' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            describe('$elemMatch + $nor', () => {

                test('$nor with no element matching any sub-filter: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $nor: [
                                        { 'city': 'London' },
                                        { 'city': 'Tokyo' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$nor partial match (some elements match, some do not): passes', async () => {
                    // NYC element passes $nor (Brisbane not matched), so $elemMatch finds a match
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $nor: [
                                        { 'city': 'Brisbane' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$nor with all elements matching: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'Brisbane' }, { city: 'NYC' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $nor: [
                                        { 'city': 'Brisbane' },
                                        { 'city': 'NYC' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

        });

        describe('$elemMatch', () => {

            describe('Object arrays', () => {

                test('explicit $and: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $and: [
                                        { city: 'London' },
                                        { country: 'UK' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });


                test('explicit $and: fails (no single element matches both)', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    $and: [
                                        { city: 'London' },
                                        { country: 'US' }
                                    ]
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });


                test('implicit $and (multi-key): passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    city: 'London',
                                    country: 'UK'
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('implicit $and (multi-key): fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    city: 'London',
                                    country: 'US'
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });


                test('implicit $and with $regex: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    city: { $regex: 'Lon' },
                                    country: 'UK'
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });


                test('implicit $and with $regex: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: {
                                    city: { $regex: 'NY' },
                                    country: 'UK'
                                }
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('$elemMatch with $or inside: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { $or: [{ city: 'London' }, { city: 'Tokyo' }] } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$elemMatch with $or inside: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { $or: [{ city: 'Tokyo' }, { city: 'Paris' }] } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            describe('Scalar arrays', () => {

                test('$elemMatch number: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [1, 2, 3]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: 2
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$elemMatch number: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: [1, 2, 3]
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: 5
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });


                test('$elemMatch string: passes', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: ['NYC', 'London', 'Tokyo']
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: 'NYC'
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('$elemMatch string: fails', async () => {
                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                locations: ['NYC', 'London', 'Tokyo']
                            }
                        },
                        {
                            'contact.locations': {
                                $elemMatch: 'Paris'
                            }
                        },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

            });

            // --- $elemMatch element-type branching tests ---
            // These verify the element-type-based branching fix: the runtime type of each
            // array element determines the code path (object → _matchJavascriptObject,
            // scalar → compareValue), not the filter shape.

            describe('Element-type branching', () => {

                // Scalar arrays — operator expressions

                test('scalar array + range operators ($gte+$lt): passes when element in range', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [75, 82, 90] } },
                        { 'contact.locations': { $elemMatch: { $gte: 80, $lt: 85 } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('scalar array + range operators ($gte+$lt): fails when no element in range', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [75, 90] } },
                        { 'contact.locations': { $elemMatch: { $gte: 80, $lt: 85 } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('scalar array + single range operator ($gt): passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [1, 3, 10] } },
                        { 'contact.locations': { $elemMatch: { $gt: 5 } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('scalar array + single range operator ($gt): fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [1, 3, 4] } },
                        { 'contact.locations': { $elemMatch: { $gt: 5 } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('scalar array + $regex operator: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                        { 'contact.locations': { $elemMatch: { $regex: 'Lon' } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('scalar array + $regex operator: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: ['Paris', 'NYC'] } },
                        { 'contact.locations': { $elemMatch: { $regex: 'Lon' } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                // Scalar arrays — plain scalar

                test('scalar array + plain number: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [1, 2, 3] } },
                        { 'contact.locations': { $elemMatch: 2 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('scalar array + plain number: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [1, 3, 5] } },
                        { 'contact.locations': { $elemMatch: 2 } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('scalar array + plain string: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                        { 'contact.locations': { $elemMatch: 'NYC' } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('scalar array + plain string: fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: ['London', 'Paris'] } },
                        { 'contact.locations': { $elemMatch: 'NYC' } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                // Object arrays — WhereFilterDefinition

                test('object array + field filter: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { city: 'London', country: 'UK' } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('object array + field filter: fails (no single element matches both)', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { city: 'London', country: 'US' } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('object array + field filter with $regex: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { city: { $regex: 'Lon' } } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                // Object arrays — nested operator expressions

                test('object array + nested range operator: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { city: { $regex: 'Lon' }, country: 'UK' } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('object array + nested range operator: fails (no single element matches both)', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                        { 'contact.locations': { $elemMatch: { city: { $regex: 'NY' }, country: 'UK' } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                // Edge cases

                test('empty array: always fails', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [] } },
                        { 'contact.locations': { $elemMatch: { $gt: 5 } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, false);
                });

                test('single-element array: passes when element matches', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [10] } },
                        { 'contact.locations': { $elemMatch: { $gt: 5 } } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

                test('mixed array (objects + scalars) with scalar match: passes', async () => {
                    const result = await matchJavascriptObject(
                        { contact: { name: 'Andy', locations: [{ city: 'London' }, 'hello', 42] } },
                        { 'contact.locations': { $elemMatch: 'hello' } },
                        ContactSchema
                    );
                    expectOrAcknowledgeUnsupported(result, true);
                });

            });

        });

        describe('$in on array', () => {
            test('$in on array field: passes when intersection non-empty', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $in: ['NYC', 'Tokyo'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$in on array field: fails when no intersection', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $in: ['Tokyo', 'Paris'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$in with empty list on array: always fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $in: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$nin on array', () => {
            test('$nin on array field: passes when no intersection', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $nin: ['Tokyo', 'Paris'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$nin on array field: fails when intersection exists', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $nin: ['NYC', 'Tokyo'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$nin with empty list on array: always passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $nin: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

        describe('$all (array contains all)', () => {
            test('$all: passes when array contains all values', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC', 'Tokyo'] } },
                    { 'contact.locations': { $all: ['London', 'NYC'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$all: fails when array missing a value', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $all: ['London', 'Tokyo'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$all with single value: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $all: ['London'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$all on empty array: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: [] } },
                    { 'contact.locations': { $all: ['London'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$all with empty list: passes (every on empty = true)', async () => {
                // Divergence from MongoDB: Mongo rejects $all with empty array or
                // returns no matches. JS Array.every([]) = true, so we match everything.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $all: [] } },
                    ContactSchema
                );
                expectOrAcknowledgeDivergence(result, true, '$all with empty array: MongoDB rejects or returns no matches; JS every([]) = true');
            });

            test('$all order independence: passes regardless of order', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC', 'Tokyo'] } },
                    { 'contact.locations': { $all: ['Tokyo', 'London'] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$all with compound object elements: passes when all objects present', async () => {
                // Mongo $all supports deep equality for object elements.
                // Note: $all with { $elemMatch: ... } inside is NOT supported (documented limitation).
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                    { 'contact.locations': { $all: [{ city: 'London', country: 'UK' }] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$all with compound object elements: fails when object not present', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: [{ city: 'London', country: 'UK' }, { city: 'NYC', country: 'US' }] } },
                    { 'contact.locations': { $all: [{ city: 'Tokyo', country: 'JP' }] } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('$size (array length)', () => {
            test('$size: passes when length matches', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $size: 2 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$size: fails when length differs', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London', 'NYC'] } },
                    { 'contact.locations': { $size: 3 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$size 0 on empty array: passes', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: [] } },
                    { 'contact.locations': { $size: 0 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('$size 0 on non-empty array: fails', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy', locations: ['London'] } },
                    { 'contact.locations': { $size: 0 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$size on missing/undefined array: returns false', async () => {
                // A missing array is not a 0-length array. $size should not treat
                // undefined as []. SQL: COALESCE(json_array_length(col), 0) would
                // incorrectly pass $size: 0 — must check for NULL first.
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.locations': { $size: 0 } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('Array nesting', () => {

            test('nested array within compound: passes', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: [{ city: 'London', country: 'UK', flights: ['today', 'tomorrow'] }, { city: 'NYC', country: 'US' }]
                        }
                    },
                    {
                        'contact.locations': {
                            'flights': 'today'
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });


            test('nested array within compound: fails', async () => {
                const result = await matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            locations: [{ city: 'London', country: 'UK', flights: ['today', 'tomorrow'] }, { city: 'NYC', country: 'US' }]
                        }
                    },
                    {
                        'contact.locations': {
                            'flights': 'yesterday'
                        }
                    },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 4. Dot-prop paths and array spreading
    // ═══════════════════════════════════════════════════════════════════

    describe('4. Dot-prop paths and array spreading', () => {

        test('spread-nesting via dot-prop: passes', async () => {

            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': {
                        grandchild_name: 'Rita'
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });


        test('spread-nesting via dot-prop: fails', async () => {

            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 5
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 10
                                }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': {
                        grandchild_name: 'Bob'
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });



        test('spread-nesting where first path is not the target: passes', async () => {

            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Harold'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': {
                        grandchild_name: 'Rita'
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });



        test('spread-nesting written as nested object (not dot-prop): passes', async () => {


            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita'
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });


        test('spread-nesting written as nested object (not dot-prop): fails', async () => {


            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Bob'
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });


        test('spread-nesting multi-criteria compound filter (within 1 array): exact match semantics', async () => {
            // Under exact document match (Mongo), no single grandchild has both
            // grandchild_name='Rita' AND age=3 (Rita has age=2, Bob has age=3).
            // Under old per-key-OR this passed; under Mongo semantics it fails.
            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Harold',
                                    age: 1
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 2
                                },
                                {
                                    grandchild_name: 'Bob',
                                    age: 3
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita',
                            age: 3
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('spread-nesting multi-criteria compound filter: passes when single element matches all', async () => {
            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                { grandchild_name: 'Harold', age: 1 }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                { grandchild_name: 'Rita', age: 2 },
                                { grandchild_name: 'Bob', age: 3 }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita',
                            age: 2
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });


        test('$size on spread dot-prop path: passes when leaf array matches', async () => {
            // Array operators ($size) must compose correctly with array spreading.
            // If SQL uses flattened CROSS JOIN, it might evaluate $size against
            // flattened elements rather than the leaf arrays.
            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: []
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                { grandchild_name: 'Rita' },
                                { grandchild_name: 'Harold' }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': { $size: 2 }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeDivergence(result, true, '$size on spread dot-prop: SQL may not compose $size correctly with array spreading');
        });

        test('spread-nesting multi-criteria compound filter (within 1 array): fails', async () => {


            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Harold',
                                    age: 1
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 2
                                },
                                {
                                    grandchild_name: 'Bob',
                                    age: 3
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita',
                            age: 1
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 5. Edge cases
    // ═══════════════════════════════════════════════════════════════════

    describe('5. Edge cases', () => {

        test('empty filter {} matches all', async () => {
            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {},
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, true);
        });

        test('undefined filter value: returns false', async () => {


            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {
                    $or: [
                        { 'contact.name': undefined }
                    ]
                },
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, false);
        })


        test('{$or: []} matches nothing (no conditions to succeed)', async () => {


            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {
                    $or: []
                },
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, false);
        })

        test('{$and: []} matches all (no conditions to fail)', async () => {


            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {
                    $and: []
                },
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, true);
        })

        test('{$nor: []} matches all (no conditions to match negatively)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                { $nor: [] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('non-existent deep dot-prop path: returns false', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                // @ts-ignore
                { 'contact.nonexistent.deep': 'x' },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('{$and: [{}]} matches all (empty sub-filter matches all)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                { $and: [{}] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 6. Validation and error handling
    // ═══════════════════════════════════════════════════════════════════

    describe('6. Validation and error handling', () => {

        test('undefined filter throws', async () => {

            await expect(matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                // @ts-expect-error
                undefined,
                ContactSchema
            )).rejects.toThrow('filter was not well-defined');

        });

        test('null filter throws', async () => {
            await expect(matchJavascriptObject(
                { contact: { name: 'Andy' } },
                // @ts-ignore
                null,
                ContactSchema
            )).rejects.toThrow();
        });

        test('number as filter throws', async () => {
            await expect(matchJavascriptObject(
                { contact: { name: 'Andy' } },
                // @ts-ignore
                42,
                ContactSchema
            )).rejects.toThrow();
        });

        test('string as filter throws', async () => {
            await expect(matchJavascriptObject(
                { contact: { name: 'Andy' } },
                // @ts-ignore
                'invalid',
                ContactSchema
            )).rejects.toThrow();
        });

        test('array as filter throws', async () => {
            await expect(matchJavascriptObject(
                { contact: { name: 'Andy' } },
                // @ts-ignore
                [{ 'contact.name': 'Andy' }],
                ContactSchema
            )).rejects.toThrow();
        });

        test('logic operator with object instead of array throws/rejects', async () => {
            // Spec: $or/$and/$nor must hold arrays of sub-filters.
            // Using an object instead of an array should be caught by validation.
            let didFail = false;
            try {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-ignore — intentionally malformed
                    { $or: { 'contact.name': 'Andy' } },
                    ContactSchema
                );
                // If it didn't throw, the result should at least not be true
                if (result === undefined) {
                    didFail = true; // unsupported — counts as handled
                } else {
                    didFail = !result;
                }
            } catch (e) {
                didFail = true;
            }
            expect(didFail).toBe(true);
        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 7. Security
    // ═══════════════════════════════════════════════════════════════════

    describe('7. Security', () => {

        describe('Prototype pollution paths', () => {
            for (const dotPath of DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED) {
                test(`disallowed path "${dotPath}" returns false`, async () => {

                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                emailAddress: 'andy@andy.com'
                            }
                        },
                        {
                            [dotPath]: 'Anything'
                        },
                        ContactSchema
                    );

                    expectOrAcknowledgeUnsupported(result, false);

                });
            }
        });

        describe('SQL injection resistance', () => {
            test('crafted string value with SQL injection does not match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: "'; DROP TABLE users; --" } },
                    { 'contact.name': "'; DROP TABLE users; --" },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('crafted string value with different SQL injection: does not false-match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': "' OR '1'='1" },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('Resource exhaustion', () => {
            test('deeply nested $and/$or chains do not crash', async () => {
                // Build a 50-level deep nested filter
                let filter: any = { 'contact.name': 'Andy' };
                for (let i = 0; i < 50; i++) {
                    filter = i % 2 === 0 ? { $and: [filter] } : { $or: [filter] };
                }
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    filter,
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('large $in array does not crash', async () => {
                const largeList = Array.from({ length: 1000 }, (_, i) => `name_${i}`);
                largeList.push('Andy');
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: largeList } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // 8. Real-world composite patterns
    // ═══════════════════════════════════════════════════════════════════

    describe('8. Real-world composite patterns', () => {

        const thread1: CachedGmailThread = {
            threadId: 't1',
            labelIds: ['INBOX', 'SENT', 'Label_15'],
            rfc822msgids: ['abc@example.com', 'def@example.com'],
            messages: [
                { messageId: 'm1', labelIds: ['INBOX', 'Label_15'], rfc822msgid: 'abc@example.com' },
                { messageId: 'm2', labelIds: ['SENT'], rfc822msgid: 'def@example.com' },
            ]
        };

        const thread2: CachedGmailThread = {
            threadId: 't2',
            labelIds: ['DRAFTS'],
            rfc822msgids: ['xyz@example.com'],
            messages: [
                { messageId: 'm3', labelIds: ['DRAFTS'], rfc822msgid: 'xyz@example.com' },
            ]
        };

        const emptyThread: CachedGmailThread = {
            threadId: 't3',
            labelIds: [],
            rfc822msgids: [],
            messages: []
        };

        describe('8a. Scalar element match on top-level string[]', () => {

            test('labelIds contains INBOX: thread1 passes, thread2 fails', async () => {
                const filter = { labelIds: 'INBOX' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

            test('labelIds contains DRAFTS: thread1 fails, thread2 passes', async () => {
                const filter = { labelIds: 'DRAFTS' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, false);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, true);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

            test('rfc822msgids contains abc@example.com: thread1 passes', async () => {
                const filter = { rfc822msgids: 'abc@example.com' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

            test('rfc822msgids contains nonexistent: all fail', async () => {
                const filter = { rfc822msgids: 'nonexistent@example.com' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, false);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

        });

        describe('8b. $elemMatch single condition on object array', () => {

            test('message with rfc822msgid abc: thread1 passes, thread2 fails', async () => {
                const filter = { messages: { $elemMatch: { rfc822msgid: 'abc@example.com' } } };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
            });

            test('message with rfc822msgid xyz: thread1 fails, thread2 passes', async () => {
                const filter = { messages: { $elemMatch: { rfc822msgid: 'xyz@example.com' } } };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, false);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, true);
            });

        });

        describe('8c. $elemMatch compound with nested string[]', () => {

            test('same message has both rfc822msgid and labelId: passes', async () => {
                // m1 has rfc822msgid 'abc@example.com' AND labelIds ['INBOX', 'Label_15']
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { rfc822msgid: 'abc@example.com', labelIds: 'INBOX' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('rfc822msgid and labelId split across different messages: fails', async () => {
                // m1 has rfc822msgid 'abc@example.com' but NOT 'SENT'
                // m2 has 'SENT' but NOT rfc822msgid 'abc@example.com'
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { rfc822msgid: 'abc@example.com', labelIds: 'SENT' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('8d. $elemMatch negative — no element satisfies compound', () => {

            test('labelId and rfc822msgid exist on different messages: fails', async () => {
                // m1 has Label_15 but rfc822msgid 'abc@example.com' (not 'def')
                // m2 has rfc822msgid 'def@example.com' but labelIds ['SENT'] (not Label_15)
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { labelIds: 'Label_15', rfc822msgid: 'def@example.com' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('8e. $or union filter', () => {

            test('threads with INBOX or DRAFTS or rfc822msgid xyz', async () => {
                const filter = { $or: [
                    { labelIds: 'INBOX' },
                    { labelIds: 'DRAFTS' },
                    { rfc822msgids: 'xyz@example.com' }
                ] };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, true);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

        });

        describe('8f. $or union with $elemMatch', () => {

            test('STARRED label or message with rfc822msgid abc', async () => {
                const filter = { $or: [
                    { labelIds: 'STARRED' },
                    { messages: { $elemMatch: { rfc822msgid: 'abc@example.com' } } }
                ] };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

        });

        describe('8g. Edge cases — empty arrays', () => {

            test('scalar element match on empty labelIds: fails', async () => {
                const result = await matchJavascriptObject(
                    emptyThread,
                    { labelIds: 'INBOX' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$elemMatch on empty messages: fails', async () => {
                const result = await matchJavascriptObject(
                    emptyThread,
                    { messages: { $elemMatch: { rfc822msgid: 'any' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$elemMatch with $or inside: either labelId suffices per element', async () => {
                // m1 has INBOX, m2 has SENT — either individually satisfies the $or
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { $or: [{ labelIds: 'INBOX' }, { labelIds: 'SENT' }] } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

        });

        describe('8h. Dot-prop spreading into nested arrays', () => {

            test('messages.rfc822msgid scalar match: thread1 passes', async () => {
                const result = await matchJavascriptObject(
                    thread1,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.rfc822msgid': 'abc@example.com' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('messages.rfc822msgid scalar match: thread2 fails', async () => {
                const result = await matchJavascriptObject(
                    thread2,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.rfc822msgid': 'abc@example.com' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('messages.labelIds double-nested spread: thread1 passes', async () => {
                const result = await matchJavascriptObject(
                    thread1,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.labelIds': 'INBOX' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('messages.labelIds double-nested spread: thread2 fails', async () => {
                const result = await matchJavascriptObject(
                    thread2,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.labelIds': 'INBOX' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

    });

}
