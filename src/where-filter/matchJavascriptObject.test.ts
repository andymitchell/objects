import { createDraft } from "immer";
import matchJavascriptObjectReal, { type ObjOrDraft } from "./matchJavascriptObject.js";
import { type WhereFilterDefinition } from "./types.js";
import { standardTests } from "./standardTests.js";
import { isWhereFilterDefinition } from "./schemas.ts";

async function matchJavascriptObject<T extends Record<string, any>>(object: ObjOrDraft<T>, filter: WhereFilterDefinition<T>):Promise<ReturnType<typeof matchJavascriptObjectReal>> {
    expect(isWhereFilterDefinition(filter)).toBe(true);
    const result = matchJavascriptObjectReal(object, filter);
    return result;
}



describe('testMatchJavascriptObject', () => {
    
    standardTests({
        test,
        expect,
        matchJavascriptObject
    })

    test('Immer - Match name', async () => {

        const obj = {
            contact: {
                name: 'Andy',
                emailAddress: 'andy@andy.com'
            }
        };

        const draft = createDraft(obj);
        const result = await matchJavascriptObject(
            draft,
            {
                'contact.name': 'Andy'
            }
        )

        expect(result).toBe(true);
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