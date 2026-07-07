import { BooleanContactSchema, NullishGridSchema, ObjArraySchema, UnicodeSchema, ContactSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §23. Coverage gaps.
 *
 * A grab-bag closing operator×context combinations the themed sections do not reach: bare-boolean
 * equality, odd-count `$not` nesting, `$regex`/`$size`/`$exists`/`$type` composed inside `$elemMatch` on
 * object arrays, `$or`+`$elemMatch` composites, mixed-type `$in`, and the scalar+range implicit-$and
 * equivalence. Plus the two SPEC-INTENT rejections `$ne null` / `$in [null]` on a nullable field.
 */
export function registerCoverageGaps(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected } = ctx;

    describe('23. Coverage gaps', () => {

        test('23.1 bare boolean false matches a false value', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: false } }, { 'contact.isVIP': false }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.2 bare boolean false does not match a true value', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': false }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('23.3 $eq false matches a false value', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: false } }, { 'contact.isVIP': { $eq: false } }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.4 $ne null on a nullable field is rejected', async () => {
            // SPEC-INTENT: strict rejection (types exclude null from $ne); current JS returns TRUE — expected RED.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 5 }, { n: { $ne: null } } as unknown as WhereFilterDefinition, NullishGridSchema));
        });

        test('23.5 $in [null] on a nullable field is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', n: 5 }, { n: { $in: [null] } } as unknown as WhereFilterDefinition, NullishGridSchema));
        });

        test('23.6 triple-nested $not $gt (equivalent to a single $not) on 30 is false', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: 30 }, { n: { $not: { $not: { $not: { $gt: 5 } } } } } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('23.7 triple-nested $not $gt on 3 is true', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: 3 }, { n: { $not: { $not: { $not: { $gt: 5 } } } } } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.8 $regex with $options inside $elemMatch on an object array (match)', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'ABC' }] }, { items: { $elemMatch: { k: { $regex: 'abc', $options: 'i' } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.9 $regex with $options inside $elemMatch on an object array (no match)', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'XYZ' }] }, { items: { $elemMatch: { k: { $regex: 'abc', $options: 'i' } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('23.10 $size inside $not inside $elemMatch (2 elements, not size 1) matches', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', tags: ['x', 'y'] }] }, { items: { $elemMatch: { tags: { $not: { $size: 1 } } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.11 $size inside $not inside $elemMatch (1 element, is size 1) is false', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', tags: ['x'] }] }, { items: { $elemMatch: { tags: { $not: { $size: 1 } } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('23.12 $all with duplicate object elements matches', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: { $all: [{ k: 'a', v: 1 }, { k: 'a', v: 1 }] } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.13 $exists field sub-filter inside $elemMatch on an object array', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: { $elemMatch: { v: { $exists: true } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.14 $type field sub-filter inside $elemMatch on an object array', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: { $elemMatch: { v: { $type: 'number' } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.15 a strict-shaped (field-operators-only) filter matches', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', age: 30 } }, { 'contact.name': 'A', 'contact.age': { $gte: 18 } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.16 a strict-shaped filter that mismatches is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', age: 10 } }, { 'contact.name': 'A', 'contact.age': { $gte: 18 } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('23.17 scalar+range implicit-$and equivalence: $gte 5 AND $lte 5 matches 5', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: 5 }, { $and: [{ n: { $gte: 5 } }, { n: { $lte: 5 } }] } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.18 the equivalent bare equality also matches 5', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: 5 }, { n: 5 }, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.19 $or combined with $elemMatch (match)', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a' }] }, { $or: [{ items: { $elemMatch: { k: 'a' } } }, { id: 'zzz' }] }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.20 $or combined with $elemMatch (no match)', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'b' }] }, { $or: [{ items: { $elemMatch: { k: 'a' } } }, { id: 'zzz' }] }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('23.21 mixed-type $in ["a", 7] on a string field matches the string member', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: 'a' }, { s: { $in: ['a', 7] } } as unknown as WhereFilterDefinition, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('23.22 mixed-type $in ["a", 7] does not match an unlisted string', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: 'b' }, { s: { $in: ['a', 7] } } as unknown as WhereFilterDefinition, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

    });
}
