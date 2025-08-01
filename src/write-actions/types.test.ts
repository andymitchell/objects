import { z } from "zod";
import type { WriteAction, WriteActionPayloadArrayScope } from "./types.js";
import { makeWriteActionSchema } from "./write-action-schemas.ts";


describe('write-actions type check', () => {
    // This is primarily just a type file for convenience to see if typeCheck's code flags type errors
    // It has just one schema, but two types (one matching: Real; and one non-matching: Fake). Fake should fail schema tests.
    test('basic', () => {
        

        // Example usage
        const schema = z.object({
            id: z.string(),
            text: z.string(),
            sub_tasks: z.array(z.object({
                text: z.string(),
                siblings: z.array(z.object({
                    id: z.string(), 
                    text: z.string()
                }))
            })),
            owner: z.object({
                age: z.number(),
                name: z.string(),
            }),
        });

        const writeActionSchema = makeWriteActionSchema(schema);

        type Real = { id: string, text: string, owner: { age: number, name: string }, sub_tasks: { text: string, siblings: {id:string, text:string}[] }[] };
        type Fake = { id: string, rext: string, owner: { age: number, name: string }, bub_sasks: { text: string, riblings: {id:string, text:string}[] }[] };
        const actionA: WriteAction<Real> = {
            type: 'write',
            ts: Date.now(),
            uuid: '1',
            payload: {
                type: 'update',
                method: 'merge',
                data: { text: 'bob' },
                where: {
                    id: 'bob'
                }
            }
        }
        const actionBPayload: WriteActionPayloadArrayScope<Real, 'sub_tasks.siblings'> = {
            type: "array_scope",
            scope: 'sub_tasks.siblings',
            action: {
                        type: 'update',
                        method: 'merge',
                        data: {
                            text: 'bob'
                        },
                        where: {
                            id: '1'
                        }
                },
                where: {
                    id: '1'
                }
        }
        const actionB: WriteAction<Real> = {
            type: 'write', 
            ts: Date.now(),
            uuid: '1',
            payload: actionBPayload
        }


        const actionFakeA: WriteAction<Fake> = {
            type: 'write',
            ts: Date.now(),
            uuid: '1',
            payload: {
                type: 'update',
                method: 'merge',
                data: { rext: 'bob' },
                where: {
                    id: 'bob'
                }
            }
        }


        const actionFakeBPayload: WriteActionPayloadArrayScope<Fake, 'bub_sasks.riblings'> = {
            type: "array_scope",
            scope: 'bub_sasks.riblings',
            action: {
                type: 'update',
                method: 'merge',
                data: {
                    text: 'bob'
                },
                where: {
                    id: '1'
                }
            },
            where: {}
        }

        const actionFakeB: WriteAction<Fake> = {
            type: 'write', 
            ts: Date.now(),
            uuid: '1',
            payload: actionFakeBPayload
        }

        
        type RealOptional = { id: string, text: string, owner: { age: number, name: string }, sub_tasks?: { text: string, siblings: {id:string, text:string}[] }[] };
        const actionCPayload: WriteActionPayloadArrayScope<RealOptional, 'sub_tasks.siblings'> = {
            type: "array_scope",
            scope: 'sub_tasks.siblings',
            action: {
                type: 'create',
                data: {
                    id: '1',
                    text: 'bob'
                }
            },
            where: {}
        }
        


        expect(writeActionSchema.safeParse(actionA).success).toBe(true); // Expect OK
        expect(writeActionSchema.safeParse(actionB).success).toBe(true); // Expect OK
        expect(writeActionSchema.safeParse(actionFakeA).success).toBe(false); // Expect fail
        expect(writeActionSchema.safeParse(actionFakeB).success).toBe(false); // Expect fail
        
    })
})

