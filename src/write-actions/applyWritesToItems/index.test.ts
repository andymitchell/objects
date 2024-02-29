import applyWritesToItems from ".";
import { WriteAction, WriteActionPayload, WriteActionPayloadArrayScope } from "../types";
import { DDL } from "./types";

describe('applyWritesToItems test', () => {
    test('empty', () => {
        expect(true).toBe(true);
    })
    
    type Obj = {
        id: string,
        text?: string,
        children?: {cid: string, children: {ccid: string}[]}[]
    }

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
            ], 
            [
                obj1
            ], 
            ddl
        );

        
        
        expect(
            result.added[0]
        ).toEqual(obj2);

        expect(
            result.final_items[1]
        ).toEqual(obj2);

        expect(
            result.final_items.length
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
            ddl
        );

        expect(
            result.updated[0]
        ).toEqual({...obj1, text: 'T1'});

        expect(
            result.final_items[0]
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
            ddl
        );

        expect(
            result.deleted.length
        ).toEqual(1);

        expect(
            result.final_items.length
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
            ddl
        );
        
       

        expect(
            result.final_items[0].children![0].children[0].ccid
        ).toEqual('cc1');


        expect(
            result.final_items[0].children![0].children.length
        ).toEqual(1);

    });
    
});