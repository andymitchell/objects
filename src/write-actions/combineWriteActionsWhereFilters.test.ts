import { z } from "zod";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters"
import { DDL } from "./applyWritesToItems";
import { WhereFilterDefinition } from "../where-filter";

describe('combineWriteActionsWhereFilters', () => {

    const ObjSchema = z.object({
        id: z.string(),
        text: z.string().optional(),
        children: z.array(z.object({
            cid: z.string(),
            children: z.array(z.object({
                ccid: z.string()
            }))
        }))
      }).strict();
      
    type Obj = z.infer<typeof ObjSchema>;

    const ddl:DDL<Obj> = {
        '.': {
            version: 1,
            primary_key: 'id'
        },
        'children': {
            version: 1,
            primary_key: 'cid'
        },
        'children.children': {
            version: 1,
            primary_key: 'ccid'
        }
    }

    test('combineWriteActionsWhereFilters basic create', () => {
        const filter = combineWriteActionsWhereFilters(ObjSchema, ddl, [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'create',
                    data: {
                        id: '1',
                        children: []
                    }
                }
            }
        ]);

        expect(filter).toEqual({
            OR: [
                {
                    id: '1'
                }
            ]
        })
    })

    test('combineWriteActionsWhereFilters basic update', () => {
        const where:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const filter = combineWriteActionsWhereFilters(ObjSchema, ddl, [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'update',
                    method: 'merge',
                    data: {
                        text: 'hello'
                    },
                    where
                }
            }
        ]);

        expect(filter).toEqual({
            OR: [
                where
            ]
        })
    })


    test('combineWriteActionsWhereFilters basic delete', () => {
        const where:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const filter = combineWriteActionsWhereFilters(ObjSchema, ddl, [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'delete',
                    where
                }
            }
        ]);

        expect(filter).toEqual({
            OR: [
                where
            ]
        })
    });


    test('combineWriteActionsWhereFilters exclude delete', () => {
        const where:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const filter = combineWriteActionsWhereFilters(ObjSchema, ddl, [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'delete',
                    where
                }
            }
        ], false);

        expect(filter).toBe(undefined)
    });

    
    test('combineWriteActionsWhereFilters array scope', () => {
        console.warn("TODO combineWriteActionsWhereFilters array scope: it needs a better syntax implementing, and for ts to support array nesting")
        
        
        const filter = combineWriteActionsWhereFilters(ObjSchema, ddl, [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'array_scope',
                    scope: 'children',
                    action: {
                            type: 'create',
                            data: {
                                'cid': 'c1',
                                children: []
                            }
                        },
                    where: {
                        id: '1'
                    }
                },
                
            }
        ]);
        debugger;

        /*
        const shouldBe:WhereFilterDefinition<Obj> = {
            'OR': [
                {
                    'children': {
                        contains: {
                            cid: 'c1'
                        }
                    },
                }
            ]
        }

        expect(filter).toEqual(shouldBe)
        */
    });
    

    

})