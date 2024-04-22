import { createDraft, produce } from "immer";
import _matchJavascriptObject, { ObjOrDraft } from "./matchJavascriptObject";
import { WhereFilterDefinition, isWhereFilterDefinition } from "./types";
import { standardTests } from "./standardTests";

async function matchJavascriptObject<T extends Record<string, any>>(object: ObjOrDraft<T>, filter: WhereFilterDefinition<T>):Promise<ReturnType<typeof _matchJavascriptObject>> {
    expect(isWhereFilterDefinition(filter)).toBe(true);
    return _matchJavascriptObject(object, filter);
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