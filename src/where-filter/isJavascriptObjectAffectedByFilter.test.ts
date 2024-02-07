import { isJavascriptObjectAffectedByFilter, isResultingJavascriptObjectAffectedByFilter } from "./isJavascriptObjectAffectedByFilter";



function expect(a:any, b:any, details?: string) {
    if( a!==b ) {
        debugger;
        throw new Error(`Failed test. Details: ${details || 'na'}`)
    }
}
export default function testIsJavascriptObjectAffectedByFilter() {
    

    expect(isJavascriptObjectAffectedByFilter(
        {
            person: {
                name: 'Andy',
                age: 100
            }
        },
        {
            'person.name': 'Andy'
        }
    ), true);


    expect(isJavascriptObjectAffectedByFilter(
        {
            person: {
                name: 'Bob',
                age: 100
            }
        },
        {
            'person.name': 'Andy'
        }
    ), true, "Still applies, because it affects how the object is filtered, even though the filter now fails.");


    expect(isJavascriptObjectAffectedByFilter(
        {
            person: {
                age: 100
            }
        },
        {
            'person.name': 'Andy'
        }
    ), false);

    expect(isResultingJavascriptObjectAffectedByFilter(
        {
            person: {
                age: 100
            }
        },
        {
            'person.name': 'Andy'
        },
        'merge'
    ), false);

    expect(isResultingJavascriptObjectAffectedByFilter(
        {
            person: {
                age: 100
            }
        },
        {
            'person.name': 'Andy'
        },
        'assign'
    ), true);

    

    console.log("Passed: isJavascriptObjectAffectedByFilter OK");
}