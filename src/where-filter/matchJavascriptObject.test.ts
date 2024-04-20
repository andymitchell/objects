import { produce } from "immer";
import _matchJavascriptObject, { ObjOrDraft } from "./matchJavascriptObject";
import { WhereFilterDefinition, isWhereFilterDefinition } from "./types";

function matchJavascriptObject<T extends Record<string, any>>(object: ObjOrDraft<T>, filter: WhereFilterDefinition<T>) {
    expect(isWhereFilterDefinition(filter)).toBe(true);
    return _matchJavascriptObject(object, filter);
}

type SpreadNested = {
    parent_name: string,
    children: {
        child_name: string,
        grandchildren: {
            grandchild_name: string,
            age?: number
        }[]
    }[]
}

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

    test('Match age in range: passes', () => {
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


    test('Match age int range: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 200
                }
            },
            {
                'contact.age': {
                    'gt': 99,
                    'lt': 101,
                }
            }
        )).toBe(false);
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

    test('compares object: passes', () => {

        expect(matchJavascriptObject(
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
            }
        )).toBe(true);
    });

    test('compares object: fails', () => {

        expect(matchJavascriptObject(
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
            }
        )).toBe(false);
    });



    test('Match a typical Formz View', () => {
        expect(matchJavascriptObject<{
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


    test('Immer - Match name', () => {

        const obj = {
            contact: {
                name: 'Andy',
                emailAddress: 'andy@andy.com'
            }
        };

        const final = produce(obj, draft => {
            expect(matchJavascriptObject(
                draft,
                {
                    'contact.name': 'Andy'
                }
            )).toBe(true);
        });
    });

    test('string contains', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'contact.name': {
                    contains: 'And'
                }
            }
        )).toBe(true);
    });

    test('string not contains', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'contact.name': {
                    contains: 'Wrong'
                }
            }
        )).toBe(false);
    });


    

    

    test('multikey is AND: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'contact.name': 'Andy',
                'contact.age': 100
            }
        )).toBe(true);
    });
    

    test('multikey is AND: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'contact.name': 'Andy',
                'contact.age': 200
            }
        )).toBe(false);
    });


    test('multikey with logic: passes', () => {

        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'OR': [{
                    'contact.name': 'Andy',
                    'contact.age': 100
                }],
                'contact.name': 'Andy'
            }
        )).toBe(true);
    });

    test('multikey with logic: fails', () => {

        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    age: 100
                }
            },
            {
                'OR': [{
                    'contact.name': 'Andy',
                    'contact.age': 100
                }],
                'contact.name': 'Nope'
            }
        )).toBe(false);
    });


    test('array equals true', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: ['London', 'NYC']
                }
            },
            {
                'contact.locations': ['London', 'NYC']
            }
        )).toBe(true);
    });


    test('array equals false', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: ['London', 'Tokyo']
                }
            },
            {
                'contact.locations': ['London', 'NYC']
            }
        )).toBe(false);
    });
    

    test('array element compound filter: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: ['London', 'NYC']
                }
            },
            {
                'contact.locations': 'London'
            }
        )).toBe(true);
    });

    
    test('array element compound filter: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: ['London', 'NYC']
                }
            },
            {
                'contact.locations': 'Tokyo'
            }
        )).toBe(false);
    });
    
    test('array element compound filter: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    OR: [
                        {
                            'city': 'London'
                        },
                        {
                            'city': 'Tokyo'
                        }
                    ]
                }
            }
        )).toBe(true);
    });


    test('array element compound filter: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    OR: [
                        {
                            'city': 'London'
                        },
                        {
                            'city': 'Tokyo'
                        }
                    ]
                }
            }
        )).toBe(false);
    });
    

    test('array element compound filter city+country infer OR: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    city: 'London',
                    country: 'US'
                }
            }
        )).toBe(true);
    });


    test('array element compound filter city+country infer OR: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    city: 'Brisbane',
                    country: 'Japan'
                }
            }
        )).toBe(false);
    });


    
    test('array element compound filter city+country: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    AND: [
                        {city: 'London'},
                        {country: 'Japan'}
                    ]
                }
            }
        )).toBe(false);
    });
       


    test('array element compound filter explicit AND behaves like elem_match: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane', country: 'Aus'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    AND: [
                        {
                            'city': 'Brisbane'
                        },
                        {
                            'country': 'Aus'
                        }
                    ]
                }
            }
        )).toBe(true);
    });



    test('array element compound filter explict AND behaves like elem_match: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane', country: 'Aus'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    AND: [
                        {
                            'city': 'Brisbane'
                        },
                        {
                            'country': 'US'
                        }
                    ]
                }
            }
        )).toBe(false);
    });
    
    
    test('array element compound filter explicit OR: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    OR: [
                        {
                            'city': 'Brisbane'
                        },
                        {
                            'city': 'NYC'
                        }
                    ]
                }
            }
        )).toBe(true);
    });

    test('array element compound filter explicit OR: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    OR: [
                        {
                            'city': 'Tokyo'
                        },
                        {
                            'city': 'London'
                        }
                    ]
                }
            }
        )).toBe(false);
    });
    

    test('array element compound filter NOT: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    NOT: [
                        {
                            'city': 'London'
                        },
                        {
                            'city': 'Tokyo'
                        }
                    ]
                }
            }
        )).toBe(true);
    });



    test('array element compound filter NOT partial (allowed because NYC ok): passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    NOT: [
                        {
                            'city': 'Brisbane'
                        }
                    ]
                }
            }
        )).toBe(true);
    });


    test('array element compound filter NOT: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'Brisbane'}, {city: 'NYC'}]
                }
            },
            {
                'contact.locations': {
                    NOT: [
                        {
                            'city': 'Brisbane'
                        },
                        {
                            'city': 'NYC'
                        }
                    ]
                }
            }
        )).toBe(false);
    });

    


    



    test('array element elem_match (must be all in one element) city+country: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    elem_match: {
                        AND: [
                            {city: 'London'},
                            {country: 'UK'}
                        ]
                    }
                }
            }
        )).toBe(true);
    });

    test('array element elem_match (must be all in one element) city+country: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    elem_match: {
                        AND: [
                            {city: 'London'},
                            {country: 'US'}
                        ]
                    }
                }
            }
        )).toBe(false);
    });


    test('array element elem_match (must be all in one element) city+country infer AND: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    elem_match: {
                        city: 'London',
                        country: 'UK'
                    }
                }
            }
        )).toBe(true);
    });

    test('array element elem_match (must be all in one element) city+country infer AND: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    elem_match: {
                        city: 'London',
                        country: 'US'
                    }
                }
            }
        )).toBe(false);
    });


    test('array element elem_match (must be all in one element) city+country infer AND and contains: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    elem_match: {
                        city: {contains: 'Lon'},
                        country: 'UK'
                    }
                }
            }
        )).toBe(true);
    });

    test('array element elem_match (must be all in one element) city+country infer AND and contains: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK'}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    elem_match: {
                        city: {contains: 'NY'},
                        country: 'UK'
                    }
                }
            }
        )).toBe(false);
    });

    test('array element elem_match (must be all in one element) number: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [1,2,3]
                }
            },
            {
                'contact.locations': {
                    elem_match: 2
                }
            }
        )).toBe(true);
    });

    test('array element elem_match (must be all in one element) number: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [1,2,3]
                }
            },
            {
                'contact.locations': {
                    elem_match: 5
                }
            }
        )).toBe(false);
    });

    test('array nesting: passes', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK', flights: ['today', 'tomorrow']}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    'flights': 'today'
                }
            }
        )).toBe(true);
    });

    test('array nesting: fails', () => {
        expect(matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    locations: [{city: 'London', country: 'UK', flights: ['today', 'tomorrow']}, {city: 'NYC', country: 'US'}]
                }
            },
            {
                'contact.locations': {
                    'flights': 'yesterday'
                }
            }
        )).toBe(false);
    });
    
    

    test('array spread-nesting: passes', () => {

        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(true);
    });

    
    test('array spread-nesting: fails', () => {


        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(false);
    });


    test('array spread-nesting where first path is not the target: passes', () => {

        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(true);
    });



    test('array spread-nesting written nested: passes', () => {


        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(true);
    });


    test('array spread-nesting written nested: fails', () => {


        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(false);
    });


    test('array spread-nesting multi criteria compound filter (within 1 array): passes', () => {


        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(true);
    });
    

    test('array spread-nesting multi criteria compound filter (within 1 array): fails', () => {


        expect(matchJavascriptObject<SpreadNested>(
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
            }
        )).toBe(false);
    });
    
})




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

    /*
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
    */