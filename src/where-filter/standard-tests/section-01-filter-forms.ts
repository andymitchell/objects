import { ContactSchema, FormzSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §1. Filter forms — bare object filters, logic operators ($and/$or/$nor), and their combinations. */
export function registerFilterForms(ctx: SectionCtx): void {
    const { describe, test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

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
                    softDeletedAtTs?: number | undefined
                }>(
                    {
                        "emailCvID": {
                            "threadIDG2": "18d7e59910a07184",
                            "threadIDG3": "thread-a:r-8214939282543103627",
                        }
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
}
