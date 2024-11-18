import { z } from "zod";
import { WriteAction } from "../../types";
import equivalentCreateOccurs from "./equivalentCreateOccurs";
import { DDL } from "../types";

describe('equivalentCreateOccurs', () => {

    const ObjSchema = z.object({
        id: z.string(),
        text: z.string().optional()
      }).strict();
      
    type Obj = z.infer<typeof ObjSchema>;

    const ddl:DDL<Obj> = {
        version: 1,
        lists: {
            '.': {
                primary_key: 'id'
            }
        },
        permissions: {
            type: 'none'
        }
    }

    test('equivalentCreateOccurs basic', () => {

        const actions:WriteAction<Obj>[] = [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'create',
                    data: {
                        id: '1',
                        'text': 'Wrong'
                    }
                }
            }
        ]

        const existing:Obj = {
            'id': '1',
            'text': 'Right'
        }

        expect(equivalentCreateOccurs(ObjSchema, ddl, existing, actions[0]!, actions)).toBe(false);

        // This action creates parity with the existing, allowing the create to work
        actions.push({
            type: 'write',
            ts: 0,
            uuid: '0',
            payload: {
                type: 'update',
                method: 'merge',
                data: {
                    text: 'Right'
                },
                where: {
                    id: '1'
                }
            }
        })

        
        expect(equivalentCreateOccurs(ObjSchema, ddl, existing, actions[0]!, actions)).toBe(true);

    })
})