import { z } from "zod";
import applyWritesToItems from ".";
import { WriteAction, WriteActionPayload, WriteActionPayloadArrayScope } from "../types";
import { ApplyWritesToItemsOptions, DDL } from "./types";


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

    function testImmutableAndImmerOptimisedModes<T extends Record<string, any> = Obj>(callback:(name: 'immutable' | 'mutable', options:ApplyWritesToItemsOptions<T>) => void) {
        callback("immutable", {});
        callback("mutable", {immer_optimized: true});
    }
    

    testImmutableAndImmerOptimisedModes((name, options) => {
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
    
    testImmutableAndImmerOptimisedModes((name, options) => {
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

    testImmutableAndImmerOptimisedModes((name, options) => {
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
    
    testImmutableAndImmerOptimisedModes((name, options) => {
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
                    actions: [
                        {
                            type: 'write',
                            ts: 0,
                            uuid: '0',
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

    testImmutableAndImmerOptimisedModes((name, options) => {
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
    

    testImmutableAndImmerOptimisedModes((name, options) => {
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
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            // @ts-ignore wilfully breaking schema here 
                            none_key: 'T1'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'create',
                        data: {
                            id: 'a2',
                            text: 'bob'
                        }
                    }},
                    {type: 'write', ts: 0, uuid: '0', payload: {
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
                ddl,
                options
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
            expect(secondFailedAction.action.payload.type).toBe('update'); if( secondFailedAction.action.payload.type!=='update' ) throw new Error("noop - update");
            // @ts-ignore wilfully breaking schema here 
            expect(secondFailedAction.action.payload.data.none_key).toBe('T2');

            expect(secondFailedAction.affected_items.length).toBe(2);
            expect(secondFailedAction.affected_items[0].item.id).toBe('a1');
            expect(secondFailedAction.affected_items[1].item.id).toBe('a2');
        });
    });

    testImmutableAndImmerOptimisedModes((name, options) => {
        test(`rolls back failed items [${name}]`, () => {

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
                    {type: 'write', ts: 0, uuid: '0', payload: {
                        type: 'delete',
                        where: {id: obj1.id}
                    }},
                    {type: 'write', ts: 0, uuid: '0', payload: {
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
            
            expect(originalItems.length).toBe(1);
            expect(originalItems[0].id).toBe(obj1.id);
            expect(originalItems[0]===obj1Ref).toBe(true);
        });
    });

    testImmutableAndImmerOptimisedModes((name, options) => {
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

    testImmutableAndImmerOptimisedModes((name, options) => {
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
            {immer_optimized: false}
        );

        const resultImmer = applyWritesToItems<Obj>(
            actions, 
            originalItemsImmer, 
            ObjSchema,
            ddl,
            {immer_optimized: true}
        );
        
        expect(resultNonImmer.status).toBe('ok'); if( resultNonImmer.status!=='ok' ) throw new Error("noop");
        expect(resultImmer.status).toBe('ok'); if( resultImmer.status!=='ok' ) throw new Error("noop");

        expect(resultNonImmer.changes.final_items===originalItemsNonImmer).toBe(false);
        expect(resultImmer.changes.final_items===originalItemsImmer).toBe(true); // In immer mode, expected to run this inside produce, so the array doesn't get replaced - it mutates.

        expect(resultNonImmer.changes.final_items[1]===originalItemsNonImmer[1]).toBe(false);
        expect(resultImmer.changes.final_items[1]===originalItemsImmer[1]).toBe(true); // It has mutated the array, so the pointers are the same (objects changed in both)
        expect(resultImmer.changes.final_items[1]===obj2RefImmer).toBe(false); // But the object IS different to the original it started from 
        
        
    });
    

    testImmutableAndImmerOptimisedModes((name, options) => {
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



    testImmutableAndImmerOptimisedModes((name, options) => {
        test(`not allowed to change primary key [${name}]`, () => {

            const originalItems = [structuredClone(obj1)];
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
                            id: 'a2'
                        },
                        where: {
                            id: 'a1'
                        }
                    }},
                ], 
                originalItems, 
                ObjSchema,
                ddl,
                options
            );
            

            expect(result.status).toBe('error'); if( result.status!=='error' ) throw new Error("noop");
            const firstFailedAction = result.error.failed_actions[0];
            expect(firstFailedAction.action.payload.type).toBe('update'); if( firstFailedAction.action.payload.type!=='update' ) throw new Error("noop - update");
            expect(firstFailedAction.affected_items[0].item.id).toBe('a1');
            expect(firstFailedAction.affected_items[0].error_details[0].type).toBe('update_altered_key');
            expect(firstFailedAction.unrecoverable).toBe(true);
            
            // Make sure when there's an error, it doesn't change the original items 
            expect(originalItems[0].id).toBe(obj1.id);
            expect(originalItems.length).toBe(1);

        });
    });

    testImmutableAndImmerOptimisedModes((name, options) => {
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

            actions.push({
                type: 'write',
                ts: 0,
                uuid: '0',
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

            const result2 = applyWritesToItems<Obj>(
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

    testImmutableAndImmerOptimisedModes((name, options) => {
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

    testImmutableAndImmerOptimisedModes((name, options) => {
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
    
});