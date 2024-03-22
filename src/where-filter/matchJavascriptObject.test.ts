import matchJavascriptObject from "./matchJavascriptObject";



describe('testMatchJavascriptObject', () => {
    
    test('Match name', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                'contact.name': 'Andy'
            }
        )).toBe(true);
    });

    test('Ignore wrong name', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                'contact.name': 'Bob'
            }
        )).toBe(false);
    });
    
    test('Match name and emailAddress', () => {
        const result = matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                AND: [
                    {
                        'contact.name': 'Andy'
                    },
                    {
                        'contact.emailAddress': 'andy@andy.com'
                    }
                ]
            }
        );
        
        expect(result).toBe(true);
    });

    test('Do not match name (even though email address ok)', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                AND: [
                    {
                        'contact.name': 'Bob'
                    },
                    {
                        'contact.emailAddress': 'andy@andy.com'
                    }
                ]
            }
        )).toBe(false);
    });

    test('Match emailAddress (name irrelevant)', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                OR: [
                    {
                        'contact.name': 'Andy',
                    },
                    {
                        'contact.emailAddress': 'bob@bob.com'
                    }
                ]
            }
        )).toBe(true);
    });

    test('Match name because NOT being something else', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                NOT: [
                    {
                        'contact.name': 'Bob',
                    },
                    {
                        'contact.name': 'Sue',
                    }
                ]
            }
        )).toBe(true);
    });

    test('Match age int range', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'contact.age': {
                    'gt': 99,
                    'lt': 101,
                }
            }
        )).toBe(true);
    });

    test('Do not match age as greater', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'contact.age': {
                    'gte': 101
                }
            }
        )).toBe(false);
    });

    test('Match array contains York', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    addresses: ['York', 'London']
                }
            },
            {
                'contact.addresses': {
                    array_contains: 'York'
                }
            }
        )).toBe(true);
    });

    /*
    TODO
    test('Match nested array', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    addresses: [
                        {
                            city: 'York'
                        }
                        , 
                        {
                            city: 'London'
                        }]
                }
            },
            {
                'contact.addresses': {
                    array_contains: ''
                }
            }
        )).toBe(true);
    });
    */


    test('Do not match as array does not contain Houston', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    addresses: ['York', 'London']
                }
            },
            {
                'contact.addresses': {
                    array_contains: 'Houston'
                }
            }
        )).toBe(false);
    });


    test('Match a typical Formz View', () => {
        expect(matchJavascriptObject(
            {
                "type": "basic",
                "emailCvID": {
                    "threadID": "18d7e59910a07184",
                    "threadIDG2": "18d7e59910a07184",
                    "threadIDG3": "thread-a:r-8214939282543103627",
                    "lastMessageID": "msg-a:r-8033166051398438215",
                    "standaloneDraftId": "msg-a:r-8033166051398438215",
                    "gotoableID": "18d7e59910a07184"
                },
                "text": "",
                "id": "80e264e2-8d07-4850-bfb8-c1a32f07669f",
                "creator": "a.r.mitchell@gmail.com",
                "createdAtTs": 1707393102751,
                "softDeletedAtTs": undefined
            },
            {
                "AND": [
                    {
                        "OR": [
                            {
                                "emailCvID.threadIDG3": "thread-a:r-8214939282543103627"
                            },
                            {
                                "emailCvID.threadIDG2": "18d7e59910a07184"
                            }
                        ]
                    },
                    {
                        "NOT": [
                            {
                                "softDeletedAtTs": {
                                    "gt": 0
                                }
                            }
                        ]
                    }
                ]
            }
        )).toBe(true);
    });

})
