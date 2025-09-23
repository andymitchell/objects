
import { z } from "zod";

import { test } from 'vitest';
import type { WriteAction, WriteActionPayloadArrayScope } from "../types.js";
import { assertArrayScope } from "../types.js";
import type { ApplyWritesToItemsOptions, ApplyWritesToItemsResponse, DDL } from "./types.js";
import { produce, type Draft } from "immer";
import type { IUser } from "../auth/types.js";
import { applyWritesToItems } from "./applyWritesToItems.ts";





const ObjSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
    owner: z.string().optional(),
    arr_items: z.array(z.string()).optional(),
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

export type ApplyWritesToItemsInTestingFn<T extends Record<string, any>> = (
    writeActions: WriteAction<T>[],
    items: T[],
    schema: z.ZodType<T, any, any>,
    ddl: DDL<T>,
    user?: IUser,
    options?: ApplyWritesToItemsOptions<T>
) => {
    /**
     * The result, but in the case of Immer `produce` it has had its `changes.final_items` replaced with the finalised drafts. 
     * You can access the real final_items as `draft_final_items`
     */
    result: ApplyWritesToItemsResponse<T>,

    /**
     * In the case of Immer `produce` this is what is passed to `applyWritesToItems`
     */
    draft_items?: Draft<T>[],
    /**
     * In the case of Immer `produce` this is what is received from `applyWritesToItems` as `changes.final_items`
     */
    draft_final_items?: Draft<T>[]
};

function castApplyWritesToItemsInTestingFn<T extends Record<string, any>>(applyWritesToItemsInTesting: ApplyWritesToItemsInTestingFn<any>): ApplyWritesToItemsInTestingFn<T> {
    return applyWritesToItemsInTesting;
}

type UseCase = 'immutable' | 'mutable' | 'immer-mutable';
type Mutable = 'immutable' | 'mutable';
type Immer = 'immer' | 'non-immer';

/**
 * Generic test runner for different use cases. 
 * 
 * Put the tests inside the callback, and use `applyWritesToItemsInTesting` in place of `applyWritesToItems`.
 * @note It alters Immer's behaviour - by default, no `changes` work in Immer after `produce` is complete; but for the test it sets `changes.final_items` to the result of Immer's `produce`
 * 
 * @param callback 
 */
function testUseCases<
    T extends Record<string, any> = Obj
>
    (
        callback: (name: UseCase, mutable: Mutable, immer: Immer, applyWritesToItemsInTesting: ApplyWritesToItemsInTestingFn<T>, useCaseBaseOptions: ApplyWritesToItemsOptions<T>) => void
    ) {

    {
        const useCaseBaseOptions = { mutate: false };
        // The immutable options
        const applyWritesToItemsInTesting: ApplyWritesToItemsInTestingFn<T> = (writeActions, items, schema, ddl, user, options) => {
            const result = applyWritesToItems(writeActions, items, schema, ddl, user, { ...useCaseBaseOptions, ...options });
            return {
                result
            }
        }
        callback('immutable', 'immutable', 'non-immer', applyWritesToItemsInTesting, useCaseBaseOptions)
    }
    {

        // The mutable options
        const useCaseBaseOptions = { mutate: true };
        const applyWritesToItemsInTesting: ApplyWritesToItemsInTestingFn<T> = (writeActions, items, schema, ddl, user, options) => {
            const result = applyWritesToItems(writeActions, items, schema, ddl, user, { ...useCaseBaseOptions, ...options });
            return {
                result
            }
        }
        callback('mutable', 'mutable', 'non-immer', applyWritesToItemsInTesting, useCaseBaseOptions)
    }
    {

        // The immer-mutable options
        const useCaseBaseOptions = { mutate: true };
        const applyWritesToItemsInTesting: ApplyWritesToItemsInTestingFn<T> = (writeActions, items, schema, ddl, user, options) => {

            let result: ApplyWritesToItemsResponse<T>;
            let draft_items: Draft<T>[];
            let draft_final_items: Draft<T>[];
            const finalItems = produce(items, draft => {

                draft_items = draft;
                result = applyWritesToItems(writeActions, draft as T[], schema, ddl, user, { ...useCaseBaseOptions, ...options })

                draft_final_items = result.changes.final_items as Draft<T>[];

            });
            if (!result! || !draft_items! || !draft_final_items!) throw new Error("noop");

            result.changes.final_items = finalItems

            return { result, draft_final_items, draft_items };

        }
        callback('immer-mutable', 'mutable', 'immer', applyWritesToItemsInTesting, useCaseBaseOptions)
    }

}




describe('applyWritesToItems', () => {



    testUseCases((name, mutable, immer, applyWritesToItemsInTesting, options) => {

        describe(name, () => {
            describe('basic happy path', () => {
                test(`create`, () => {

                    const data2 = JSON.parse(JSON.stringify(obj2)); //structuredClone(obj2);

                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
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

                test(`update`, (cx) => {
                    if (name !== 'immer-mutable') cx.skip();

                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    if (immer !== 'immer') { // With Immer the draft objects added to 'changes' are cancelled #immer_changes_cancelled_post_produce
                        expect(
                            result.changes.update[0]!
                        ).toEqual({ ...obj1, text: 'T1' });
                    }

                    expect(
                        result.changes.final_items[0]!
                    ).toEqual({ ...obj1, text: 'T1' });
                });

                test(`delete`, () => {
                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.remove_keys.length
                    ).toEqual(1);

                    expect(
                        result.changes.final_items.length
                    ).toEqual(0);
                });

                test(`array_scoped create (regression on Task)`, (cx) => {



                    const ThreadIdsSchema = z.object({
                        //threadID: z.string().nonempty(),
                        threadIDG3: z.string().optional(),
                        threadIDG2: z.string().optional(),
                        standaloneDraftId: z.string().optional(),
                        standaloneDraftIdLegacy: z.string().optional(),
                    });
                    const ThreadIdsWithMessageSchema = z.intersection(ThreadIdsSchema, z.object({
                        lastMessageID: z.string().optional(),
                        lastMessageIDLegacy: z.string().optional(),
                        standaloneDraftId: z.string().optional(),
                        standaloneDraftIdLegacy: z.string().optional(),
                        shortID: z.string().optional() // the ID in the hash 
                    }));
                    const CvIDSchema = z.intersection(ThreadIdsWithMessageSchema, z.object({
                    }));

                    const RobustRangeSchema = z.object({
                        //domIndices: z.string(), 
                        textRange: z.string(),
                        charStart: z.string().optional(),
                        charEnd: z.string().optional(),
                        //tokens: EncodedTokensSchema.optional()
                    })
                    const TaskMutableCoreSchema = z.object({
                        format: z.number().optional(),
                        emailCvID: CvIDSchema.optional(),
                        emailDetails: z.object(
                            {
                                rfcMessageId: z.string(),
                                subject: z.string().optional(),
                                sentAtTs: z.number(),
                            }
                        ).optional(),
                        highlight: RobustRangeSchema.optional(),
                        text: z.string().optional(),
                        complete: z.boolean().optional(),
                        snoozeUntilTs: z.number().optional(),
                        archived: z.boolean().optional(),
                        recipients: z.array(z.string()).optional(),
                        assigned: z.array(z.string()).optional(),
                        owner: z.string().optional(),
                        ownerDetails: z.object(
                            {
                                name: z.string().optional(),
                                avatarURL: z.string().optional()
                            }
                        ).optional(),
                        softDeletedAtTs: z.number().optional(),
                        supportingContext: z.string().optional(),
                        suggestion: z.boolean().optional(),
                        embed: z.boolean().optional(),
                        draft: z.object({
                            embedOnConfirm: z.boolean()
                        }).optional(),
                        choices: z.array(z.string()).optional(),
                        draggableSortKey: z.string().optional()

                    });
                    const TaskSchema = TaskMutableCoreSchema.merge(z.object({
                        id: z.string(),
                        creator: z.string(),
                        createdAtTs: z.number(),
                        children: z.array(z.object({
                            id: z.string(),
                            text: z.string(),
                            createdAtTs: z.number(),
                            creator: z.string()
                        }))
                    }));

                    type Task = z.infer<typeof TaskSchema>;

                    const obj: Task = {
                        "emailCvID": {
                            "threadIDG2": "",
                            "threadIDG3": "thread-a:r-2254583274219061713",
                            "lastMessageID": "msg-a:r-3535258334084944016",
                            "standaloneDraftId": "msg-a:r-3535258334084944016"
                        },
                        "text": "wtf <span class=\"_mention_17riv_3\" data-type=\"mention\" data-id=\"bot\" data-label=\"bot\" data-mention-suggestion-char=\"@\">@bot</span>",
                        "id": "557dd2be-8061-4a43-8beb-6f70c4781f50",
                        "creator": "branch.attacking.lion@gmail.com",
                        "createdAtTs": 1758618892440,
                        "draggableSortKey": "a1",
                        "children": []
                    }



                    const ddl: DDL<Task> = {
                        version: 1,
                        lists: {
                            '.': {
                                primary_key: 'id'
                            },
                            'children': {
                                primary_key: 'id',
                            },
                        },
                        permissions: {
                            type: 'none'
                        }
                    }

                    const result = applyWritesToItems(
                        [
                            {
                                type: 'write',
                                ts: 0,
                                uuid: '0',
                                payload: {
                                    type: 'array_scope',
                                    action: {
                                        type: 'create',
                                        data: {
                                            id: "79aa9af4-aa8f-4494-adbc-14c3046705c1",
                                            creator: 'bot',
                                            createdAtTs: Date.now(),
                                            text: 'You added a name'
                                        },
                                    },
                                    scope: 'children',
                                    where: {
                                        id: obj.id
                                    }
                                }
                            }
                        ],
                        [
                            obj
                        ],
                        TaskSchema,
                        ddl
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error('noop');
                    const updatedItem = result.changes.final_items[0]!;
                    expect(updatedItem.children[0]!.text).toBe('You added a name');

                })

                test(`array_scoped create (existing structure in place) `, (cx) => {


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
                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.final_items[0]!.children![0]!.children[0]!.ccid
                    ).toEqual('cc1');


                    expect(
                        result.changes.final_items[0]!.children![0]!.children.length
                    ).toEqual(1);

                });


                test(`array updates ok`, () => {
                    const data1: Obj = JSON.parse(JSON.stringify(obj1)); //structuredClone(obj2);
                    data1.arr_items = ['1'];

                    const { result } = applyWritesToItemsInTesting(
                        [
                            {
                                type: 'write',
                                ts: 0,
                                uuid: '0',
                                payload: {
                                    type: 'create',
                                    data: data1
                                }
                            }
                        ]
                        ,
                        [],
                        ObjSchema,
                        ddl
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");
                    expect(
                        result.changes.insert[0]!
                    ).toEqual(data1);

                    const { result: result2 } = applyWritesToItemsInTesting(
                        [
                            {
                                type: 'write',
                                ts: 0,
                                uuid: '0',
                                payload: {
                                    type: 'update',
                                    data: {
                                        arr_items: ['1', '2']
                                    },
                                    where: {
                                        id: data1.id
                                    }
                                }
                            }
                        ]
                        ,
                        result.changes.final_items,
                        ObjSchema,
                        ddl
                    );


                    const { result: result3 } = applyWritesToItemsInTesting(
                        [
                            {
                                type: 'write',
                                ts: 0,
                                uuid: '0',
                                payload: {
                                    type: 'update',
                                    data: {
                                        arr_items: ['z'],
                                        'owner': 'Bob'
                                    },
                                    where: {
                                        id: data1.id
                                    }
                                }
                            }
                        ]
                        ,
                        result2.changes.final_items,
                        ObjSchema,
                        ddl
                    );

                    expect(result3.status).toBe('ok'); if (result3.status !== 'ok') throw new Error("noop");
                    expect(
                        result3.changes.final_items[0]!
                    ).toEqual({
                        ...data1,
                        arr_items: ['z'],
                        owner: 'Bob'
                    });


                });

                test(`specifies successful_actions`, () => {

                    const { result } = applyWritesToItemsInTesting(
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
                        {
                            atomic: true
                        }
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
                    if (mutable !== 'immutable' && immer !== 'immer') cx.skip(); // Allow immer here: see #immer_mutates_in_produce_but_then_is_immutable

                    const initialObj1 = structuredClone(obj1);
                    const items = [initialObj1];

                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
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
                    if (mutable !== 'mutable') cx.skip();
                    // Immer is counter-intuitive because despite it running as a mutate operation, it's final output behaves with perfect referential comparison; so it needs to be judged as non-mutate. #immer_mutates_in_produce_but_then_is_immutable
                    if (immer === 'immer') cx.skip();

                    const initialObj1 = structuredClone(obj1);
                    const items = [initialObj1];



                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
                    );

                    expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");


                    expect(items).toBe(result.changes.final_items);
                    const returnedObj1 = result.changes.final_items[0]!;
                    expect(initialObj1.id).toBe(returnedObj1.id);
                    expect(initialObj1).toBe(returnedObj1);


                    // Skip this for immer as it freezes the items
                    if (name !== 'immer-mutable') {
                        const testId = 'inboth';
                        items.push({ id: testId });
                        expect(items.find(x => x.id === testId)).toBeDefined();
                        expect(result.changes.final_items.find(x => x.id === testId)).toBeDefined();
                    }

                })

            })

            describe('error handling', () => {


                test(`update break schema`, () => {

                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
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

                    const { result } = applyWritesToItemsInTesting(
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
                        {
                            atomic: false
                        }

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

                describe('atomic', () => {
                    test(`completely rolls back on failed actions with atomic=true`, () => {

                        const originalItems = [
                            structuredClone(obj1)
                        ] as Draft<Obj>[];
                        const { result } = applyWritesToItemsInTesting(
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
                            {
                                atomic: true
                            }

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

                        const { result } = applyWritesToItemsInTesting(
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
                            {
                                atomic: false
                            }
                        );

                        expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                        expect(result.changes.final_items.length).toBe(1);
                        expect(result.changes.final_items[0]!.id).toBe('a1');

                        expect(result.failed_actions.length).toBe(1);
                        expect(result.successful_actions.length).toBe(2);
                    });

                    test(`handles failure on array_scope, with atomic=false`, (cx) => {


                        const originalItems: Obj[] = [
                            {
                                id: '1',
                                children: [
                                    { cid: '1', children: [] }
                                ]
                            }
                        ];
                        const { result } = applyWritesToItemsInTesting(
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
                            {
                                atomic: false
                            }

                        );

                        expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                        // Now check that it failed
                        if (immer !== 'immer') { // Immer prevents access to objects after produce finishes. #immer_changes_cancelled_post_produce
                            expect(result.changes.update.length).toBe(1);
                            expect(result.changes.update[0]!.id).toBe('1');
                        }
                        expect(result.changes.final_items.length).toBe(1);
                        expect(result.changes.final_items[0]!.id).toBe('1');
                        expect(result.changes.final_items[0]!.children![0]!.name).toBe('Bob'); // update applied
                        // @ts-ignore
                        expect(result.failed_actions[0]!.affected_items![0]!.item.bad_key).toBe('expect fail');

                    });

                    test(`handles rollback on failure of array_scope, with atomic=true`, (cx) => {
                        //if( name!=='immer-mutable' ) cx.skip()

                        const originalItems: Obj[] = [
                            {
                                id: '1',
                                children: [
                                    { cid: '1', children: [] }
                                ]
                            }
                        ];
                        const originalItemsClone = structuredClone(originalItems);

                        const { result } = applyWritesToItemsInTesting(
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
                            {
                                atomic: true
                            }

                        );

                        expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                        // Now check that it failed, and nothing is changed
                        expect(result.changes.update.length).toBe(0);
                        expect(result.changes.final_items.length).toBe(1);
                        expect(result.changes.final_items[0]!.id).toBe('1');
                        expect(result.changes.final_items[0]!.children![0]!.name).toBeUndefined();
                        expect(result.changes.final_items).toEqual(originalItemsClone);

                    });
                })
            })

            describe('Referential comparison (react friendly shallow references)', () => {
                describe('some changes', () => {
                    test(`reference changes only whats updated by write changes`, (cx) => {


                        const originalItems = [
                            structuredClone(obj1),
                            structuredClone(obj2)
                        ];

                        const obj1Ref = originalItems[0]!;
                        const obj2Ref = originalItems[1];

                        const { result } = applyWritesToItemsInTesting(
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
                            ddl
                        );

                        if (mutable === 'mutable' && immer !== 'immer') {
                            // Mutable without immer does not support referential comparison
                            expect(result.changes.referential_comparison_ok).toBe(false);
                        } else {
                            expect(result.changes.referential_comparison_ok).toBe(true);
                            expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                            expect(result.changes.final_items === originalItems).toBe(false);
                            expect(result.changes.final_items[0] === obj1Ref).toBe(true);
                            expect(result.changes.final_items[1] === obj2Ref).toBe(false);
                        }


                    });

                    test(`changes references with 1 write, 1 fail and atomic=false`, (cx) => {

                        const originalItems = [
                            structuredClone(obj1)
                        ];
                        const obj1Ref = originalItems[0]!;

                        const { result } = applyWritesToItemsInTesting(
                            [
                                {
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'create',
                                        data: {
                                            id: 'new2',
                                            text: 'sue'
                                        }
                                    }
                                },
                                {
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'update',
                                        method: 'merge',
                                        data: {

                                            // @ts-ignore wilfully breaking schema here 
                                            none_key: 'T1'
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
                            {
                                atomic: false
                            }
                        );
                        if (mutable === 'mutable' && immer !== 'immer') {
                            // Mutable without immer does not support referential comparison
                            expect(result.changes.referential_comparison_ok).toBe(false);
                        } else {
                            expect(result.changes.referential_comparison_ok).toBe(true);

                            expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");

                            expect(result.changes.final_items === originalItems).toBe(false);
                            expect(result.changes.final_items).not.toEqual(originalItems);
                            expect(originalItems[0] === obj1Ref).toBe(true);
                            expect(originalItems.length).toBe(1);
                            expect(result.changes.final_items.length).toBe(2);
                        }



                    });

                })

                describe('no change', () => {
                    test(`no reference changes with 0 writes`, (cx) => {

                        const originalItems = [
                            structuredClone(obj1)
                        ];
                        const obj1Ref = originalItems[0]!;

                        const { result } = applyWritesToItemsInTesting(
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
                            ddl
                        );
                        if (mutable === 'mutable' && immer !== 'immer') {
                            // Mutable without immer does not support referential comparison
                            expect(result.changes.referential_comparison_ok).toBe(false);
                        } else {
                            expect(result.changes.referential_comparison_ok).toBe(true);

                            expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error("noop");

                            expect(result.changes.final_items === originalItems).toBe(true);
                            expect(result.changes.final_items).toEqual(originalItems);
                            expect(originalItems[0] === obj1Ref).toBe(true);
                        }



                    });

                    test(`no reference changes with 1 write, 1 fail and atomic=true`, (cx) => {



                        const originalItems = [
                            structuredClone(obj1)
                        ];
                        const obj1Ref = originalItems[0]!;

                        const { result } = applyWritesToItemsInTesting(
                            [
                                {
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'create',
                                        data: {
                                            id: 'new2',
                                            text: 'sue'
                                        }
                                    }
                                },
                                {
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'update',
                                        method: 'merge',
                                        data: {
                                            // @ts-ignore wilfully breaking schema here 
                                            none_key: 'T1'
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
                            {
                                atomic: true
                            }
                        );
                        if (mutable === 'mutable' && immer !== 'immer') {
                            // Mutable without immer does not support referential comparison
                            expect(result.changes.referential_comparison_ok).toBe(false);
                        } else {
                            expect(result.changes.referential_comparison_ok).toBe(true);

                            expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                            expect(result.changes.final_items === originalItems).toBe(true);
                            expect(result.changes.final_items).toEqual(originalItems);
                            expect(originalItems[0] === obj1Ref).toBe(true);
                        }



                    });

                    test(`no reference changes with 1 write on array_scope (recursed), 1 fail and atomic=true`, (cx) => {

                        const originalItems: Obj[] = [
                            {
                                id: '1',
                                children: [
                                    { cid: '1', children: [] }
                                ]
                            }
                        ];
                        const obj1Ref = originalItems[0];

                        const { result } = applyWritesToItemsInTesting(
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
                                    type: 'write', ts: 0, uuid: '0', payload: {
                                        type: 'update',
                                        method: 'merge',
                                        data: {
                                            // @ts-ignore wilfully breaking schema here 
                                            none_key: 'T1'
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
                            {
                                atomic: true
                            }

                        );
                        if (mutable === 'mutable' && immer !== 'immer') {
                            // Mutable without immer does not support referential comparison
                            expect(result.changes.referential_comparison_ok).toBe(false);
                        } else {
                            expect(result.changes.referential_comparison_ok).toBe(true);

                            expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");


                            expect(result.changes.final_items === originalItems).toBe(true);
                            expect(result.changes.final_items).toEqual(originalItems);
                            expect(originalItems[0] === obj1Ref).toBe(true);
                            expect(originalItems[0] === result.changes.final_items[0]).toBe(true);
                        }



                    });

                })

            })


            describe('Integrity', () => {
                test(`cannot dupe primary key`, () => {

                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
                    );


                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");

                    const firstFailedAction = result.failed_actions[0]!;
                    expect(firstFailedAction.unrecoverable).toBe(true);
                    expect(firstFailedAction.affected_items![0]!.error_details[0]!.type).toBe('create_duplicated_key');
                });

                test(`not allowed to change primary key`, (cx) => {

                    const originalItems = [structuredClone(obj1)];
                    const { result } = applyWritesToItemsInTesting(
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
                        ddl
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

                describe('attempt_recover_duplicate_create', () => {
                    test(`recovers with if-identical`, () => {

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

                        const { result } = applyWritesToItemsInTesting(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'if-identical',
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


                    test(`fails for if-identical if not identical`, () => {

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

                        const { result } = applyWritesToItemsInTesting(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'if-identical',
                            }
                        );

                        expect(result.status).toBe('error');
                        expect(result.changes.final_items[0]!.text).toBe('Alice');


                    })

                    test(`recovers for always-update`, () => {

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

                        const { result } = applyWritesToItemsInTesting(
                            actions,
                            [existing],
                            ObjSchema,
                            ddl,
                            undefined,
                            {
                                attempt_recover_duplicate_create: 'always-update',
                            }
                        );

                        expect(result.status).toBe('ok');
                        expect(result.changes.final_items[0]!.text).toBe('Bob');


                    })
                })
            })



            describe('permissions', () => {



                test(`create succeed`, () => {

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

                    const { result } = applyWritesToItemsInTesting(
                        actions,
                        [],
                        ObjSchema,
                        ddlP,
                        user1
                    );

                    expect(result.status).toBe('ok');


                })

                test(`create fail`, () => {

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

                    const { result } = applyWritesToItemsInTesting(
                        actions,
                        [],
                        ObjSchema,
                        ddlP,
                        user1
                    );

                    expect(result.status).toBe('error'); if (result.status !== 'error') throw new Error("noop");
                    expect(result.failed_actions[0]!.error_details[0]!.type).toBe('permission_denied');


                })

                test(`update succeed`, () => {

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

                    const { result } = applyWritesToItemsInTesting(
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

                test(`atomic=false`, () => {

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

                    const { result } = applyWritesToItemsInTesting(
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

                test(`atomic=true`, () => {

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

                    const { result } = applyWritesToItemsInTesting(
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
            })






            describe('config', () => {
                test('throws error if trying to use immer and immutable', (cx) => {
                    if (name !== 'immutable') cx.skip()
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

                    const retypedApplyWritesToItemsInTesting = castApplyWritesToItemsInTestingFn<Regress>(applyWritesToItemsInTesting);

                    const { result } = retypedApplyWritesToItemsInTesting(
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


                    const { result: result2 } = retypedApplyWritesToItemsInTesting(
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


test('Prove Immer flags objects even if no material change #immer_cannot_mutate_in_atomic', () => {
    const originalItems = [{ id: 1, text: 'Bob' }, { id: 2, text: '' }];
    const finalItems = produce(originalItems, draft => {

    });
    // The final items have changed
    expect(finalItems).toBe(originalItems);

    const originalItemsFlagged = [{ id: 1, text: 'Bob' }, { id: 2, text: '' }];
    const finalItemsFlagged = produce(originalItems, draft => {
        draft[1]!.text = 'Alice';
        draft[1]!.text = ''; // Restore
    });
    // The final items have changed
    expect(finalItemsFlagged).not.toBe(originalItemsFlagged);
})