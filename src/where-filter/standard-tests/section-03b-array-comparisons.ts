import { ContactSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §3 (part B) Array comparisons — $elemMatch, $in/$nin on arrays, $all, $size, array nesting. */
export function registerArrayComparisonsB(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

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
}
