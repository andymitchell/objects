import { z } from "zod"
import { MatchJavascriptObject, MatchJavascriptObjectInTesting } from "./types"


type StandardTestConfig = {
    test: jest.It, 
    expect: jest.Expect,
    matchJavascriptObject: MatchJavascriptObjectInTesting
}

const ContactSchema = z.object({
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

export function standardTests(testConfig:StandardTestConfig) {
    const {test, expect, matchJavascriptObject} = testConfig;

    
    
    test('Match name', async () => {
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
        
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    test('Ignore wrong name', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
    
    
    
    test('Match name and emailAddress', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    test('Do not match name (even though email address ok)', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    

    test('Match emailAddress (name irrelevant)', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    test('Match name because NOT being something else', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    

    test('Match age in range: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });


    test('Match age int range: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    test('Do not match age as greater', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    test('compares object: passes', async () => {

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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    
    test('compares object: fails', async () => {

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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
    


    test('Match a typical Formz View', async () => {
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
            },
            FormzSchema
        );
        
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    test('string contains', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    test('string not contains', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });


    test('nesting properties: passes', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    })

    test('nesting properties: fails 1', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    })


    test('nesting properties: fails 2', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    })

    

    test('multikey is AND: passes', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    test('multikey is AND: fails', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });


    test('multikey with logic: passes', async () => {

        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    test('multikey with logic: fails', async () => {

        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
    
    

    

    test('array equals true', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    test('array equals false', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    
    
    

    test('array element compound filter: passes', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    
    
    test('array element compound filter: fails', async () => {
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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    

    
    
    test('array element compound filter2: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    
    
    test('array element compound filter2: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    
    
    

    test('array element compound filter city+country infer OR: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    

    test('array element compound filter city+country infer OR: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    


    
    test('array element compound filter city+country: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
    

    

    test('array element compound filter explicit AND behaves like elem_match: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    


    test('array element compound filter explict AND behaves like elem_match: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    
    
    
    test('array element compound filter explicit OR: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    

    test('array element compound filter explicit OR: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
    
    
    
    test('array element compound filter NOT: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });



    test('array element compound filter NOT partial (allowed because NYC ok): passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });


    test('array element compound filter NOT: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    
    

    
    


    test('array element elem_match (must be all in one element) city+country: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    

    

    test('array element elem_match (must be all in one element) city+country: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    

    test('array element elem_match (must be all in one element) city+country infer AND: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    test('array element elem_match (must be all in one element) city+country infer AND: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    

    test('array element elem_match (must be all in one element) city+country infer AND and contains: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    
    

    test('array element elem_match (must be all in one element) city+country infer AND and contains: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    
    

    test('array element elem_match (must be all in one element) number: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    test('array element elem_match (must be all in one element) number: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    
    test('array nesting: passes', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    

    

    test('array nesting: fails', async () => {
        const result = await matchJavascriptObject(
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
            },
            ContactSchema
        );
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
    
    

    test('array spread-nesting: passes', async () => {

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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });

    
    test('array spread-nesting: fails', async () => {


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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });

    

    test('array spread-nesting where first path is not the target: passes', async () => {

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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });



    test('array spread-nesting written nested: passes', async () => {


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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });


    test('array spread-nesting written nested: fails', async () => {


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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });


    test('array spread-nesting multi criteria compound filter (within 1 array): passes', async () => {


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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(true);
    });
    

    test('array spread-nesting multi criteria compound filter (within 1 array): fails', async () => {


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
        if(result===undefined) {console.warn('Skipping'); return;} // indicates not supported 
		expect(result).toBe(false);
    });
}