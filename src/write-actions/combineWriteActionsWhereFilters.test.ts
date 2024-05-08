import { z } from "zod";
import combineWriteActionsWhereFilters from "./combineWriteActionsWhereFilters"
import { DDL } from "./applyWritesToItems";
import { WhereFilterDefinition } from "../where-filter";
import { assertArrayScope } from "./types";

describe('combineWriteActionsWhereFilters', () => {

    const ObjSchema = z.object({
        id: z.string(),
        text: z.string().optional(),
        children: z.array(z.object({
            cid: z.string(),
            age: z.number(),
            children: z.array(z.object({
                ccid: z.string()
            }))
        })).optional()
      }).strict();
      
    type Obj = z.infer<typeof ObjSchema>;

    const ddl:DDL<Obj> = {
        version: 1, 
        lists: {
            '.': {
                primary_key: 'id'
            },
            'children': {
                primary_key: 'cid'
            },
            'children.children': {
                primary_key: 'ccid'
            }
        }
    }

    test('combineWriteActionsWhereFilters basic create', () => {
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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

        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toEqual(
                {
                    id: '1'
                }
        )
    })

    test('combineWriteActionsWhereFilters basic update', () => {
        const where:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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

        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toEqual(where)
    })


    test('combineWriteActionsWhereFilters basic delete', () => {
        const where:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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

        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toEqual(where)
    });


    test('combineWriteActionsWhereFilters exclude delete', () => {
        const where:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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

        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toBe(undefined)
    });

    test('combineWriteActionsWhereFilters 2x update', () => {
        const where1:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '1'},
                {id: '2'}
            ]
        }
        const where2:WhereFilterDefinition<Obj> = {
            OR: [
                {id: '3'},
                {id: '4'}
            ]
        }
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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
                    where: where1
                }
            },
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
                    where: where2
                }
            }
        ]);

        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toEqual({
            OR: [
                where1,
                where2
            ]
        })
    })
    
    test('combineWriteActionsWhereFilters array scope create', () => {        
        const shouldBe:WhereFilterDefinition<Obj> = {
            AND: [
                {
                    id: '1'
                },
                {
                    children: {
                        elem_match: {
                            'cid': 'c1'
                        }
                    }
                }
            ]
        }
        
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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
                                age: 1,
                                children: []
                            }
                        },
                    where: {
                        id: '1'
                    }
                },
                
            }
        ]);
        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toEqual(shouldBe)

    });
    

    test('combineWriteActionsWhereFilters array scope update', () => {        
        const shouldBe:WhereFilterDefinition<Obj> = {
            "OR": [
                {
                    "AND": [
                        {
                            "id": "1"
                        },
                        {
                            "children": {
                                "elem_match": {
                                    "cid": "c1"
                                }
                            }
                        }
                    ]
                },
                {
                    "AND": [
                        {
                            "id": "2"
                        },
                        {
                            "children": {
                                "elem_match": {
                                    "cid": "c2"
                                }
                            }
                        }
                    ]
                }
            ]
        }
        
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
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
                                age: 1,
                                children: []
                            }
                        },
                    where: {
                        id: '1'
                    }
                },
                
            },
            {
                type: 'write',
                ts: 0,
                uuid: '1',
                payload: assertArrayScope<Obj, 'children'>({
                    type: 'array_scope',
                    scope: 'children',
                    action: {
                            type: 'update',
                            data: {
                                age: 1
                            },
                            where: {
                                cid: 'c1'
                            }
                        },
                    where: {
                        id: '1'
                    }
                }),
            },
            {
                type: 'write',
                ts: 0,
                uuid: '1',
                payload: {
                    type: 'array_scope',
                    scope: 'children',
                    action: {
                            type: 'create',
                            data: {
                                cid: 'c2',
                                age: 1, 
                                children: []
                            }
                        },
                    where: {
                        id: '2'
                    }
                },
            }
        ]);
        expect(result.status).toBe('ok');if(result.status!=='ok') throw new Error('noop');
        expect(result.filter).toEqual(shouldBe)
        

    });

    test('combineWriteActionsWhereFilters fails bad key', () => {
        const result = combineWriteActionsWhereFilters(ObjSchema, ddl, [
            {
                type: 'write',
                ts: 0,
                uuid: '0',
                payload: {
                    type: 'create',
                    data: {
                        // @ts-ignore
                        unknown_key: '1',
                        children: []
                    }
                }
            }
        ]);

        expect(result.status).toBe('error');if(result.status!=='error') throw new Error('noop');
        expect(result.error.failed_actions[0].error_details[0].type).toBe('missing_key');
    })

})