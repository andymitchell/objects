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

        // ── No leaf array at all is a missing field ────────────────────────────────────────────────
        //
        // `groups.tags` is answered by asking each `groups` entry for its `tags`. When there are no entries —
        // the outer array is absent, or present but empty — there is no `tags` array anywhere, and the path
        // names nothing. That is exactly a missing field, so the condition's own verdict on a missing field
        // decides the row. An implementation that only asks "did some leaf array satisfy this?" answers false
        // instead, dropping every row an operator like `$nin` or `$exists: false` must return.
        describe('a nested-array path keeps the missing-field verdict when no leaf array exists', () => {
            const absent: NestedScalarArray = { id: 'x' };
            const empty: NestedScalarArray = { id: 'x', groups: [] };
            const noLeafArray = (row: NestedScalarArray, filter: unknown) =>
                matchJavascriptObject(row, filter as WhereFilterDefinition<NestedScalarArray>, NestedScalarArraySchema);

            test('$nin matches, because a missing field holds none of the forbidden values', async () => {
                expect(await noLeafArray(absent, { 'groups.tags': { $nin: ['x'] } })).toBe(true);
                expect(await noLeafArray(empty, { 'groups.tags': { $nin: ['x'] } })).toBe(true);
            });
            test('$exists:false matches, because the path names nothing', async () => {
                expect(await noLeafArray(absent, { 'groups.tags': { $exists: false } })).toBe(true);
                expect(await noLeafArray(empty, { 'groups.tags': { $exists: false } })).toBe(true);
            });
            test('$not $size matches, because the $size it negates does not match a missing field', async () => {
                expect(await noLeafArray(absent, { 'groups.tags': { $not: { $size: 1 } } })).toBe(true);
                expect(await noLeafArray(empty, { 'groups.tags': { $not: { $size: 1 } } })).toBe(true);
            });
            test('$size does not match, because a missing field has no length', async () => {
                expect(await noLeafArray(absent, { 'groups.tags': { $size: 1 } })).toBe(false);
                expect(await noLeafArray(empty, { 'groups.tags': { $size: 1 } })).toBe(false);
            });
            test('$exists:true does not match, because the path names nothing', async () => {
                expect(await noLeafArray(absent, { 'groups.tags': { $exists: true } })).toBe(false);
                expect(await noLeafArray(empty, { 'groups.tags': { $exists: true } })).toBe(false);
            });
            test('present leaf arrays are still judged per leaf: $nin holds when ANY one leaf holds none of the forbidden values', async () => {
                // The one leaf array holds 'x', so no leaf satisfies $nin — the row does not match.
                expect(await noLeafArray({ id: 'x', groups: [{ tags: ['x'] }] }, { 'groups.tags': { $nin: ['x'] } })).toBe(false);
                // The first leaf array holds none of them, so it satisfies $nin — pooling both leaves would wrongly see 'x'.
                expect(await noLeafArray({ id: 'x', groups: [{ tags: ['a'] }, { tags: ['x'] }] }, { 'groups.tags': { $nin: ['x'] } })).toBe(true);
            });
        });

        // ── An exact-array operand compares the leaf array, not the element holding it ─────────────
        //
        // `children.grandchildren` names one `grandchildren` array per `children` entry. An exact-array operand
        // is compared against those leaf arrays — never against the `children` element that carries one, which
        // is an object and can never equal an array. The row matches when ANY single leaf array equals it.
        describe('an exact array on a nested-array path compares against one leaf array', () => {
            const oneChildEquals: SpreadNested = {
                parent_name: 'p',
                children: [
                    { child_name: 'Sue', grandchildren: [{ grandchild_name: 'Rita' }] },
                    { child_name: 'Alice', grandchildren: [{ grandchild_name: 'Bob' }, { grandchild_name: 'Sue' }] },
                ],
            };
            const noChildEquals: SpreadNested = {
                parent_name: 'p',
                children: [
                    { child_name: 'Sue', grandchildren: [{ grandchild_name: 'Bob' }] },
                    // Holds Rita, but alongside another grandchild, so this leaf array is not the operand.
                    { child_name: 'Alice', grandchildren: [{ grandchild_name: 'Rita' }, { grandchild_name: 'Bob' }] },
                ],
            };
            const exactArrayFilter = { 'children.grandchildren': [{ grandchild_name: 'Rita' }] };
            const exactLeafArray = (row: SpreadNested) =>
                matchJavascriptObject(row, exactArrayFilter as WhereFilterDefinition<SpreadNested>, SpreadNestedSchema);

            test('a leaf array equal to the operand matches, even under an outer array', async () => {
                expect(await exactLeafArray(oneChildEquals)).toBe(true);
            });
            test('a leaf array merely containing the operand’s element does not match', async () => {
                expect(await exactLeafArray(noChildEquals)).toBe(false);
            });
        });

        // ── A bare-string $elemMatch beneath an intermediate array is leaf-scoped ─────────────────
        //
        // `{'groups.tags': {$elemMatch: 'a'}}` asks whether ONE `groups` entry's `tags` contains `'a'`. The
        // whole-path accessor cannot descend the outer array, so the verdict is read per leaf array.
        describe('a string $elemMatch beneath an intermediate array is scoped to one leaf array', () => {
            const onNested = (row: NestedScalarArray, filter: unknown) =>
                matchJavascriptObject(row, filter as WhereFilterDefinition<NestedScalarArray>, NestedScalarArraySchema);

            test('a leaf array containing the string matches', async () => {
                expect(await onNested({ id: 'x', groups: [{ tags: ['a'] }] }, { 'groups.tags': { $elemMatch: 'a' } })).toBe(true);
            });
            test('a leaf array not containing the string does not match', async () => {
                expect(await onNested({ id: 'x', groups: [{ tags: ['b'] }] }, { 'groups.tags': { $elemMatch: 'a' } })).toBe(false);
            });
        });

        // ── An empty $all is vacuously satisfied ─────────────────────────────────────────────────
        //
        // `$all: []` is the conjunction of no conditions — true for any leaf array the path reaches. (A leaf
        // array must be present for the outer array to hold one; an absent outer array is the missing-field
        // case pinned above.)
        describe('an empty $all is vacuously satisfied by a leaf array under an intermediate array', () => {
            test('a present leaf array under an intermediate array satisfies { $all: [] }', async () => {
                const row: SpreadNested = { parent_name: 'p', children: [{ child_name: 's', grandchildren: [{ grandchild_name: 'r' }] }] };
                expect(await matchJavascriptObject(row, { 'children.grandchildren': { $all: [] } } as WhereFilterDefinition<SpreadNested>, SpreadNestedSchema)).toBe(true);
            });
        });

    });
}
