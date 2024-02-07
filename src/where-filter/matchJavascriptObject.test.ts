import matchJavascriptObject from "./matchJavascriptObject";


function expect(a:any, b:any, details?: string) {
    if( a!==b ) {
        debugger;
        throw new Error(`Failed test. Details: ${details || 'na'}`)
    }
}
export default function testMatchJavascriptObject() {
    let error = '';
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
    ), true);

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
    ), false);

    
    
    try {
        matchJavascriptObject(
            {
                contact: {
                    name: 'Andy',
                    emailAddress: 'andy@andy.com'
                }
            },
            {
                AND: [
                    {
                        'contact.name': 'Andy',
                        'contact.emailAddress': 'andy@andy.com'
                    }
                ]
            }
        )
    } catch(e) {
        error = (e instanceof Error)? e.message : 'unknown error';
    }
    expect(!!error, true, error);
    
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
                    'contact.name': 'Andy'
                },
                {
                    'contact.emailAddress': 'andy@andy.com'
                }
            ]
        }
    ), true);


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
    ), false);

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
                    'contact.name': 'Bob',
                },
                {
                    'contact.emailAddress': 'andy@andy.com'
                }
            ]
        }
    ), true);


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
                    'contact.name': 'Bob',
                },
                {
                    'contact.emailAddress': 'bob@bob.com'
                }
            ]
        }
    ), false);


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
                    'contact.name': 'Andy',
                }
            ]
        }
    ), false);


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
    ), true);


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
    ), true);


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
    ), false);


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
    ), true);

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
    ), false);



    

    console.log("Passed: testMatchJavascriptObject OK");
}