import { NestedScalarArraySchema, SpreadNestedSchema, NullableMemberArraySchema, ObjArraySchema, type NestedScalarArray, type SpreadNested, type NullableMemberArray, type ObjArray } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/** §4. Dot-prop paths and array spreading. */
export function registerDotPropSpreading(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    // A dotted path into an array of objects is not expressible in a schema-derived filter type, though the
    // validity gate accepts it — as MongoDB does. The battery holds every engine to it regardless.
    const objLeaf = (row: ObjArray, filter: unknown) =>
        matchJavascriptObject(row, filter as WhereFilterDefinition<ObjArray>, ObjArraySchema);

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

        // ── Leaf scope: a POSITIVE predicate on a nested-array path binds to ONE leaf array ────────
        //
        // `groups.tags` reaches several `tags` arrays — one per `groups` entry. A positive field condition
        // must be satisfied by a single one of them; the row matches if ANY leaf array satisfies it all.
        //
        // This is divergence #16. MongoDB instead flattens the path into one candidate set and applies each
        // operator to it independently, so it matches rows this package does not. The divergence is strictly
        // conservative — it can only UNDER-match — and these tests are what pin it. A negation is the one
        // thing that does not fold this way, because negating an under-match would over-match; it is lifted
        // to the whole path, and its own tests live with the missing-field verdicts below.
        describe('a positive predicate on a nested-array path binds to a single leaf array (divergence #16)', () => {
            const split: NestedScalarArray = { id: 'x', groups: [{ tags: ['a'] }, { tags: ['bx'] }] };
            const together: NestedScalarArray = { id: 'x', groups: [{ tags: ['a', 'bx'] }, { tags: [] }] };
            const scalarLeaf = (row: NestedScalarArray, filter: unknown) =>
                matchJavascriptObject(row, filter as WhereFilterDefinition<NestedScalarArray>, NestedScalarArraySchema);

            test('$all terms scattered across two leaf arrays do not match, where MongoDB matches them', async () => {
                expectOrAcknowledgeUnsupported(await scalarLeaf(split, { 'groups.tags': { $all: ['a', 'bx'] } }), false, 'nested-array leaf scope');
            });
            test('$all terms present together in one leaf array match', async () => {
                expectOrAcknowledgeUnsupported(await scalarLeaf(together, { 'groups.tags': { $all: ['a', 'bx'] } }), true, 'nested-array leaf scope');
            });
            test('a compound $all + $elemMatch satisfied only across two leaf arrays does not match, where MongoDB matches it', async () => {
                expectOrAcknowledgeUnsupported(await scalarLeaf(split, { 'groups.tags': { $all: ['a'], $elemMatch: { $eq: 'bx' } } }), false, 'nested-array leaf scope');
            });
            test('a compound $all + $elemMatch satisfied within one leaf array matches', async () => {
                expectOrAcknowledgeUnsupported(await scalarLeaf(together, { 'groups.tags': { $all: ['a'], $elemMatch: { $eq: 'bx' } } }), true, 'nested-array leaf scope');
            });
            test('a single-term predicate has nothing to split, so it agrees with MongoDB', async () => {
                expectOrAcknowledgeUnsupported(await scalarLeaf(split, { 'groups.tags': { $all: ['bx'] } }), true, 'nested-array leaf scope');
                expectOrAcknowledgeUnsupported(await scalarLeaf(split, { 'groups.tags': 'bx' }), true, 'nested-array leaf scope');
            });

            // The same law where the path ends at a SCALAR leaf: `items.v` reaches one number per element, and
            // both bounds must be met by the same one. MongoDB lets a different element answer each bound and
            // matches this row; that difference is the divergence, in its smallest form.
            test('range bounds met only by two different elements do not match, where MongoDB matches them', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf({ id: 'o', items: [{ k: 'a', v: 1 }, { k: 'b', v: 5 }] }, { 'items.v': { $gt: 2, $lt: 3 } }), false, 'nested-array leaf scope');
                // One element meets both, so the leaf-scoped reading and MongoDB's agree.
                expectOrAcknowledgeUnsupported(await objLeaf({ id: 'o', items: [{ k: 'a', v: 1 }, { k: 'b', v: 2.5 }] }, { 'items.v': { $gt: 2, $lt: 3 } }), true, 'nested-array leaf scope');
            });
        });

        /**
         * A value operator applied to a SCALAR leaf below an array.
         *
         * `items.k` reaches one `k` per element. A positive operator holds when SOME element's `k` satisfies it;
         * `$ne` is its complement and holds only when NONE does. Both readings must survive the array, and an
         * engine that cannot express the operator down there has to say so rather than quietly answer `false` —
         * which is what makes these strict rather than acknowledged.
         */
        describe('a value operator reaches a scalar leaf below an array', () => {
            const row: ObjArray = { id: 'o', items: [{ k: 'a', v: 1 }, { k: 'b', v: 5 }] };

            test('$eq matches when some element carries the value', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $eq: 'b' } }), true, 'value operator on a scalar leaf below an array');
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $eq: 'z' } }), false, 'value operator on a scalar leaf below an array');
            });
            test('$ne excludes the row when some element carries the value', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $ne: 'b' } }), false, 'value operator on a scalar leaf below an array');
            });
            test('$ne matches when no element carries the value', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $ne: 'z' } }), true, 'value operator on a scalar leaf below an array');
            });
            test('$not of $eq is the same denial as $ne', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $not: { $eq: 'b' } } }), false, 'value operator on a scalar leaf below an array');
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $not: { $eq: 'z' } } }), true, 'value operator on a scalar leaf below an array');
            });
            test('negation composes, so negating $ne asks whether some element does carry the value', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $not: { $ne: 'b' } } }), true, 'value operator on a scalar leaf below an array');
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $not: { $ne: 'z' } } }), false, 'value operator on a scalar leaf below an array');
            });
            test('a range bound matches when some element satisfies it', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.v': { $gt: 4 } }), true, 'value operator on a scalar leaf below an array');
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.v': { $gt: 9 } }), false, 'value operator on a scalar leaf below an array');
            });
            test('$regex matches when some element satisfies it', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $regex: '^b' } }), true, 'value operator on a scalar leaf below an array');
                expectOrAcknowledgeUnsupported(await objLeaf(row, { 'items.k': { $regex: '^z' } }), false, 'value operator on a scalar leaf below an array');
            });
            test('$elemMatch binds the condition to one element, which is a different question', async () => {
                expectOrAcknowledgeUnsupported(await objLeaf(row, { items: { $elemMatch: { k: { $ne: 'b' } } } }), true, 'value operator on a scalar leaf below an array');
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
                expectOrAcknowledgeUnsupported(await objectLeaf(objSplit), false, 'nested-array leaf scope');
            });
            test('an object-leaf compound satisfied within one leaf array matches', async () => {
                expectOrAcknowledgeUnsupported(await objectLeaf(objTogether), true, 'nested-array leaf scope');
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
                expectOrAcknowledgeUnsupported(await noLeafArray(absent, { 'groups.tags': { $nin: ['x'] } }), true, 'nested-array missing-field verdict');
                expectOrAcknowledgeUnsupported(await noLeafArray(empty, { 'groups.tags': { $nin: ['x'] } }), true, 'nested-array missing-field verdict');
            });
            test('$exists:false matches, because the path names nothing', async () => {
                expectOrAcknowledgeUnsupported(await noLeafArray(absent, { 'groups.tags': { $exists: false } }), true, 'nested-array missing-field verdict');
                expectOrAcknowledgeUnsupported(await noLeafArray(empty, { 'groups.tags': { $exists: false } }), true, 'nested-array missing-field verdict');
            });
            test('$not $size matches, because the $size it negates does not match a missing field', async () => {
                expectOrAcknowledgeUnsupported(await noLeafArray(absent, { 'groups.tags': { $not: { $size: 1 } } }), true, 'nested-array missing-field verdict');
                expectOrAcknowledgeUnsupported(await noLeafArray(empty, { 'groups.tags': { $not: { $size: 1 } } }), true, 'nested-array missing-field verdict');
            });
            test('$size does not match, because a missing field has no length', async () => {
                expectOrAcknowledgeUnsupported(await noLeafArray(absent, { 'groups.tags': { $size: 1 } }), false, 'nested-array missing-field verdict');
                expectOrAcknowledgeUnsupported(await noLeafArray(empty, { 'groups.tags': { $size: 1 } }), false, 'nested-array missing-field verdict');
            });
            test('$exists:true does not match, because the path names nothing', async () => {
                expectOrAcknowledgeUnsupported(await noLeafArray(absent, { 'groups.tags': { $exists: true } }), false, 'nested-array missing-field verdict');
                expectOrAcknowledgeUnsupported(await noLeafArray(empty, { 'groups.tags': { $exists: true } }), false, 'nested-array missing-field verdict');
            });
            test('a negation denies the whole path, so ONE leaf holding a forbidden value excludes the row', async () => {
                const L = 'nested-array negation denies the whole path';
                // $nin says no value the path reaches may be forbidden — not "some leaf avoids them". Reading it
                // per leaf would let a clean sibling leaf excuse the offending one, and return a row the caller
                // asked to exclude.
                expectOrAcknowledgeUnsupported(await noLeafArray({ id: 'x', groups: [{ tags: ['x'] }] }, { 'groups.tags': { $nin: ['x'] } }), false, L);
                expectOrAcknowledgeUnsupported(await noLeafArray({ id: 'x', groups: [{ tags: ['a'] }, { tags: ['x'] }] }, { 'groups.tags': { $nin: ['x'] } }), false, L);
                // No leaf holds a forbidden value, so the row does match.
                expectOrAcknowledgeUnsupported(await noLeafArray({ id: 'x', groups: [{ tags: ['a'] }, { tags: ['b'] }] }, { 'groups.tags': { $nin: ['x'] } }), true, L);
            });

            test('a negation composes, so negating it again asks whether some leaf DOES hold the value', async () => {
                const L = 'nested-array negation denies the whole path';
                expectOrAcknowledgeUnsupported(await noLeafArray({ id: 'x', groups: [{ tags: ['a'] }, { tags: ['x'] }] }, { 'groups.tags': { $not: { $nin: ['x'] } } }), true, L);
                expectOrAcknowledgeUnsupported(await noLeafArray({ id: 'x', groups: [{ tags: ['a'] }, { tags: ['b'] }] }, { 'groups.tags': { $not: { $nin: ['x'] } } }), false, L);
            });
        });

        // ── An array-descended $exists tests member PRESENCE, not the member's value ────────────────
        //
        // `items.value` reaches the `value` of each `items` element. A member that is present but holds a
        // JSON null still EXISTS — presence is `hasOwnProperty`, not "holds a non-null value". An element that
        // omits the member, and an empty outer array (no element to carry it), are both missing. A SQL engine
        // that projects the leaf as text collapses a JSON null to SQL NULL and would misread the present-null
        // member as missing; probing each spread element with `jsonb_typeof` keeps present-null distinct from
        // absent, so every engine agrees the present-null member exists while the absent member does not.
        describe('an array-descended $exists tests member presence, counting a present-but-null member', () => {
            const onItems = (row: NullableMemberArray, filter: unknown) =>
                matchJavascriptObject(row, filter as WhereFilterDefinition<NullableMemberArray>, NullableMemberArraySchema);

            const nullMember: NullableMemberArray = { id: 'x', items: [{ value: null }] };
            const stringMember: NullableMemberArray = { id: 'x', items: [{ value: 'v' }] };
            const absentMember: NullableMemberArray = { id: 'x', items: [{}] };
            const noElements: NullableMemberArray = { id: 'x', items: [] };

            test('$exists:true matches a present-but-null member', async () => {
                expectOrAcknowledgeUnsupported(await onItems(nullMember, { 'items.value': { $exists: true } }), true, 'array-descended $exists');
            });
            test('$exists:true matches a present string member', async () => {
                expectOrAcknowledgeUnsupported(await onItems(stringMember, { 'items.value': { $exists: true } }), true, 'array-descended $exists');
            });
            test('$exists:true does not match when every element omits the member key', async () => {
                expectOrAcknowledgeUnsupported(await onItems(absentMember, { 'items.value': { $exists: true } }), false, 'array-descended $exists');
            });
            test('$exists:true does not match when there is no element to carry the member', async () => {
                expectOrAcknowledgeUnsupported(await onItems(noElements, { 'items.value': { $exists: true } }), false, 'array-descended $exists');
            });
            test('$exists:false is the exact negation — true only when the member is absent, never for present-null', async () => {
                expectOrAcknowledgeUnsupported(await onItems(nullMember, { 'items.value': { $exists: false } }), false, 'array-descended $exists');
                expectOrAcknowledgeUnsupported(await onItems(stringMember, { 'items.value': { $exists: false } }), false, 'array-descended $exists');
                expectOrAcknowledgeUnsupported(await onItems(absentMember, { 'items.value': { $exists: false } }), true, 'array-descended $exists');
                expectOrAcknowledgeUnsupported(await onItems(noElements, { 'items.value': { $exists: false } }), true, 'array-descended $exists');
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
                expectOrAcknowledgeUnsupported(await exactLeafArray(oneChildEquals), true, 'exact array on nested-array path');
            });
            test('a leaf array merely containing the operand’s element does not match', async () => {
                expectOrAcknowledgeUnsupported(await exactLeafArray(noChildEquals), false, 'exact array on nested-array path');
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
                expectOrAcknowledgeUnsupported(await onNested({ id: 'x', groups: [{ tags: ['a'] }] }, { 'groups.tags': { $elemMatch: 'a' } }), true, '$elemMatch on nested array');
            });
            test('a leaf array not containing the string does not match', async () => {
                expectOrAcknowledgeUnsupported(await onNested({ id: 'x', groups: [{ tags: ['b'] }] }, { 'groups.tags': { $elemMatch: 'a' } }), false, '$elemMatch on nested array');
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
                expectOrAcknowledgeUnsupported(await matchJavascriptObject(row, { 'children.grandchildren': { $all: [] } } as WhereFilterDefinition<SpreadNested>, SpreadNestedSchema), true, 'empty $all on nested-array path');
            });
        });

    });
}
