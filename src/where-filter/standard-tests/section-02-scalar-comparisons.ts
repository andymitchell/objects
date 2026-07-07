import { ContactSchema, NullableAgeContactSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §2 (part A) Scalar value comparisons — deep object equality, range ops, $regex, $ne, $eq. */
export function registerScalarComparisonsA(ctx: SectionCtx): void {
    const { test, expect, matchJavascriptObject, errorsAsValues, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

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
                    if (errorsAsValues) expect(result).toBe(undefined); // schema-contradicting filter → acknowledged-unsupported (invalid_filter), never a silent false
                    else expect(result).toBe(false);
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
}
