import { TagsSchema, NullishGridSchema, ObjArraySchema, RegexSchema, SpreadNestedSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §14. `$size` contract.
 *
 * `$size` must count only a real array's length: a negative/float/string operand is malformed (spec:
 * reject), a missing or scalar field is a clean `false` (never a crash, never a silent 0-length match),
 * and `$size` composes with `$not`, `$elemMatch`, and spread paths.
 */
export function registerSizeContract(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected, expectOrAcknowledgeDivergence } = ctx;

    describe('14. $size contract', () => {

        test('14.1 negative $size is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $size: -1 } }, TagsSchema));
        });

        test('14.2 float $size is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $size: 2.5 } }, TagsSchema));
        });

        test('14.3 string $size is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $size: '2' } } as unknown as WhereFilterDefinition, TagsSchema));
        });

        test('14.4 $size 0 on an empty array is true', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $size: 0 } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('14.5 $size 0 on a non-empty array is false', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $size: 0 } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('14.6 $size 0 on a missing array is false', async () => {
            const result = await matchJavascriptObject({ id: 'x' }, { arr: { $size: 0 } }, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('14.7 $size 0 on an explicit-null array is false', async () => {
            const result = await matchJavascriptObject({ id: 'x', arr: null }, { arr: { $size: 0 } }, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('14.8 $size 1 matches a single-element array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $size: 1 } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('14.9 $size on a scalar field is false, no crash', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'A' }, { name: { $size: 2 } } as unknown as WhereFilterDefinition, RegexSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('14.10 $size inside $elemMatch counts the element array', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', tags: ['x'] }] }, { items: { $elemMatch: { tags: { $size: 1 } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('14.11 $not $size of a different length is true', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $not: { $size: 2 } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('14.12 $not $size of the same length is false', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $not: { $size: 1 } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('14.13 $not $size of a float is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $not: { $size: 2.5 } } }, TagsSchema));
        });

        test('14.14 $size on a spread dot-prop leaf matches the leaf array length', async () => {
            const result = await matchJavascriptObject(
                { parent_name: 'p', children: [{ child_name: 'c', grandchildren: [{ grandchild_name: 'g' }] }] },
                { 'children.grandchildren': { $size: 1 } } as unknown as WhereFilterDefinition,
                SpreadNestedSchema
            );
            expectOrAcknowledgeDivergence(result, true, '#6 $size on spread dot-prop paths');
        });

    });
}
