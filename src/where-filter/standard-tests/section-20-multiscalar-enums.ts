import { StringEnumSchema, NumEnumSchema, MixedEnumSchema, MultiScalarSchema, type NumEnum, type MixedEnum, type MultiScalar } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §20. Multi-scalar unions & enums.
 *
 * Enum fields drive the SQL type-cast path (string enum → ::text, numeric enum → ::numeric, mixed →
 * raw/no-cast). A multi-scalar union field must stay type-faithful: `$eq`/bare equality compares by
 * value AND type (no `1 == true`), typed range operators only apply to the matching arm, and a range
 * operator against the wrong runtime type is a rejection, not a silent false.
 */
export function registerMultiScalarEnums(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected, expectOrAcknowledgeDivergence } = ctx;

    describe('20. Multi-scalar unions & enums', () => {

        test('20.1 string-enum equality match', async () => {
            const result = await matchJavascriptObject({ id: 'x', status: 'active' }, { status: 'active' }, StringEnumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.2 string-enum equality mismatch', async () => {
            const result = await matchJavascriptObject({ id: 'x', status: 'archived' }, { status: 'active' }, StringEnumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('20.3 string-enum $in member', async () => {
            const result = await matchJavascriptObject({ id: 'x', status: 'active' }, { status: { $in: ['active'] } }, StringEnumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.4 numeric-enum equality', async () => {
            const result = await matchJavascriptObject({ id: 'x', rank: 0 }, { rank: 0 }, NumEnumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.5 numeric-enum does not equal a same-digit string', async () => {
            const result = await matchJavascriptObject({ id: 'x', rank: '0' } as unknown as NumEnum, { rank: 0 }, NumEnumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('20.6 mixed-enum numeric member matches', async () => {
            const result = await matchJavascriptObject({ id: 'x', kind: 0 }, { kind: 0 }, MixedEnumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.7 mixed-enum string-digit does not equal the numeric member', async () => {
            const result = await matchJavascriptObject({ id: 'x', kind: '0' } as unknown as MixedEnum, { kind: 0 }, MixedEnumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('20.8 multi-scalar $gt on a number value matches', async () => {
            const result = await matchJavascriptObject({ id: 'x', secret: 5 }, { secret: { $gt: 1 } } as unknown as WhereFilterDefinition, MultiScalarSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.9 multi-scalar $gt against a string value is rejected', async () => {
            // MEASURED: JS throws by design ("Cannot compare value of type string with filter of type number",
            // the documented type-safety throw). SQL may cast-and-error or return false → divergent surface.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'x', secret: 'z' }, { secret: { $gt: 1 } } as unknown as WhereFilterDefinition, MultiScalarSchema));
        });

        test('20.10 multi-scalar $type "string" on a string value', async () => {
            const result = await matchJavascriptObject({ id: 'x', secret: 'z' }, { secret: { $type: 'string' } }, MultiScalarSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.11 multi-scalar $type "bool" on a boolean value', async () => {
            const result = await matchJavascriptObject({ id: 'x', secret: true }, { secret: { $type: 'bool' } }, MultiScalarSchema);
            expectOrAcknowledgeDivergence(result, true, '#5 $type bool on SQLite');
        });

        test('20.12 multi-scalar bare null matches a null value', async () => {
            const result = await matchJavascriptObject({ id: 'x', secret: null } as unknown as MultiScalar, { secret: null } as unknown as WhereFilterDefinition, MultiScalarSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('20.13 multi-scalar bare null does not match a string value', async () => {
            const result = await matchJavascriptObject({ id: 'x', secret: 'z' }, { secret: null } as unknown as WhereFilterDefinition, MultiScalarSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

    });
}
