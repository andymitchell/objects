import { z } from "zod";
import applyWritesToItems from ".";
import { WriteAction, WriteActionPayload, WriteActionPayloadArrayScope, assertArrayScope } from "../types";
import { ApplyWritesToItemsOptions, DDL } from "./types";
import { produce } from "immer";



describe('applyWritesToItems test', () => {
    
    
    const ObjSchema = z.object({
        id: z.string(),
        text: z.string().optional(),
        children: z.array(
          z.object({
            cid: z.string(),
            name: z.string().optional(),
            children: z.array(
              z.object({
                ccid: z.string(),
              }).strict()
            ),
          }).strict()
        ).optional(),
      }).strict();
      
    type Obj = z.infer<typeof ObjSchema>;

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

    function testImmutableAndnplaceModes<T extends Record<string, any> = Obj>(callback:(name: 'immutable' | 'inplace', options:ApplyWritesToItemsOptions<T>) => void) {
        callback("immutable", {});
        callback("inplace", {in_place_mutation: true});
    }
    
    
    testImmutableAndnplaceModes((name, options) => {
        test(`create [${name}]`, () => {

            const data2 = JSON.parse(JSON.stringify(obj2)); //structuredClone(obj2);

            const result = applyWritesToItems<Obj>(
                [
                    {
                        type: 'write', 
                        ts: 0,
                        uuid: '0',
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
                ddl,
                options
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
    })
    
    testImmutableAndnplaceModes((name, options) => {
        test(`update [${name}]`, () => {

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
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
                ddl,
                options
            );

            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            expect(
                result.changes.updated[0]
            ).toEqual({...obj1, text: 'T1'});

            expect(
                result.changes.final_items[0]
            ).toEqual({...obj1, text: 'T1'});
        });
    });

    testImmutableAndnplaceModes((name, options) => {
        test(`delete [${name}]`, () => {
            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
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
                ddl,
                options
            );

            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            expect(
                result.changes.deleted.length
            ).toEqual(1);

            expect(
                result.changes.final_items.length
            ).toEqual(0);
        });
    });
    
    testImmutableAndnplaceModes((name, options) => {
        test(`array_scoped create (existing structure in place)  [${name}]`, () => {

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
                    action: {
                            type: 'create',
                            data: {
                                ccid: 'cc1'
                            }
                        
                        },
                    where: {
                        id: 'p1'
                    }
                
            }
            const result = applyWritesToItems<Obj>(
                [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload
                    }
                ], 
                [
                    objWithChildren
                ], 
                ObjSchema,
                ddl,
                options
            );
            
            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            expect(
                result.changes.final_items[0].children![0].children[0].ccid
            ).toEqual('cc1');


            expect(
                result.changes.final_items[0].children![0].children.length
            ).toEqual(1);

        });
    });

    testImmutableAndnplaceModes((name, options) => {
        test(`update break schema [${name}]`, () => {

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
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
                ddl,
                options
            );

            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            const failedActionItem = result.error.failed_actions[0].affected_items[0];
            expect(
                failedActionItem.item
            ).toEqual({...obj1, none_key: 'T1'});
        });
    });
    

    testImmutableAndnplaceModes((name, options) => {
        test(`identify failed actions [${name}]`, () => {

            // Add 2 writes that should work, at position 0 and 2 
            // Have 2 failing updates, at 1 and 3
            // Failing update 1 should affect 2 items

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a1',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '1', payload: {
                        type: 'create',
                        data: {
                            // @ts-ignore wilfully breaking schema here 
                            none_key: 'T1'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '2', payload: {
                        type: 'create',
                        data: {
                            id: 'a2',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '3', payload: {
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
                    {type: 'write', ts: 0, uuid: '4', payload: {
                        type: 'create',
                        data: {
                            id: 'a3',
                            text: 'bob'
                        }
                    }},
                ], 
                [
                    structuredClone(obj1)
                ], 
                ObjSchema,
                ddl,
                Object.assign({
                    allow_partial_success: true
                }, options)
                
            );
            

            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            const firstFailedAction = result.error.failed_actions[0];
            expect(firstFailedAction.action.payload.type).toBe('create'); if( firstFailedAction.action.payload.type!=='create' ) throw new Error("noop - create");
            // @ts-ignore wilfully breaking schema here 
            expect(firstFailedAction.action.payload.data.none_key).toBe('T1');
            // @ts-ignore wilfully breaking schema here 
            expect(firstFailedAction.affected_items[0].item.none_key).toBe('T1');
            expect(firstFailedAction.affected_items[0].error_details[0].type).toBe('missing_key');
            expect(firstFailedAction.unrecoverable).toBe(true);


            const secondFailedAction = result.error.failed_actions[1];
            expect(secondFailedAction.action.payload.type).toBe('create'); if( secondFailedAction.action.payload.type!=='create' ) throw new Error("noop - create");
            // @ts-ignore wilfully breaking schema here 
            expect(secondFailedAction.blocked_by_action_uuid).toBe('1');
            
            const thirdFailedAction = result.error.failed_actions[2];
            expect(thirdFailedAction.action.payload.type).toBe('update'); if( thirdFailedAction.action.payload.type!=='update' ) throw new Error("noop - update");
            // @ts-ignore wilfully breaking schema here 
            expect(thirdFailedAction.action.payload.data.none_key).toBe('T2');
            expect(thirdFailedAction.affected_items.length).toBe(0);

            // Now check that it partially succeeded
            expect(result.changes.added.length).toBe(1);
            expect(result.changes.added[0].id).toBe('a1');
            expect(result.changes.final_items.length).toBe(2);
            expect(result.changes.final_items[0].id).toBe('1');
            expect(result.changes.final_items[1].id).toBe('a1');

            expect(result.successful_actions.length).toEqual(1);
            expect(result.successful_actions[0].action.uuid).toEqual('0');
            expect(result.successful_actions[0].affected_items.length).toEqual(1);
            expect(result.successful_actions[0].affected_items[0].item_pk).toEqual('a1');

            
        });
    });

    testImmutableAndnplaceModes((name, options) => {
        test(`multiple affected items on success [${name}]`, () => {

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'update',
                        data: {
                            text: 'Alice',
                        },
                        where: {
                            text: 'Bob'
                        }
                    }},
                ], 
                [
                    {
                        id: '1',
                        text: 'Bob'
                    },
                    {
                        id: '2',
                        text: 'Bob'
                    },
                    {
                        id: '3',
                        text: 'Alice'
                    }
                ], 
                ObjSchema,
                ddl,
                Object.assign({
                    allow_partial_success: false
                }, options)
                
            );
            

            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            
            expect(result.successful_actions.length).toEqual(1);
            expect(result.successful_actions[0].action.uuid).toEqual('0');
            expect(result.successful_actions[0].affected_items.length).toEqual(2);
            expect(result.successful_actions[0].affected_items[0].item_pk).toEqual('1');
            expect(result.successful_actions[0].affected_items[1].item_pk).toEqual('2');
            expect(result.changes.final_items.every(x => x.text==='Alice')).toBe(true);

            
        });
    });


    testImmutableAndnplaceModes((name, options) => {
        test(`completely rolls back on failed actions with allow_partial_success=false [${name}]`, () => {

            const originalItems = [
                structuredClone(obj1)
            ];
            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a1',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '1', payload: {
                        type: 'create',
                        data: {
                            // @ts-ignore wilfully breaking schema here 
                            none_key: 'T1'
                        }
                    }}
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                Object.assign({
                    allow_partial_success: false
                }, options)
                
            );
            
            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");

            // Now check that it failed
            expect(result.changes.added.length).toBe(0);
            expect(result.changes.final_items.length).toBe(1);
            expect(result.changes.final_items[0].id).toBe('1');
            expect(result.changes.final_items===originalItems).toBe(true);
            expect(result.changes.final_items).toEqual(originalItems);
            expect(result.successful_actions.length).toBe(0);

            
        });
    });

    testImmutableAndnplaceModes((name, options) => {
        test(`rolls back failed items partially with allow_partial_success===true [${name}]`, () => {

            const originalItems = [
                structuredClone(obj1)
            ];

            const obj1Ref = originalItems[0];

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a1',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '1', payload: {
                        type: 'delete',
                        where: {id: obj1.id}
                    }},
                    {type: 'write', ts: 0, uuid: '2', payload: {
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
                originalItems, 
                ObjSchema,
                ddl,
                options
            );
            
            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            
            
            expect(result.changes.final_items.length).toBe(1);
            expect(result.changes.final_items[0].id).toBe('a1');

            expect(result.error.failed_actions.length).toBe(1);
            expect(result.successful_actions.length).toBe(2);
        });
    });

    

    testImmutableAndnplaceModes((name, options) => {
        test(`handles failure on array_scope, with allow_partial_success=true [${name}]`, () => {

            const originalItems:Obj[] = [
                {
                    id: '1',
                    children: [
                        {cid: '1', children:[]}
                    ]
                }
            ];
            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: assertArrayScope<Obj, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: {
                            type: 'update',
                            method: 'merge',
                            data: {
                                name: 'Bob'
                            },
                            where: {
                                cid: '1'
                            }
                        },
                        where: {
                            id: '1'
                        }
                    })},
                    {type: 'write', ts: 0, uuid: '1', payload: {
                        type: 'array_scope',
                        scope: 'children',
                        action: {
                            type: 'create',
                            data: {
                                // @ts-ignore
                                bad_key: 'expect fail'
                            }
                        },
                        where: {
                            id: '1'
                        }
                    }}
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                Object.assign({
                    allow_partial_success: true
                }, options)
                
            );
            
            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            

            // Now check that it failed
            expect(result.changes.updated.length).toBe(1);
            expect(result.changes.updated[0].id).toBe('1');
            expect(result.changes.final_items.length).toBe(1);
            expect(result.changes.final_items[0].id).toBe('1');
            expect(result.changes.final_items[0].children![0].name).toBe('Bob'); // update applied
            // @ts-ignore
            expect(result.error.failed_actions[0].affected_items[0].item.bad_key).toBe('expect fail');
            
        });
    });
    


    testImmutableAndnplaceModes((name, options) => {
        test(`handles failure on array_scope, with allow_partial_success=false [${name}]`, () => {
            name;
            const originalItems:Obj[] = [
                {
                    id: '1',
                    children: [
                        {cid: '1', children:[]}
                    ]
                }
            ];
            const originalItemsClone = structuredClone(originalItems);

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: assertArrayScope<Obj, 'children'>({
                        type: 'array_scope',
                        scope: 'children',
                        action: {
                            type: 'update',
                            method: 'merge',
                            data: {
                                name: 'Bob'
                            },
                            where: {
                                cid: '1'
                            }
                        },
                        where: {
                            id: '1'
                        }
                    })},
                    {type: 'write', ts: 0, uuid: '1', payload: {
                        type: 'array_scope',
                        scope: 'children',
                        action: {
                            type: 'create',
                            data: {
                                // @ts-ignore
                                bad_key: 'expect fail'
                            }
                        },
                        where: {
                            id: '1'
                        }
                    }}
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                Object.assign({
                    allow_partial_success: false
                }, options)
                
            );
            
            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            

            // Now check that it failed, and nothing is changed
            expect(result.changes.updated.length).toBe(0);
            expect(result.changes.final_items.length).toBe(1);
            expect(result.changes.final_items[0].id).toBe('1');
            expect(!result.changes.final_items[0].children![0].name).toBe(true);
            expect(result.changes.final_items).toEqual(originalItemsClone);

        });
    });

    
    testImmutableAndnplaceModes((name, options) => {
        test(`react-friendly shallow references [${name}]`, () => {
            name;

            const originalItems = [
                structuredClone(obj1),
                structuredClone(obj2)
            ];

            const obj1Ref = originalItems[0];
            const obj2Ref = originalItems[1];

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a1',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'update',
                        method: 'merge',
                        data: {
                            text: 'sue'
                        },
                        where: {
                            id: obj2.id
                        }
                    }},
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                options
            );
            
            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            
            expect(result.changes.final_items[0]===obj1Ref).toBe(true);
            expect(result.changes.final_items[1]===obj2Ref).toBe(false);
            
        });
    });

    testImmutableAndnplaceModes((name, options) => {
        test(`react-friendly shallow references - no change [${name}]`, () => {

            const originalItems = [
                structuredClone(obj1)
            ];
            const obj1Ref = originalItems[0];

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'update',
                        method: 'merge',
                        data: {
                            text: 'sue'
                        },
                        where: {
                            id: 'never match'
                        }
                    }},
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                options
            );
            
            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            
            expect(result.changes.final_items===originalItems).toBe(true);
            expect(originalItems[0]===obj1Ref).toBe(true);
            
        });
    });
    
    test(`react-friendly shallow references for immer/non-immer array differences`, () => {

        const originalItemsNonImmer = [structuredClone(obj1), structuredClone(obj2)];
        const originalItemsImmer = structuredClone(originalItemsNonImmer);
        const obj2RefImmer = originalItemsImmer[1];
        
        const actions:WriteAction<Obj>[] = [
            {type: 'write', ts: 0, uuid: '0', payload: {
                type: 'create',
                data: {
                    id: 'a1'
                }
            }},
            {type: 'write', ts: 0, uuid: '0', payload: {
                type: 'update',
                method: 'merge',
                data: {
                    text: 'sue'
                },
                where: {
                    id: obj2.id
                }
            }}
        ]

        const resultNonImmer = applyWritesToItems<Obj>(
            actions, 
            originalItemsNonImmer, 
            ObjSchema,
            ddl,
            {in_place_mutation: false}
        );

        const resultImmer = applyWritesToItems<Obj>(
            actions, 
            originalItemsImmer, 
            ObjSchema,
            ddl,
            {in_place_mutation: true}
        );
        
        expect(resultNonImmer.status).toBe('ok'); if( resultNonImmer.status!=='ok' ) throw new Error("noop");
        expect(resultImmer.status).toBe('ok'); if( resultImmer.status!=='ok' ) throw new Error("noop");

        expect(resultNonImmer.changes.final_items===originalItemsNonImmer).toBe(false);
        expect(resultImmer.changes.final_items===originalItemsImmer).toBe(true); // In immer mode, expected to run this inside produce, so the array doesn't get replaced - it mutates.

        expect(resultNonImmer.changes.final_items[1]===originalItemsNonImmer[1]).toBe(false);
        expect(resultImmer.changes.final_items[1]===originalItemsImmer[1]).toBe(true); // It has mutated the array, so the pointers are the same (objects changed in both)
        expect(resultImmer.changes.final_items[1]===obj2RefImmer).toBe(false); // But the object IS different to the original it started from 
        
        
    });
    

    testImmutableAndnplaceModes((name, options) => {
        test(`cannot dupe primary key [${name}]`, () => {

            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a1',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a1',
                            text: 'sue'
                        }
                    }},
                ], 
                [
                    structuredClone(obj1)
                ], 
                ObjSchema,
                ddl,
                options
            );
            

            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            
            const firstFailedAction = result.error.failed_actions[0];
            expect(firstFailedAction.unrecoverable).toBe(true);
            expect(firstFailedAction.affected_items[0].error_details[0].type).toBe('create_duplicated_key');
        });
    });



    testImmutableAndnplaceModes((name, options) => {
        test(`not allowed to change primary key [${name}]`, () => {

            const originalItems = [structuredClone(obj1)];
            const result = applyWritesToItems<Obj>(
                [
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'update',
                        method: 'merge',
                        data: {
                            id: 'a2'
                        },
                        where: {
                            id: obj1.id
                        }
                    }},
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                Object.assign(options, {allow_partial_success: true})
            );
            

            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            const firstFailedAction = result.error.failed_actions[0];
            expect(firstFailedAction.action.payload.type).toBe('update'); if( firstFailedAction.action.payload.type!=='update' ) throw new Error("noop - update");
            expect(firstFailedAction.affected_items[0].item.id).toBe('1');
            expect(firstFailedAction.affected_items[0].error_details[0].type).toBe('update_altered_key');
            expect(firstFailedAction.unrecoverable).toBe(true);
            
            // Make sure when there's an error, it doesn't change the original items 
            expect(originalItems[0].id).toBe(obj1.id);
            expect(result.changes.final_items[0].id).toBe(obj1.id);

        });
    });
    

    testImmutableAndnplaceModes((name, options) => {
        test(`attempt_recover_duplicate_create [${name}]`, () => {

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

            const result = applyWritesToItems<Obj>(
                actions, 
                [existing], 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true
                    },
                    options
                )
            );

            expect(result.status).toBe('error');

            // This action creates parity with the existing, allowing the create to work
            actions.push({
                type: 'write',
                ts: 0,
                uuid: '1',
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

            actions.push({
                type: 'write',
                ts: 0,
                uuid: '2',
                payload: {
                    type: 'update',
                    method: 'merge',
                    data: {
                        text: 'Right2'
                    },
                    where: {
                        id: '1'
                    }
                }
            })

            const existing2:Obj = {
                'id': '1',
                'text': 'Right'
            }

            const result2 = applyWritesToItems<Obj>(
                actions, 
                [existing2], 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true
                    },
                    options
                )
            );
            expect(result2.status).toBe('ok'); if( result2.status!=='ok' ) throw new Error("noop");
            expect(result2.changes.final_items[0].text).toBe('Right2');


            const result3 = applyWritesToItems<Obj>(
                actions, 
                [existing], 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: false
                    },
                    options
                )
            );
            expect(result3.status).toBe('error'); if( result3.status!=='error' ) throw new Error("noop");


        })
    });

    
    

    
    
    test('Immer compatible - change', async () => {

        const originalItems = [structuredClone(obj1), structuredClone(obj2)];
        
        const actions:WriteAction<Obj>[] = [
            {type: 'write', ts: 0, uuid: '0', payload: {
                type: 'create',
                data: {
                    id: 'a1'
                }
            }},
            {type: 'write', ts: 0, uuid: '0', payload: {
                type: 'update',
                method: 'merge',
                data: {
                    text: 'sue'
                },
                where: {
                    id: obj2.id
                }
            }}
        ]

        const finalItems = produce(originalItems, draft => {
            applyWritesToItems<Obj>(
                actions, 
                draft, 
                ObjSchema,
                ddl,
                {in_place_mutation: true}
            );
        });

        expect(finalItems===originalItems).toBe(false);
        expect(finalItems[0]===originalItems[0]).toBe(true);
        expect(finalItems[1]===originalItems[1]).toBe(false);
    })


    test('Immer compatible - 0 change', async () => {

        const originalItems = [structuredClone(obj1), structuredClone(obj2)];
        
        const actions:WriteAction<Obj>[] = [
            {type: 'write', ts: 0, uuid: '0', payload: {
                type: 'update',
                method: 'merge',
                data: {
                    text: 'sue'
                },
                where: {
                    id: 'no exist'
                }
            }}
        ]

        const finalItems = produce(originalItems, draft => {
            applyWritesToItems<Obj>(
                actions, 
                draft, 
                ObjSchema,
                ddl,
                {in_place_mutation: true}
            );
        });

        expect(finalItems===originalItems).toBe(true);
        expect(finalItems[0]===originalItems[0]).toBe(true);
        expect(finalItems[1]===originalItems[1]).toBe(true);
    })
    

});



/*

    testImmutableAndnplaceModes((name, options) => {
        test(`test accumulator [${name}]`, () => {

            const existing:Obj = {
                'id': '1',
                'text': 'Right'
            }

            const result = applyWritesToItems<Obj>(
                [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'create',
                            data: {
                                id: '2',
                                text: 'Too'
                            }
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
                                text: 'One-ahh'
                            },
                            where: {
                                id: '1'
                            }
                        }
                    }
                ], 
                [existing], 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true
                    },
                    options
                )
            );

            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");
            let accumulation = result.changes;
            

            // Run it again, with accumulator...
            const result2 = applyWritesToItems<Obj>(
                [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'update',
                            method: 'merge',
                            data: {
                                text: 'Too-ahh'
                            },
                            where: {
                                id: '2'
                            }
                        }
                    }
                ], 
                result.changes.final_items, 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true,
                        accumulator: accumulation
                    },
                    options
                )
            );

            expect(result2.status).toBe('ok'); if( result2.status!=='ok' ) throw new Error("noop");

            expect(result2.changes.final_items.length).toBe(2);
            expect(result2.changes.added.length).toBe(1);
            expect(result2.changes.added[0].text).toBe('Too-ahh');
            expect(result2.changes.updated.length).toBe(1);
            expect(result2.changes.updated[0].text).toBe('One-ahh');
            
            accumulation = result2.changes;

            // Run it again, with accumulator...
            const result3 = applyWritesToItems<Obj>(
                [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'delete',
                            where: {
                                id: '2'
                            }
                        }
                    }
                ], 
                result2.changes.final_items, 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true,
                        accumulator: accumulation
                    },
                    options
                )
            );

            expect(result3.status).toBe('ok'); if( result3.status!=='ok' ) throw new Error("noop");

            expect(result3.changes.final_items.length).toBe(1);
            expect(result3.changes.added.length).toBe(0);
            expect(result3.changes.deleted.length).toBe(1);
            expect(result3.changes.deleted[0].text).toBe('Too-ahh');
            expect(result3.changes.updated.length).toBe(1);
            expect(result3.changes.updated[0].text).toBe('One-ahh');


            accumulation = result3.changes;

            // Run it again, with accumulator...
            const result4 = applyWritesToItems<Obj>(
                [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'create',
                            data: {
                                id: '2',
                                text: 'Too-brr'
                            }
                        }
                    }
                ], 
                result3.changes.final_items, 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true,
                        accumulator: accumulation
                    },
                    options
                )
            );

            expect(result4.status).toBe('ok'); if( result4.status!=='ok' ) throw new Error("noop");

            expect(result4.changes.final_items.length).toBe(2);
            expect(result4.changes.added.length).toBe(1);
            expect(result4.changes.added[0].text).toBe('Too-brr');
            expect(result4.changes.deleted.length).toBe(0);
            expect(result4.changes.updated.length).toBe(1);
            expect(result4.changes.updated[0].text).toBe('One-ahh');


        })
    });

    testImmutableAndnplaceModes((name, options) => {
        test(`accumulator holds with no write actions [${name}]`, () => {
            const accumulation = {
                "added": [
                    {
                        "id": "2",
                        "text": "Too"
                    }
                ],
                "updated": [
                    {
                        "id": "1",
                        "text": "One-ahh"
                    }
                ],
                "deleted": [],
                "changed": true,
                "final_items": [
                    {
                        "id": "1",
                        "text": "One-ahh"
                    },
                    {
                        "id": "2",
                        "text": "Too"
                    }
                ]
            };

            const result = applyWritesToItems<Obj>(
                [], 
                [], 
                ObjSchema,
                ddl,
                Object.assign(
                    {
                        attempt_recover_duplicate_create: true,
                        accumulator: accumulation
                    },
                    options
                )
            );
            expect(result.status).toBe('ok'); if( result.status!=='ok' ) throw new Error("noop");

            expect(accumulation.added).toEqual(result.changes.added);
            expect(accumulation.updated).toEqual(result.changes.updated);
            expect(accumulation.deleted).toEqual(result.changes.deleted);
            expect(accumulation.changed).toEqual(result.changes.changed);

        })
    })
    */