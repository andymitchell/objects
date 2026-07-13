import { TagsSchema, BoolFlagsSchema, BoolLeafSchema, ObjArraySchema, NestedItemsSchema, MixedArraySchema, DeepSpread3Schema, ContactSchema, RegexSchema, NullishGridSchema } from "./fixtures.ts";
import type { Tags, BoolFlags, BoolLeaf } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §18. Array semantics (deep).
 *
 * Exact-array and deep-object equality are key-order-insensitive (JS deepEql / PG jsonb; SQLite's TEXT
 * compare is not). `$all` on object elements requires EXACT element equality (not containment). `$in`/
 * `$nin` on an array are set intersection. `$elemMatch` recurses and no-ops safely on scalar/missing
 * fields. Dot-prop spreading reaches arbitrarily deep leaves.
 */
export function registerArraySemantics(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    // Nested spreading-array fixtures (three and four array levels).
    const spread3 = (leaf: string) => ({ a: [{ b: [{ c: [{ leaf }] }] }] });
    const spread4 = { a: [{ b: [{ c: [{ leaf: 'v', d: [{ leaf: 'w' }] }] }] }] };

    describe('18. Array semantics (deep)', () => {

        test('18.1 exact-array match is key-order-insensitive', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: [{ v: 1, k: 'a' }] }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.2 exact-array match with the same key order (control)', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: [{ k: 'a', v: 1 }] }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.3 deep object equality is key-order-insensitive', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'x', age: 1 } }, { contact: { age: 1, name: 'x' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.4 $all with an object element requires EXACT equality (not containment)', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1, tags: ['t'] }] }, { items: { $all: [{ k: 'a', v: 1 }] } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.5 $all with an exactly-equal object element matches', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: { $all: [{ k: 'a', v: 1 }] } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.6 $in on an array is intersection (overlap → true)', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a', 'b'], nums: [] }, { tags: { $in: ['b', 'z'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.7 $in on an array is intersection (no overlap → false)', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $in: ['z'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.8 $nin on an array with no intersection matches', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $nin: ['z'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.9 $elemMatch on a scalar field is false, no crash', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'A' }, { name: { $elemMatch: { $gt: 0 } } } as unknown as WhereFilterDefinition, RegexSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.10 $elemMatch on a missing field is false', async () => {
            const result = await matchJavascriptObject({ id: 'x' }, { arr: { $elemMatch: { $gt: 0 } } } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.11 nested $elemMatch matches', async () => {
            const result = await matchJavascriptObject({ id: 'n', items: [{ k: 'a', sub: [{ n: 1 }] }] }, { items: { $elemMatch: { sub: { $elemMatch: { n: 1 } } } } }, NestedItemsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.12 nested $elemMatch with no match is false', async () => {
            const result = await matchJavascriptObject({ id: 'n', items: [{ k: 'a', sub: [{ n: 2 }] }] }, { items: { $elemMatch: { sub: { $elemMatch: { n: 1 } } } } }, NestedItemsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.13 compound object filter: one element satisfies all keys', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: { k: 'a', v: 1 } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.14 compound object filter: keys split across elements is false', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 2 }, { k: 'b', v: 1 }] }, { items: { k: 'a', v: 1 } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.15 dot-prop spreading allows keys across different elements', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 2 }, { k: 'b', v: 1 }] }, { $and: [{ 'items.k': 'a' }, { 'items.v': 1 }] } as unknown as WhereFilterDefinition, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.16 scalar element match in a mixed (string | object) array', async () => {
            const result = await matchJavascriptObject({ id: '1', mixed: ['x', { k: 'a' }] }, { mixed: 'x' } as unknown as WhereFilterDefinition, MixedArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.17 3-level spreading matches the leaf', async () => {
            const result = await matchJavascriptObject(spread3('v'), { 'a.b.c.leaf': 'v' } as unknown as WhereFilterDefinition, DeepSpread3Schema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.18 3-level spreading with no match is false', async () => {
            const result = await matchJavascriptObject(spread3('v'), { 'a.b.c.leaf': 'nope' } as unknown as WhereFilterDefinition, DeepSpread3Schema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.19 4-level spreading matches the leaf', async () => {
            const result = await matchJavascriptObject(spread4, { 'a.b.c.d.leaf': 'w' } as unknown as WhereFilterDefinition, DeepSpread3Schema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.20 $in [a] on an empty array is false', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $in: ['a'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.21 $nin [a] on an empty array is true', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $nin: ['a'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.22 $all [a] on an empty array is false', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $all: ['a'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.23 $elemMatch scalar on an empty array is false', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $elemMatch: 'a' } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.24 $size 0 on an empty array is true', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $size: 0 } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.25 $all with duplicates [1,1] matches', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [1] }, { nums: { $all: [1, 1] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.26 $all with a single scalar element matches', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [5] }, { nums: { $all: [5] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.27 $elemMatch {$in} on a scalar array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $in: ['a', 'z'] } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.28 $elemMatch {$nin} on a scalar array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $nin: ['z'] } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.29 $elemMatch {$ne} on a scalar array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a', 'b'], nums: [] }, { tags: { $elemMatch: { $ne: 'a' } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.30 $elemMatch {$exists:true} on a scalar array is false', async () => {
            // MEASURED: JS returns false — $exists inside $elemMatch does not apply element-wise (it checks the field).
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $exists: true } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.31 $elemMatch {$type:string} on a scalar array is false', async () => {
            // MEASURED: JS returns false — $type inside $elemMatch does not apply element-wise (it checks the field).
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $type: 'string' } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('18.32 $elemMatch {$regex} on a scalar array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['ax'], nums: [] }, { tags: { $elemMatch: { $regex: '^a' } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.33 $all is order-independent', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a', 'b', 'c'], nums: [] }, { tags: { $all: ['c', 'a'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('18.34 $elemMatch mixing $exists with a scalar predicate matches nothing (companion to 18.30/18.31)', async () => {
            // MEASURED: false on every engine — see MONGO-DIVERGENCES.md #15. A field-level operator ($exists/$type)
            // anywhere in a scalar $elemMatch body routes the WHOLE body to a per-element deep-equal, so it is compared
            // as the literal object {$exists:true,$eq:'a'} against each element; no scalar element equals that object.
            // MongoDB instead reads the body element-wise, where 'a' satisfies both, and matches. Every consumer
            // returns a real boolean here (the $eq gives SQL a concrete predicate), so this is a required
            // cross-engine law, and the divergence from MongoDB is a conservative under-match.
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $exists: true, $eq: 'a' } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        /**
         * A comparison operator on an array field reads element-wise: it matches when SOME element satisfies it.
         *
         * The negated forms are the reason this block is strict rather than acknowledged. `$ne` is the complement
         * of `$eq` — "no element equals it" — so an operator that failed to reach the elements would make its own
         * negation match everything, and an engine could return rows that hold the very value the caller excluded.
         * A cross-engine gap here is therefore unsound, not merely inconsistent.
         */
        describe('18.35 a comparison operator on an array field reads element-wise', () => {

            const tags = (values: string[]) => ({ id: 't', tags: values, nums: [] });
            const nums = (values: number[]) => ({ id: 't', tags: [], nums: values });
            // The schema-derived type and the validity gate offer an array field the same comparison vocabulary,
            // so every filter below is one a caller can write in TypeScript AND one that can arrive as raw JSON.
            // Both routes reach the engines, and the engines must agree on them — which this block holds them to.
            const arrayField = (row: Tags, filter: WhereFilterDefinition<Tags>) =>
                matchJavascriptObject(row, filter, TagsSchema);

            test('$eq matches when an element equals the operand', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $eq: 'a' } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$eq does not match when no element equals the operand', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $eq: 'z' } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$eq matches a numeric element, which must not be compared as text', async () => {
                const result = await arrayField(nums([1, 9]), { nums: { $eq: 9 } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$ne on a numeric array is the complement of $eq', async () => {
                const result = await arrayField(nums([1, 9]), { nums: { $ne: 9 } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('a range bound compares numerically, not lexically', async () => {
                const result = await arrayField(nums([-8]), { nums: { $lt: -9 } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$ne is the complement of $eq, so an array holding the operand does not match', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $ne: 'a' } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$ne matches when no element equals the operand', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $ne: 'z' } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$ne matches an empty array, which holds nothing to equal the operand', async () => {
                const result = await arrayField(tags([]), { tags: { $ne: 'a' } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('a range bound matches when an element satisfies it', async () => {
                const result = await arrayField(nums([1, 9]), { nums: { $gt: 5 } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('a range bound does not match when no element satisfies it', async () => {
                const result = await arrayField(nums([1, 4]), { nums: { $gt: 5 } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('each bound is applied independently, so different elements may satisfy different bounds', async () => {
                const result = await arrayField(nums([1, 5]), { nums: { $gt: 2, $lt: 4 } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$elemMatch asks the stricter question — one element must satisfy the whole body', async () => {
                const result = await arrayField(nums([1, 5]), { nums: { $elemMatch: { $gt: 2, $lt: 4 } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$regex matches when an element matches the pattern', async () => {
                const result = await arrayField(tags(['ann', 'bob']), { tags: { $regex: '^a' } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$regex does not match when no element matches the pattern', async () => {
                const result = await arrayField(tags(['ann', 'bob']), { tags: { $regex: '^z' } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('negating $eq excludes an array that holds the operand', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $not: { $eq: 'a' } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('negating $eq matches an array that does not hold the operand', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $not: { $eq: 'z' } } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('negating a range bound excludes an array with an element that satisfies it', async () => {
                const result = await arrayField(nums([1, 9]), { nums: { $not: { $gt: 5 } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('negating a $regex excludes an array with an element that matches it', async () => {
                const result = await arrayField(tags(['ann']), { tags: { $not: { $regex: '^a' } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$size still describes the array itself rather than an element', async () => {
                const result = await arrayField(tags(['a', 'b']), { tags: { $not: { $size: 3 } } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });
        });

        /**
         * The element being compared is a BOOLEAN — the one element type an engine cannot reach by comparing
         * text, and the one an equality operator cannot reach by comparing numbers either. An engine that
         * projects its elements as text to compare them will compile a statement that has no meaning (or no
         * answer) for a boolean, so this block separates "reads element-wise" from "reads element-wise, for the
         * element types that happen to survive the projection".
         */
        describe('18.36 an element comparison holds a boolean element to its own type', () => {

            const flags = (values: boolean[]) => ({ id: 'f', flags: values });
            const boolField = (row: BoolFlags, filter: WhereFilterDefinition<BoolFlags>) =>
                matchJavascriptObject(row, filter, BoolFlagsSchema);

            test('$eq matches when an element is the operand', async () => {
                const result = await boolField(flags([true]), { flags: { $eq: true } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$eq does not match when no element is the operand', async () => {
                const result = await boolField(flags([false]), { flags: { $eq: true } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$eq does not match an empty array, which holds no element to be the operand', async () => {
                const result = await boolField(flags([]), { flags: { $eq: true } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('negating $eq excludes an array that holds the operand', async () => {
                const result = await boolField(flags([true]), { flags: { $not: { $eq: true } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('negating $eq matches an array that does not hold the operand', async () => {
                const result = await boolField(flags([false]), { flags: { $not: { $eq: true } } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('negating $eq matches an empty array', async () => {
                const result = await boolField(flags([]), { flags: { $not: { $eq: true } } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('a bare boolean asks for containment', async () => {
                const result = await boolField(flags([true]), { flags: true });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('a bare boolean does not match an array holding only the other value', async () => {
                const result = await boolField(flags([false]), { flags: true });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$elemMatch with an $eq body reaches the boolean element', async () => {
                const result = await boolField(flags([true]), { flags: { $elemMatch: { $eq: true } } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$elemMatch with a bare boolean body reaches the boolean element', async () => {
                const result = await boolField(flags([true]), { flags: { $elemMatch: true } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$elemMatch requires ONE element to satisfy a compound boolean body', async () => {
                const result = await boolField(flags([true]), { flags: { $elemMatch: { $eq: true, $in: [true] } } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$elemMatch with a compound body no element satisfies does not match', async () => {
                const result = await boolField(flags([true]), { flags: { $elemMatch: { $eq: true, $in: [false] } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$in over a boolean array is set intersection (control — already type-faithful)', async () => {
                const result = await boolField(flags([true]), { flags: { $in: [true] } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('$in does not match when the array holds only the other value (control)', async () => {
                const result = await boolField(flags([false]), { flags: { $in: [true] } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            // The same boolean comparison, one array level down: the leaf is read from every spread element, and
            // that reading is projected out of the element — the projection a boolean cannot survive.
            //
            // A dot-prop path THROUGH an array is a filter only the gate admits: the schema-derived type does not
            // generate one (a separate gap, pinned in types.test.ts), so such a filter reaches the engines only as
            // JSON — which is exactly why the engines must still agree on it.
            const items = (done: boolean[]) => ({ id: 'f', items: done.map((d, i) => ({ k: `k${i}`, done: d })) });
            const boolLeaf = (row: BoolLeaf, filter: unknown) =>
                matchJavascriptObject(row, filter as WhereFilterDefinition<BoolLeaf>, BoolLeafSchema);

            test('a boolean leaf below an array matches when some element carries it', async () => {
                const result = await boolLeaf(items([false, true]), { 'items.done': true });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('a boolean leaf below an array does not match when no element carries it', async () => {
                const result = await boolLeaf(items([false, false]), { 'items.done': true });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$eq on a boolean leaf below an array reads the element, not its text', async () => {
                const result = await boolLeaf(items([false, true]), { 'items.done': { $eq: true } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });

            test('negating $eq on a boolean leaf below an array denies the whole path', async () => {
                const result = await boolLeaf(items([false, true]), { 'items.done': { $not: { $eq: true } } });
                expectOrAcknowledgeUnsupported(result, false, 'comparison operator on an array field');
            });

            test('$in on a boolean leaf below an array is set intersection', async () => {
                const result = await boolLeaf(items([false, true]), { 'items.done': { $in: [true] } });
                expectOrAcknowledgeUnsupported(result, true, 'comparison operator on an array field');
            });
        });

    });
}
