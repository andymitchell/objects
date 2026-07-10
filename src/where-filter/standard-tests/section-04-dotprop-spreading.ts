import { NestedScalarArraySchema, SpreadNestedSchema, type NestedScalarArray, type SpreadNested } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/** §4. Dot-prop paths and array spreading. */
export function registerDotPropSpreading(ctx: SectionCtx): void {
    const { test, expect, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('4. Dot-prop paths and array spreading', () => {

        test('spread-nesting via dot-prop: passes', async () => {

            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': {
                        grandchild_name: 'Rita'
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });


        test('spread-nesting via dot-prop: fails', async () => {

            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 5
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 10
                                }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': {
                        grandchild_name: 'Bob'
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });



        test('spread-nesting where first path is not the target: passes', async () => {

            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Harold'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': {
                        grandchild_name: 'Rita'
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });



        test('spread-nesting written as nested object (not dot-prop): passes', async () => {


            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita'
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });


        test('spread-nesting written as nested object (not dot-prop): fails', async () => {


            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita'
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Bob'
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });


        test('spread-nesting multi-criteria compound filter (within 1 array): exact match semantics', async () => {
            // Under exact document match (Mongo), no single grandchild has both
            // grandchild_name='Rita' AND age=3 (Rita has age=2, Bob has age=3).
            // Under old per-key-OR this passed; under Mongo semantics it fails.
            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Harold',
                                    age: 1
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 2
                                },
                                {
                                    grandchild_name: 'Bob',
                                    age: 3
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita',
                            age: 3
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('spread-nesting multi-criteria compound filter: passes when single element matches all', async () => {
            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                { grandchild_name: 'Harold', age: 1 }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                { grandchild_name: 'Rita', age: 2 },
                                { grandchild_name: 'Bob', age: 3 }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita',
                            age: 2
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });


        test('$size on spread dot-prop path: passes when leaf array matches', async () => {
            // Array operators ($size) must compose correctly with array spreading.
            // If SQL uses flattened CROSS JOIN, it might evaluate $size against
            // flattened elements rather than the leaf arrays.
            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: []
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                { grandchild_name: 'Rita' },
                                { grandchild_name: 'Harold' }
                            ]
                        }
                    ]
                },
                {
                    'children.grandchildren': { $size: 2 }
                },
                SpreadNestedSchema
            );
            // $size binds to ONE leaf array (Alice's two grandchildren), never to the pooled elements of
            // every leaf array. Strict: an implementation that flattens the spread cannot satisfy this.
            expectOrAcknowledgeUnsupported(result, true, '$size on a spread dot-prop leaf');
        });

        test('spread-nesting multi-criteria compound filter (within 1 array): fails', async () => {


            const result = await matchJavascriptObject<SpreadNested>(
                {
                    parent_name: 'Bob',
                    children: [
                        {
                            child_name: 'Sue',
                            grandchildren: [
                                {
                                    grandchild_name: 'Harold',
                                    age: 1
                                }
                            ]
                        },
                        {
                            child_name: 'Alice',
                            grandchildren: [
                                {
                                    grandchild_name: 'Rita',
                                    age: 2
                                },
                                {
                                    grandchild_name: 'Bob',
                                    age: 3
                                }
                            ]
                        }
                    ]
                },
                {
                    'children': {
                        'grandchildren': {
                            grandchild_name: 'Rita',
                            age: 1
                        }
                    }
                },
                SpreadNestedSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        // ── Leaf scope: a predicate on a nested-array path binds to ONE leaf array ─────────────────
        //
        // `groups.tags` reaches several `tags` arrays — one per `groups` entry. The whole field condition
        // must be satisfied by a single one of them; the row matches if ANY leaf array satisfies it. An
        // implementation that pools every leaf array's elements into one flat set matches rows it must not.
        describe('a nested-array path binds its predicate to a single leaf array', () => {
            const split: NestedScalarArray = { id: 'x', groups: [{ tags: ['a'] }, { tags: ['bx'] }] };
            const together: NestedScalarArray = { id: 'x', groups: [{ tags: ['a', 'bx'] }, { tags: [] }] };
            const scalarLeaf = (row: NestedScalarArray, filter: unknown) =>
                matchJavascriptObject(row, filter as WhereFilterDefinition<NestedScalarArray>, NestedScalarArraySchema);

            test('$all terms scattered across two leaf arrays do not match', async () => {
                expect(await scalarLeaf(split, { 'groups.tags': { $all: ['a', 'bx'] } })).toBe(false);
            });
            test('$all terms present together in one leaf array match', async () => {
                expect(await scalarLeaf(together, { 'groups.tags': { $all: ['a', 'bx'] } })).toBe(true);
            });
            test('a compound $all + $elemMatch satisfied only across two leaf arrays does not match', async () => {
                expect(await scalarLeaf(split, { 'groups.tags': { $all: ['a'], $elemMatch: { $eq: 'bx' } } })).toBe(false);
            });
            test('a compound $all + $elemMatch satisfied within one leaf array matches', async () => {
                expect(await scalarLeaf(together, { 'groups.tags': { $all: ['a'], $elemMatch: { $eq: 'bx' } } })).toBe(true);
            });

            // The same law where the leaf array holds objects rather than scalars.
            const objSplit: SpreadNested = {
                parent_name: 'p',
                children: [
                    { child_name: 'Sue', grandchildren: [{ grandchild_name: 'Rita' }] },
                    { child_name: 'Alice', grandchildren: [{ grandchild_name: 'Bob' }] },
                ],
            };
            const objTogether: SpreadNested = {
                parent_name: 'p',
                children: [
                    { child_name: 'Sue', grandchildren: [{ grandchild_name: 'Rita' }, { grandchild_name: 'Bob' }] },
                    { child_name: 'Alice', grandchildren: [] },
                ],
            };
            const objFilter = { 'children.grandchildren': { $all: [{ grandchild_name: 'Rita' }], $elemMatch: { grandchild_name: 'Bob' } } };
            const objectLeaf = (row: SpreadNested) =>
                matchJavascriptObject(row, objFilter as unknown as WhereFilterDefinition<SpreadNested>, SpreadNestedSchema);

            test('an object-leaf compound satisfied only across two leaf arrays does not match', async () => {
                expect(await objectLeaf(objSplit)).toBe(false);
            });
            test('an object-leaf compound satisfied within one leaf array matches', async () => {
                expect(await objectLeaf(objTogether)).toBe(true);
            });
        });

    });
}
