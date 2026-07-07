import { TagsSchema, ObjArraySchema, NestedItemsSchema, MixedArraySchema, DeepSpread3Schema, ContactSchema, RegexSchema, NullishGridSchema } from "./fixtures.ts";
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

    });
}
