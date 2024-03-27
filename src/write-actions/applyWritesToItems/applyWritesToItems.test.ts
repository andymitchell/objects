import { z } from "zod";
import applyWritesToItems from ".";
import { WriteAction, WriteActionPayload, WriteActionPayloadArrayScope } from "../types";
import { DDL } from "./types";

describe('applyWritesToItems test', () => {
    
    
    const ObjSchema = z.object({
        id: z.string(),
        text: z.string().optional(),
        children: z.array(
          z.object({
            cid: z.string(),
            children: z.array(
              z.object({
                ccid: z.string(),
              }).strict()
            ),
          }).strict()
        ).optional(),
      }).strict();
      
    type Obj = z.infer<typeof ObjSchema>;
    /*{
        id: string,
        text?: string,
        children?: {cid: string, children: {ccid: string}[]}[]
    }*/

    const ddl:DDL<Obj> = {
        '.': {
            version: 1,
            primary_key: 'id'
        },
        'children': {
            version: 1,
            primary_key: 'cid',
        },
        'children.children': {
            version: 1,
            primary_key: 'ccid'
        }
    }

    const obj1:Obj = {
        id: '1'
    };
    const obj2:Obj = {
        id: '2'
    };
    
    const makeWrite = (payload:WriteActionPayload<Obj>) => {
        return {
            type: 'write',
            ts: 0,
            payload
        }
    }
    
    
    test('create', () => {

        const data2 = JSON.parse(JSON.stringify(obj2)); //structuredClone(obj2);

        const result = applyWritesToItems<Obj>(
            [
                {
                    type: 'write', 
                    ts: 0,
                    payload: {
                        type: 'create',
                        data: data2
                    }
                }
            ]
            ,
            [
                obj1
            ], 
            ObjSchema,
            ddl
        );

        
        expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
        expect(
            result.changes.added[0]
        ).toEqual(obj2);

        
        expect(
            result.changes.final_items[1]
        ).toEqual(obj2);

        expect(
            result.changes.final_items.length
        ).toEqual(2);
        
    });

    

    test('update', () => {

        const result = applyWritesToItems<Obj>(
            [
                {type: 'write', ts: 0, payload: {
                    type: 'update',
                    method: 'merge',
                    data: {
                        text: 'T1'
                    },
                    where: {
                        id: '1'
                    }
                }}
            ], 
            [
                structuredClone(obj1)
            ], 
            ObjSchema,
            ddl
        );

        expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
        expect(
            result.changes.updated[0]
        ).toEqual({...obj1, text: 'T1'});

        expect(
            result.changes.final_items[0]
        ).toEqual({...obj1, text: 'T1'});
    });

    test('delete', () => {
        const result = applyWritesToItems<Obj>(
            [
                {type: 'write', ts: 0, payload: {
                    type: 'delete',
                    where: {
                        id: '1'
                    }
                }}
            ], 
            [
                structuredClone(obj1)
            ], 
            ObjSchema,
            ddl
        );

        expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
        expect(
            result.changes.deleted.length
        ).toEqual(1);

        expect(
            result.changes.final_items.length
        ).toEqual(0);
    });
    

    test('array_scoped create (existing structure in place) ', () => {

        const objWithChildren:Obj = {
            id: 'p1',
            children: [
                {
                    cid: 'c1',
                    children: []
                }
            ]
        }
        
        
        const payload:WriteActionPayloadArrayScope<Obj, 'children.children'> = {
            
                type: 'array_scope',
                scope: 'children.children',
                actions: [
                    {
                        type: 'write',
                        ts: 0,
                        payload: {
                            type: 'create',
                            data: {
                                ccid: 'cc1'
                            }
                        }
                    }
                ]
            
        }
        const result = applyWritesToItems<Obj>(
            [
                {
                    type: 'write',
                    ts: 0,
                    payload
                }
            ], 
            [
                objWithChildren
            ], 
            ObjSchema,
            ddl
        );
        
       
        
        expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
        expect(
            result.changes.final_items[0].children![0].children[0].ccid
        ).toEqual('cc1');


        expect(
            result.changes.final_items[0].children![0].children.length
        ).toEqual(1);

    });

    
    test('update break schema', () => {

        const result = applyWritesToItems<Obj>(
            [
                {type: 'write', ts: 0, payload: {
                    type: 'update',
                    method: 'merge',
                    data: {
                        // @ts-ignore wilfully breaking schema here 
                        none_key: 'T1'
                    },
                    where: {
                        id: '1'
                    }
                }}
            ], 
            [
                structuredClone(obj1)
            ], 
            ObjSchema,
            ddl
        );

        expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
        const failedActionItem = result.error.failed_actions[0].affected_items[0];
        expect(
            failedActionItem.item
        ).toEqual({...obj1, none_key: 'T1'});
    });
    

    test('identify failed actions', () => {

        // Add 2 writes that should work, at position 0 and 2 
        // Have 2 failing updates, at 1 and 3
        // Failing update 1 should affect 2 items

        const result = applyWritesToItems<Obj>(
            [
                {type: 'write', ts: 0, payload: {
                    type: 'create',
                    data: {
                        id: 'a1',
                        text: 'bob'
                    }
                }},
                {type: 'write', ts: 0, payload: {
                    type: 'create',
                    data: {
                        // @ts-ignore wilfully breaking schema here 
                        none_key: 'T1'
                    }
                }},
                {type: 'write', ts: 0, payload: {
                    type: 'create',
                    data: {
                        id: 'a2',
                        text: 'bob'
                    }
                }},
                {type: 'write', ts: 0, payload: {
                    type: 'update',
                    method: 'merge',
                    data: {
                        // @ts-ignore wilfully breaking schema here 
                        none_key: 'T2'
                    },
                    where: {
                        text: 'bob'
                    }
                }},
            ], 
            [
                structuredClone(obj1)
            ], 
            ObjSchema,
            ddl
        );
        

        expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
        const firstFailedAction = result.error.failed_actions[0];
        expect(firstFailedAction.action.payload.type).toBe('create'); if( firstFailedAction.action.payload.type!=='create' ) throw new Error("noop - create");
        // @ts-ignore wilfully breaking schema here 
        expect(firstFailedAction.action.payload.data.none_key).toBe('T1');
        // @ts-ignore wilfully breaking schema here 
        expect(firstFailedAction.affected_items[0].item.none_key).toBe('T1');
        expect(firstFailedAction.affected_items[0].error_details[0].type).toBe('missing_key');
        
        const secondFailedAction = result.error.failed_actions[1];
        expect(secondFailedAction.action.payload.type).toBe('update'); if( secondFailedAction.action.payload.type!=='update' ) throw new Error("noop - update");
        // @ts-ignore wilfully breaking schema here 
        expect(secondFailedAction.action.payload.data.none_key).toBe('T2');

        expect(secondFailedAction.affected_items.length).toBe(2);
        expect(secondFailedAction.affected_items[0].item.id).toBe('a1');
        expect(secondFailedAction.affected_items[1].item.id).toBe('a2');
    });
    
    
});