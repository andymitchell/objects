import { z } from "zod";
import { WriteAction, createWriteActionSchema } from "./types";

describe('write-actions type check', () => {
    // This is just a type file for convenience to see if typeCheck's code flags type errors
    test('empty', () => {
        expect(true).toBe(true);
    })
})

function typeCheck() {
    


        // Example usage
        const schema = z.object({
            id: z.string(),
            text: z.string(),
            sub_tasks: z.array(z.object({
                text: z.string()
            })),
            owner: z.object({
                age: z.number(),
                name: z.string(),
            }),
        });

        const writeActionSchema = createWriteActionSchema(schema);

        type Real = {id: string, text:string, owner: {age: number, name: string}, sub_tasks: {text:string}[]};
        type Fake = {id: string, rext:string, owner: {age: number, name: string}, bub_sasks: {text:string}[]};
        const actionA:WriteAction<Real> = {
            type: 'write',
            ts: Date.now(), 
            payload: {
                type: 'update',
                method: 'merge', 
                data: {text: 'bob'},
                where: {
                    id: 'bob'
                }
            }
        }
        const actionB:WriteAction<Real> = {
            type: 'write',
            ts: Date.now(), 
            payload: {
                type: 'array_push',
                path: 'sub_tasks',
                value: {text: 'sue'},
                where: {
                    id: 'bob'
                }
            }
        }

        const actionFakeA:WriteAction<Fake> = {
            type: 'write',
            ts: Date.now(), 
            payload: {
                type: 'update',
                method: 'merge', 
                data: {rext: 'bob'},
                where: {
                    id: 'bob'
                }
            }
        }

        const actionFakeB:WriteAction<Fake> = {
            type: 'write',
            ts: Date.now(), 
            payload: {
                type: 'array_push',
                path: 'bub_sasks',
                value: {text: 'sue'},
                where: {
                    id: 'bob'
                }
            }
        }


        const resultA = writeActionSchema.writeAction.safeParse(actionA); // Expect OK
        const resultB = writeActionSchema.writeAction.safeParse(actionB); // Expect OK
        const resultFakeA = writeActionSchema.writeAction.safeParse(actionFakeA); // Expect fail
        const resultFakeB = writeActionSchema.writeAction.safeParse(actionFakeB); // Expect fail
}