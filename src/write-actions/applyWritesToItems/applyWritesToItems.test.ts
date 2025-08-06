
import { z } from "zod";

import { test } from 'vitest';
import type { WriteAction, WriteActionPayloadArrayScope } from "../types.js";
import { assertArrayScope } from "../types.js";
import type { ApplyWritesToItemsOptions, DDL } from "./types.js";
import { createDraft, finishDraft, original, produce, type Draft } from "immer";
import type { IUser } from "../auth/types.js";
import { applyWritesToItems } from "./applyWritesToItems.ts";





const ObjSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    owner: z.string().optional(),
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

const ddl: DDL<Obj> = {
    version: 1,
    lists: {
        '.': {
            primary_key: 'id'
        },
        'children': {
            primary_key: 'cid',
        },
        'children.children': {
            primary_key: 'ccid'
        }
    },
    permissions: {
        type: 'none'
    }
}

const obj1: Obj = {
    id: '1'
};
const obj2: Obj = {
    id: '2'
};

function testImmutableAndnplaceModes<T extends Record<string, any> = Obj>(callback: (name: 'immutable' | 'inplace', options: ApplyWritesToItemsOptions<T>) => void) {
    callback("immutable", {});
    callback("inplace", { mutate: true });
}



describe('applyWritesToItems', () => {



    testImmutableAndnplaceModes((name, options) => {

        describe(name, () => {
            describe('basic happy path', () => {
                test(`create`, () => {

                    const data2 = JSON.parse(JSON.stringify(obj2)); //structuredClone(obj2);

                    const result = applyWritesToItems(
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
                        undefined,
                        options
                    );



                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.insert[0]!
                    ).toEqual(obj2);


                    expect(
                        result.changes.final_items[1]
                    ).toEqual(obj2);

                    expect(
                        result.changes.final_items.length
                    ).toEqual(2);

                });

                test(`update`, () => {

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'T1'
                                    },
                                    where: {
                                        id: '1'
                                    }
                                }
                            }
                        ],
                        [
                            structuredClone(obj1)
                        ],
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.update[0]!
                    ).toEqual({ ...obj1, text: 'T1' });

                    expect(
                        result.changes.final_items[0]!
                    ).toEqual({ ...obj1, text: 'T1' });
                });

                test(`delete`, () => {
                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'delete',
                                    where: {
                                        id: '1'
                                    }
                                }
                            }
                        ],
                        [
                            structuredClone(obj1)
                        ],
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.remove_keys.length
                    ).toEqual(1);

                    expect(
                        result.changes.final_items.length
                    ).toEqual(0);
                });

                test(`array_scoped create (existing structure in place) `, () => {

                    const objWithChildren: Obj = {
                        id: 'p1',
                        children: [
                            {
                                cid: 'c1',
                                children: []
                            }
                        ]
                    }


                    const payload: WriteActionPayloadArrayScope<Obj, 'children.children'> = {

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
                    const result = applyWritesToItems(
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
                        undefined,
                        options
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.final_items[0]!.children![0]!.children[0]!.ccid
                    ).toEqual('cc1');


                    expect(
                        result.changes.final_items[0]!.children![0]!.children.length
                    ).toEqual(1);

                });




                test(`specifies successful_actions`, () => {

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    data: {
                                        text: 'Alice',
                                    },
                                    where: {
                                        text: 'Bob'
                                    }
                                }
                            },
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
                        undefined,
                        Object.assign({
                            atomic: true
                        }, options)

                    );


                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                    expect(result.successful_actions.length).toEqual(1);
                    expect(result.successful_actions[0]!.action.uuid).toEqual('0');
                    expect(result.successful_actions[0]!.affected_items!.length).toEqual(2);
                    expect(result.successful_actions[0]!.affected_items![0]!.item_pk).toEqual('1');
                    expect(result.successful_actions[0]!.affected_items![1]!.item_pk).toEqual('2');
                    expect(result.changes.final_items.every(x => x.text === 'Alice')).toBe(true);


                });

            });

            describe('purity', () => {

                test('never mutates', (cx) => {
                    if (name !== 'immutable') cx.skip();

                    const initialObj1 = structuredClone(obj1);
                    const items = [initialObj1];

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'T1'
                                    },
                                    where: {
                                        id: '1'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: '2',
                                        text: 'T1'
                                    }
                                }
                            }
                        ],
                        items,
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                    expect(items).not.toBe(result.changes.final_items);
                    const returnedObj1 = result.changes.final_items[0]!;
                    expect(initialObj1.id).toBe(returnedObj1.id);
                    expect(initialObj1).not.toBe(returnedObj1);

                    const testId = 'justhere';
                    items.push({ id: testId });
                    expect(items.find(x => x.id === testId)).toBeDefined();
                    expect(result.changes.final_items.find(x => x.id === testId)).toBeUndefined();

                })

                test('mutates in place', (cx) => {
                    if (name !== 'inplace') cx.skip();

                    const initialObj1 = structuredClone(obj1);
                    const items = [initialObj1];

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'T1'
                                    },
                                    where: {
                                        id: '1'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: '2',
                                        text: 'T1'
                                    }
                                }
                            }
                        ],
                        items,
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                    expect(items).toBe(result.changes.final_items);
                    const returnedObj1 = result.changes.final_items[0]!;
                    expect(initialObj1.id).toBe(returnedObj1.id);
                    expect(initialObj1).toBe(returnedObj1);

                    const testId = 'inboth';
                    items.push({ id: testId });
                    expect(items.find(x => x.id === testId)).toBeDefined();
                    expect(result.changes.final_items.find(x => x.id === testId)).toBeDefined();

                })

            })

            describe('error handling', () => {


                test(`update break schema`, () => {

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        // @ts-ignore wilfully breaking schema here 
                                        none_key: 'T1'
                                    },
                                    where: {
                                        id: '1'
                                    }
                                }
                            }
                        ],
                        [
                            structuredClone(obj1)
                        ],
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");
                    const failedActionItem = result.failed_actions[0]!.affected_items![0]!;
                    expect(
                        failedActionItem.item
                    ).toEqual({ ...obj1, none_key: 'T1' });
                });

                test(`identify failed actions`, () => {

                    // Add 2 writes that should work, at position 0 and 2 
                    // Have 2 failing updates, at 1 and 3
                    // Failing update 1 should affect 2 items

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1',
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '1', payload: {
                                    type: 'create',
                                    data: {
                                        // @ts-ignore wilfully breaking schema here 
                                        none_key: 'T1'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '2', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a2',
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '3', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        // @ts-ignore wilfully breaking schema here 
                                        none_key: 'T2'
                                    },
                                    where: {
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '4', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a3',
                                        text: 'bob'
                                    }
                                }
                            },
                        ],
                        [
                            structuredClone(obj1)
                        ],
                        ObjSchema,
                        ddl,
                        undefined,
                        Object.assign({
                            atomic: false
                        }, options)

                    );


                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");
                    const firstFailedAction = result.failed_actions[0]!;
                    expect(firstFailedAction.action.payload.type).toBe('create'); if (firstFailedAction.action.payload.type !== 'create') throw new Error("noop - create");
                    // @ts-ignore wilfully breaking schema here 
                    expect(firstFailedAction.action.payload.data.none_key).toBe('T1');
                    // @ts-ignore wilfully breaking schema here 
                    expect(firstFailedAction.affected_items![0]!.item.none_key).toBe('T1');
                    expect(firstFailedAction.affected_items![0]!.error_details[0]!.type).toBe('missing_key');
                    expect(firstFailedAction.error_details[0]!.type).toBe('missing_key');
                    expect(firstFailedAction.unrecoverable).toBe(true);


                    const secondFailedAction = result.failed_actions[1]!;
                    expect(secondFailedAction.action.payload.type).toBe('create'); if (secondFailedAction.action.payload.type !== 'create') throw new Error("noop - create");
                    // @ts-ignore wilfully breaking schema here 
                    expect(secondFailedAction.blocked_by_action_uuid).toBe('1');

                    const thirdFailedAction = result.failed_actions[2]!;
                    expect(thirdFailedAction.action.payload.type).toBe('update'); if (thirdFailedAction.action.payload.type !== 'update') throw new Error("noop - update");
                    // @ts-ignore wilfully breaking schema here 
                    expect(thirdFailedAction.action.payload.data.none_key).toBe('T2');
                    expect(thirdFailedAction.affected_items!.length).toBe(0);

                    // Now check that it partially succeeded
                    expect(result.changes.insert.length).toBe(1);
                    expect(result.changes.insert[0]!.id).toBe('a1');
                    expect(result.changes.final_items.length).toBe(2);
                    expect(result.changes.final_items[0]!.id).toBe('1');
                    expect(result.changes.final_items[1]!.id).toBe('a1');

                    expect(result.successful_actions.length).toEqual(1);
                    expect(result.successful_actions[0]!.action.uuid).toEqual('0');
                    expect(result.successful_actions[0]!.affected_items!.length).toEqual(1);
                    expect(result.successful_actions[0]!.affected_items![0]!.item_pk).toEqual('a1');


                });

                test(`completely rolls back on failed actions with atomic=true`, () => {

                    const originalItems = [
                        structuredClone(obj1)
                    ] as Draft<Obj>[];
                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1',
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '1', payload: {
                                    type: 'create',
                                    data: {
                                        // @ts-ignore wilfully breaking schema here 
                                        none_key: 'T1'
                                    }
                                }
                            }
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        undefined,
                        Object.assign({
                            atomic: true
                        }, options)

                    );

                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                    // Now check that it failed
                    expect(result.changes.insert.length).toBe(0);
                    expect(result.changes.final_items.length).toBe(1);
                    expect(result.changes.final_items[0]!.id).toBe('1');
                    expect(result.changes.final_items === originalItems).toBe(true);
                    expect(result.changes.final_items).toEqual(originalItems);
                    expect(result.successful_actions.length).toBe(0);


                });

                test(`rolls back failed items partially with atomic===false`, () => {

                    const originalItems = [
                        structuredClone(obj1)
                    ];

                    const obj1Ref = originalItems[0]!;

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1',
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '1', payload: {
                                    type: 'delete',
                                    where: { id: obj1.id }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '2', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        // @ts-ignore wilfully breaking schema here 
                                        none_key: 'T2'
                                    },
                                    where: {
                                        text: 'bob'
                                    }
                                }
                            },
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                    expect(result.changes.final_items.length).toBe(1);
                    expect(result.changes.final_items[0]!.id).toBe('a1');

                    expect(result.failed_actions.length).toBe(1);
                    expect(result.successful_actions.length).toBe(2);
                });

                test(`handles failure on array_scope, with atomic=false`, () => {

                    const originalItems: Obj[] = [
                        {
                            id: '1',
                            children: [
                                { cid: '1', children: [] }
                            ]
                        }
                    ];
                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: assertArrayScope<Obj, 'children'>({
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
                                })
                            },
                            {
                                type: 'write', ts: 0, uuid: '1', payload: {
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
                                }
                            }
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        Object.assign({
                            atomic: false
                        }, options)

                    );

                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                    // Now check that it failed
                    expect(result.changes.update.length).toBe(1);
                    expect(result.changes.update[0]!.id).toBe('1');
                    expect(result.changes.final_items.length).toBe(1);
                    expect(result.changes.final_items[0]!.id).toBe('1');
                    expect(result.changes.final_items[0]!.children![0]!.name).toBe('Bob'); // update applied
                    // @ts-ignore
                    expect(result.failed_actions[0]!.affected_items![0]!.item.bad_key).toBe('expect fail');

                });

                test(`handles failure on array_scope, with atomic=true`, () => {
                    
                    const originalItems: Obj[] = [
                        {
                            id: '1',
                            children: [
                                { cid: '1', children: [] }
                            ]
                        }
                    ];
                    const originalItemsClone = structuredClone(originalItems);

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: assertArrayScope<Obj, 'children'>({
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
                                })
                            },
                            {
                                type: 'write', ts: 0, uuid: '1', payload: {
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
                                }
                            }
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        undefined,
                        Object.assign({
                            atomic: true
                        }, options)

                    );

                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                    // Now check that it failed, and nothing is changed
                    expect(result.changes.update.length).toBe(0);
                    expect(result.changes.final_items.length).toBe(1);
                    expect(result.changes.final_items[0]!.id).toBe('1');
                    expect(!result.changes.final_items[0]!.children![0]!.name).toBe(true);
                    expect(result.changes.final_items).toEqual(originalItemsClone);

                });
            })

            describe('Referential comparison (react friendly shallow references)', () => {
                test(`works with changes`, (cx) => {



                    const originalItems = [
                        structuredClone(obj1),
                        structuredClone(obj2)
                    ];

                    const obj1Ref = originalItems[0]!;
                    const obj2Ref = originalItems[1];

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1',
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'sue'
                                    },
                                    where: {
                                        id: obj2.id
                                    }
                                }
                            },
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );

                    if (name === 'inplace') {
                        expect(result.changes.referential_comparison_ok).toBe(false);
                        cx.skip();
                    } else {
                        expect(result.changes.referential_comparison_ok).toBe(true);
                    }

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                    expect(result.changes.final_items === originalItems).toBe(false);
                    expect(result.changes.final_items[0] === obj1Ref).toBe(true);
                    expect(result.changes.final_items[1] === obj2Ref).toBe(false);

                });

                test(`works with 0 changes`, (cx) => {

                    const originalItems = [
                        structuredClone(obj1)
                    ];
                    const obj1Ref = originalItems[0]!;

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'sue'
                                    },
                                    where: {
                                        id: 'never match'
                                    }
                                }
                            },
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );
                    if (name === 'inplace') {
                        expect(result.changes.referential_comparison_ok).toBe(false);
                        cx.skip();
                    } else {
                        expect(result.changes.referential_comparison_ok).toBe(true);
                    }

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                    expect(result.changes.final_items === originalItems).toBe(true);
                    expect(originalItems[0] === obj1Ref).toBe(true);

                });

                test(`works with Immer and changes`, (cx) => {
                    if( name!=='inplace' ) cx.skip();

                    const originalItems = [
                        structuredClone(obj1),
                        structuredClone(obj2)
                    ];

                    const finalItems = produce(originalItems, draft => {
                        applyWritesToItems(
                            [
                                {
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'create',
                                        data: {
                                            id: 'a1',
                                            text: 'bob'
                                        }
                                    }
                                },
                                {
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'update',
                                        method: 'merge',
                                        data: {
                                            text: 'sue'
                                        },
                                        where: {
                                            id: obj2.id
                                        }
                                    }
                                },
                            ],
                            draft,
                            ObjSchema,
                            ddl,
                            undefined,
                            options
                        );
                    });


                    const obj1Ref = originalItems[0]!;
                    const obj2Ref = originalItems[1];

                    expect(finalItems === originalItems).toBe(false);
                    expect(finalItems[0] === obj1Ref).toBe(true);
                    expect(finalItems[1] === obj2Ref).toBe(false);

                });

            })


            describe('Integrity', () => {
                test(`cannot dupe primary key`, () => {

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1',
                                        text: 'bob'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1',
                                        text: 'sue'
                                    }
                                }
                            },
                        ],
                        [
                            structuredClone(obj1)
                        ],
                        ObjSchema,
                        ddl,
                        undefined,
                        options
                    );


                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");

                    const firstFailedAction = result.failed_actions[0]!;
                    expect(firstFailedAction.unrecoverable).toBe(true);
                    expect(firstFailedAction.affected_items![0]!.error_details[0]!.type).toBe('create_duplicated_key');
                });

                test(`not allowed to change primary key`, (cx) => {

                    const originalItems = [structuredClone(obj1)];
                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        id: 'a2'
                                    },
                                    where: {
                                        id: obj1.id
                                    }
                                }
                            },
                        ],
                        originalItems,
                        ObjSchema,
                        ddl,
                        undefined,
                        Object.assign(options, { atomic: false })
                    );


                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");
                    const firstFailedAction = result.failed_actions[0]!;
                    expect(firstFailedAction.action.payload.type).toBe('update'); if (firstFailedAction.action.payload.type !== 'update') throw new Error("noop - update");
                    expect(firstFailedAction.affected_items![0]!.item.id).toBe('1');
                    expect(firstFailedAction.affected_items![0]!.error_details[0]!.type).toBe('update_altered_key');
                    expect(firstFailedAction.unrecoverable).toBe(true);

                    // Make sure when there's an error, it doesn't change the original items 
                    expect(originalItems[0]!.id).toBe(obj1.id);
                    expect(result.changes.final_items[0]!.id).toBe(obj1.id);

                });

                describe('auto recovery', () => {
                    test(`attempt_recover_duplicate_create if-identical`, () => {

                        const actions: WriteAction<Obj>[] = [
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

                        const existing: Obj = {
                            'id': '1',
                            'text': 'Right'
                        }

                        const result = applyWritesToItems(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'if-identical',
                                ...options
                            }
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

                        const existing2: Obj = {
                            'id': '1',
                            'text': 'Right'
                        }

                        const result2 = applyWritesToItems(
                            actions,
                            [existing2],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'if-identical',
                                ...options
                            }
                        );
                        expect(result2.status).toBe('ok'); if (result2.status !== 'ok') throw new Error("noop");
                        expect(result2.changes.final_items[0]!.text).toBe('Right2');


                        const result3 = applyWritesToItems(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'never',
                                ...options
                            }
                        );
                        expect(result3.status).toBe('error'); if (result3.status !== 'error') throw new Error("noop");


                    })


                    test(`attempt_recover_duplicate_create fails for if-identical if not identical`, () => {

                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write',
                                ts: 0,
                                uuid: '0',
                                payload: {
                                    type: 'create',
                                    data: {
                                        id: '1',
                                        'text': 'Bob'
                                    }
                                }
                            }
                        ]

                        const existing: Obj = {
                            'id': '1',
                            'text': 'Alice'
                        }

                        const result = applyWritesToItems(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'if-identical',
                                ...options
                            }
                        );

                        expect(result.status).toBe('error');
                        expect(result.changes.final_items[0]!.text).toBe('Alice');


                    })

                    test(`attempt_recover_duplicate_create always-update`, () => {

                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write',
                                ts: 0,
                                uuid: '0',
                                payload: {
                                    type: 'create',
                                    data: {
                                        id: '1',
                                        'text': 'Bob'
                                    }
                                }
                            }
                        ]

                        const existing: Obj = {
                            'id': '1',
                            'text': 'Alice'
                        }

                        const result = applyWritesToItems(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'always-update',
                                ...options
                            }
                        );

                        expect(result.status).toBe('ok');
                        expect(result.changes.final_items[0]!.text).toBe('Bob');


                    })
                })
            })




            test(`permissions create succeed`, () => {

                const actions: WriteAction<Obj>[] = [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'create',
                            data: {
                                id: '1',
                                owner: 'user1',
                                'text': 'Wrong'
                            }
                        }
                    }
                ]


                const ddlP = structuredClone(ddl);
                ddlP.permissions = {
                    type: 'basic_ownership_property',
                    property_type: 'id',
                    path: 'owner',
                    format: 'uuid'

                }

                const user1: IUser = {
                    getUuid: () => 'user1',
                    getEmail: () => 'user1@gmail.com',
                    getID: () => 'user1'
                }

                const result = applyWritesToItems(
                    actions,
                    [],
                    ObjSchema,
                    ddlP,
                    user1
                );

                expect(result.status).toBe('ok');


            })

            test(`permissions create fail`, () => {

                const actions: WriteAction<Obj>[] = [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'create',
                            data: {
                                id: '1',
                                owner: 'user2',
                                'text': 'Wrong'
                            }
                        }
                    }
                ]


                const ddlP = structuredClone(ddl);
                ddlP.permissions = {
                    type: 'basic_ownership_property',
                    property_type: 'id',
                    path: 'owner',
                    format: 'uuid'

                }

                const user1: IUser = {
                    getUuid: () => 'user1',
                    getEmail: () => 'user1@gmail.com',
                    getID: () => 'user1'
                }

                const result = applyWritesToItems(
                    actions,
                    [],
                    ObjSchema,
                    ddlP,
                    user1
                );

                expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");
                expect(result.failed_actions[0]!.error_details[0]!.type).toBe('permission_denied');


            })

            test(`permissions update succeed`, () => {

                const actions: WriteAction<Obj>[] = [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'update',
                            data: {
                                'text': 'Wrong'
                            },
                            where: {
                                id: '1'
                            }
                        }
                    }
                ]

                const existing: Obj = {
                    'id': '1',
                    'owner': 'user1',
                    'text': 'Right'
                }

                const ddlP = structuredClone(ddl);
                ddlP.permissions = {
                    type: 'basic_ownership_property',
                    property_type: 'id',
                    path: 'owner',
                    format: 'uuid'

                }

                const user1: IUser = {
                    getUuid: () => 'user1',
                    getEmail: () => 'user1@gmail.com',
                    getID: () => 'user1'
                }

                const result = applyWritesToItems(
                    actions,
                    [existing],
                    ObjSchema,
                    ddlP,
                    user1
                );

                expect(result.status).toBe('ok');


            })

            test(`permissions update failed`, () => {

                const actions: WriteAction<Obj>[] = [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'update',
                            data: {
                                'text': 'Wrong'
                            },
                            where: {
                                id: '1'
                            }
                        }
                    }
                ]

                const existing: Obj = {
                    'id': '1',
                    'owner': 'user2',
                    'text': 'Right'
                }

                const ddlP = structuredClone(ddl);
                ddlP.permissions = {
                    type: 'basic_ownership_property',
                    property_type: 'id',
                    path: 'owner',
                    format: 'uuid'

                }

                const user1: IUser = {
                    getUuid: () => 'user1',
                    getEmail: () => 'user1@gmail.com',
                    getID: () => 'user1'
                }

                const result = applyWritesToItems(
                    actions,
                    [existing],
                    ObjSchema,
                    ddlP,
                    user1
                );

                expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");
                expect(result.failed_actions[0]!.error_details[0]!.type).toBe('permission_denied');



            })

            test(`permissions atomic=false`, () => {

                const actions: WriteAction<Obj>[] = [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'update',
                            data: {
                                'text': 'Wrong'
                            },
                            where: {
                                id: '1'
                            }
                        }
                    },
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '1',
                        payload: {
                            type: 'create',
                            data: {
                                id: '1',
                                owner: 'user2',
                                'text': 'Wrong'
                            }
                        }
                    }
                ]

                const existing: Obj = {
                    'id': '1',
                    'owner': 'user1',
                    'text': 'Right'
                }

                const ddlP = structuredClone(ddl);
                ddlP.permissions = {
                    type: 'basic_ownership_property',
                    property_type: 'id',
                    path: 'owner',
                    format: 'uuid'

                }

                const user1: IUser = {
                    getUuid: () => 'user1',
                    getEmail: () => 'user1@gmail.com',
                    getID: () => 'user1'
                }

                const result = applyWritesToItems(
                    actions,
                    [existing],
                    ObjSchema,
                    ddlP,
                    user1,
                    {
                        atomic: false
                    }
                );

                expect(result.status).toBe('error');
                expect(result.successful_actions.length).toBe(1);
                expect(result.successful_actions[0]!.action.uuid).toBe('0');



            })

            test(`permissions atomic=true`, () => {

                const actions: WriteAction<Obj>[] = [
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '0',
                        payload: {
                            type: 'update',
                            data: {
                                'text': 'Wrong'
                            },
                            where: {
                                id: '1'
                            }
                        }
                    },
                    {
                        type: 'write',
                        ts: 0,
                        uuid: '1',
                        payload: {
                            type: 'create',
                            data: {
                                id: '1',
                                owner: 'user2',
                                'text': 'Wrong'
                            }
                        }
                    }
                ]

                const existing: Obj = {
                    'id': '1',
                    'owner': 'user1',
                    'text': 'Right'
                }

                const ddlP = structuredClone(ddl);
                ddlP.permissions = {
                    type: 'basic_ownership_property',
                    property_type: 'id',
                    path: 'owner',
                    format: 'uuid'

                }

                const user1: IUser = {
                    getUuid: () => 'user1',
                    getEmail: () => 'user1@gmail.com',
                    getID: () => 'user1'
                }

                const result = applyWritesToItems(
                    actions,
                    [existing],
                    ObjSchema,
                    ddlP,
                    user1,
                    {
                        atomic: true
                    }
                );

                expect(result.status).toBe('error');
                expect(result.successful_actions.length).toBe(0);


            })




            describe('Immer compatible', () => {

                if (name === 'inplace') {
                    test('changes ok using produce', async () => {

                        const originalItems = [structuredClone(obj1), structuredClone(obj2)];

                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'sue'
                                    },
                                    where: {
                                        id: obj2.id
                                    }
                                }
                            }
                        ]

                        const finalItems = produce(originalItems, draft => {
                            applyWritesToItems(
                                actions,
                                draft,
                                ObjSchema,
                                ddl,
                                undefined,
                                options
                            );
                        });

                        expect(finalItems === originalItems).toBe(false);
                        expect(finalItems[0] === originalItems[0]!).toBe(true);
                        expect(finalItems[1] === originalItems[1]).toBe(false);
                    })

                    test('Prove Immer flags objects even if no material change #immer_flags', () => {
                        const originalItems = [{id: 1, text: 'Bob'}, {id: 2, text: ''}];
                        const finalItems = produce(originalItems, draft => {
                            
                        });
                        // The final items have changed
                        expect(finalItems).toBe(originalItems);

                        const originalItemsFlagged = [{id: 1, text: 'Bob'}, {id: 2, text: ''}];
                        const finalItemsFlagged = produce(originalItems, draft => {
                            draft[1]!.text = 'Alice';
                            draft[1]!.text = ''; // Restore
                        });
                        // The final items have changed
                        expect(finalItemsFlagged).not.toBe(originalItemsFlagged);
                    })
                    test('handles atomic rollback on error using produce', async () => {

                        const originalItems = [structuredClone(obj1), structuredClone(obj2)];
                        console.log(originalItems);

                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    data: {
                                        text: 'Updated Text'
                                    },
                                    where: {
                                        id: obj1.id
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'new-entry',
                                        text: 'Something new'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: obj2.id // Collision
                                    }
                                }
                            }
                        ]

                        const finalItems = produce(originalItems, draft => {
                            applyWritesToItems(
                                actions,
                                draft,
                                ObjSchema,
                                ddl,
                                undefined,
                                {...options, atomic: true}
                            );
                        });

                        
                        console.log(finalItems);
                        expect(finalItems.map(x => x.id)).toEqual([obj1.id, obj2.id]);
                        expect(finalItems[0]).toEqual(originalItems[0]);
                        expect(finalItems[1]).toEqual(originalItems[1]);

                        expect(finalItems === originalItems).toBe(true);
                        expect(finalItems[1] === originalItems[1]).toBe(true);
                        expect(finalItems[0] === originalItems[0]).toBe(true);
                    })

                    test('changes ok using createDraft/finishDraft', async () => {

                        const originalItems = [structuredClone(obj1), structuredClone(obj2)];
                        const draftItems = createDraft(originalItems);

                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1'
                                    }
                                }
                            },
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'sue'
                                    },
                                    where: {
                                        id: obj2.id
                                    }
                                }
                            }
                        ]


                        const result = applyWritesToItems(
                            actions,
                            draftItems,
                            ObjSchema,
                            ddl,
                            undefined,
                            options
                        );
                        expect(draftItems === result.changes.final_items).toBe(true);

                        const finalItems = finishDraft(result.changes.final_items);
                        expect(finalItems === originalItems).toBe(false);
                        expect(finalItems[0] === originalItems[0]!).toBe(true);
                        expect(finalItems[1] === originalItems[1]).toBe(false);

                    })

                    test('0 change', async () => {

                        const originalItems = [structuredClone(obj1), structuredClone(obj2)];

                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'update',
                                    method: 'merge',
                                    data: {
                                        text: 'sue'
                                    },
                                    where: {
                                        id: 'no exist'
                                    }
                                }
                            }
                        ]

                        const finalItems = produce(originalItems, draft => {
                            applyWritesToItems(
                                actions,
                                draft,
                                ObjSchema,
                                ddl,
                                undefined,
                                options
                            );
                        });

                        expect(finalItems === originalItems).toBe(true);
                        expect(finalItems[0] === originalItems[0]!).toBe(true);
                        expect(finalItems[1] === originalItems[1]).toBe(true);
                    })
                }
                if (name === 'immutable') {
                    test('throws error if trying to use immer and immutable', () => {
                        const originalItems = [structuredClone(obj1), structuredClone(obj2)];
                        const actions: WriteAction<Obj>[] = [
                            {
                                type: 'write', ts: 0, uuid: '0', payload: {
                                    type: 'create',
                                    data: {
                                        id: 'a1'
                                    }
                                }
                            }
                        ]

                        expect(() => produce(originalItems, draft => {
                            applyWritesToItems(
                                actions,
                                draft,
                                ObjSchema,
                                ddl,
                                undefined,
                                options
                            );
                        })).toThrow('When using Immer drafts you need to use mutate.');
                    })
                }
            })






            describe('Regression Tests', () => {
                test(`delete/create/delete/create works`, () => {

                    const RegressSchema1 = z.object({ id: z.string(), name: z.string() })
                    type Regress = z.infer<typeof RegressSchema1>;
                    const actions: WriteAction<Regress>[] = [
                        { "type": "write", "ts": 1721124239158, "uuid": "9de5231b-f5db-480a-8ede-9294d989fe47", "payload": { "type": "delete", "where": { "id": "1" } } },
                        { "type": "write", "ts": 1721124239175, "uuid": "f087dc19-438e-4f52-875f-1e6c6e4e8e37", "payload": { "type": "create", "data": { "id": "1", "name": "Bob" } } },
                        { "type": "write", "ts": 1721124239180, "uuid": "9e54e923-d0ed-4339-a910-f192eb5a8a2b", "payload": { "type": "delete", "where": { "id": "1" } } },
                        { "type": "write", "ts": 1721124239183, "uuid": "ba90fbc0-5712-4e5d-98c6-ccb293a5cc89", "payload": { "type": "create", "data": { "id": "1", "name": "Alice" } } }
                    ]


                    const user1: IUser = {
                        getUuid: () => 'user1',
                        getEmail: () => 'user1@gmail.com',
                        getID: () => 'user1'
                    }
                    const ddl: DDL<Regress> = {
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

                    const result = applyWritesToItems(
                        actions,
                        [],
                        RegressSchema1,
                        ddl,
                        user1,
                        {
                            attempt_recover_duplicate_create: 'never'
                        }
                    );
                    expect(result.status).toBe('ok');


                    const result2 = applyWritesToItems(
                        actions,
                        [],
                        RegressSchema1,
                        ddl,
                        user1,
                        {
                            attempt_recover_duplicate_create: 'if-identical'
                        }
                    );
                    expect(result2.status).toBe('ok');



                })
            })



        });


    })
});
