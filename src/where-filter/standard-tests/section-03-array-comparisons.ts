import { ContactSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §3 (part A) Array comparisons — exact-array match, scalar element match, compound object filter, $elemMatch with logic operators. */
export function registerArrayComparisonsA(ctx: SectionCtx): void {
    const { describe, test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

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
}
