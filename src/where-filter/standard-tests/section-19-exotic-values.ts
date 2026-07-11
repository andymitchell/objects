import { BigNumSchema, UnicodeSchema, BooleanContactSchema, MultiScalarSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * Section 19. Exotic values and binding.
 *
 * The numeric and string boundaries a matcher must survive without crashing or coercing: NaN / signed
 * zero / big-int doubles, no numeric-to-string coercion, boolean equality, unicode normalisation (no
 * implicit NFC/NFD folding), emoji, embedded quotes and null-bytes bound safely, and huge strings.
 * Non-JSON operands (Date/bigint/Symbol) are malformed and rejected.
 */
export function registerExoticValues(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected, expectOrAcknowledgeDivergence } = ctx;

    // Explicit code points so the source stays byte-unambiguous (all ASCII in this file).
    const CAFE_NFC = 'caf\u00e9';         // NFC: e-acute as one code point U+00E9
    const CAFE_NFD = 'cafe\u0301';        // NFD: plain e + combining acute U+0301
    const EMOJI = '\u{1F44D}\u{1F3FD}';   // thumbs-up + skin-tone modifier
    const NULL_BYTE = 'a\u0000b';         // embedded U+0000

    describe('19. Exotic values & binding', () => {

        test('19.1 $in [NaN] never matches a finite number', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5 }, { n: { $in: [NaN] } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.2 $in [1, NaN, 3] matches a finite member', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 3 }, { n: { $in: [1, NaN, 3] } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.3 2^53+1 equality (both collapse to the same double)', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 9007199254740993 }, { n: 9007199254740993 }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.4 an adjacent representable big int does not match', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 9007199254740994 }, { n: 9007199254740993 }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.5 -0 equals +0 under $eq', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: -0 }, { n: { $eq: 0 } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.6 a numeric filter does not match a stored numeric-string', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: '7' }, { s: 7 } as unknown as WhereFilterDefinition, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.7 a numeric filter matches a stored number (control)', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 7 }, { n: 7 }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.8 boolean $eq true matches true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': { $eq: true } }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.9 boolean $eq false matches false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: false } }, { 'contact.isVIP': { $eq: false } }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.10 boolean $eq true does not match false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: false } }, { 'contact.isVIP': { $eq: true } }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.11 bare boolean equality matches', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': true }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.12 $type "bool" on a boolean field', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': { $type: 'bool' } }, BooleanContactSchema);
            expectOrAcknowledgeDivergence(result, true, '#5 $type bool on SQLite');
        });

        test('19.13 $in [true] matches a boolean field', async () => {
            // A boolean is a first-class `$in` operand (as for `$eq`): membership over a boolean field compares
            // type-faithfully, so `{$in:[true]}` matches the `isVIP: true` row.
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': { $in: [true] } }, BooleanContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.14 unicode NFC equals NFC', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: CAFE_NFC }, { s: CAFE_NFC }, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.15 NFC does not equal NFD (no normalization)', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: CAFE_NFC }, { s: CAFE_NFD }, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.16 emoji equality', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: EMOJI }, { s: EMOJI }, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.17 embedded quotes are bound safely', async () => {
            const result = await matchJavascriptObject({ id: 'u', s: 'a"b\'c' }, { s: 'a"b\'c' }, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.18 a 1MB string equality does not crash', async () => {
            const big = 'x'.repeat(1_000_000);
            const result = await matchJavascriptObject({ id: 'u', s: big }, { s: big }, UnicodeSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.19 a null byte in the value binds and matches', async () => {
            // JS and SQLite bind and match U+0000 (strict true); Postgres text/jsonb cannot store it, so its store
            // fails and the value never matches — a documented single-engine storage limit (MONGO-DIVERGENCES.md #10).
            const result = await matchJavascriptObject({ id: 'u', s: NULL_BYTE }, { s: NULL_BYTE }, UnicodeSchema);
            expectOrAcknowledgeDivergence(result, true, '#10 Postgres cannot store a U+0000 (null byte)');
        });

        test('19.20 a Date operand is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'u', s: 'x' }, { s: new Date() } as unknown as WhereFilterDefinition, UnicodeSchema));
        });

        test('19.21 a bigint operand is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'b', n: 1 }, { n: BigInt(1) } as unknown as WhereFilterDefinition, BigNumSchema));
        });

        test('19.22 a Symbol operand is rejected', async () => {
            // SPEC-INTENT: strict rejection; current JS returns false — expected RED until validation tightened.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'u', s: 'x' }, { s: Symbol('x') } as unknown as WhereFilterDefinition, UnicodeSchema));
        });

        test('19.23 $eq NaN matches nothing', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5 }, { n: { $eq: NaN } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.24 $ne NaN matches everything', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5 }, { n: { $ne: NaN } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('19.25 $gt 1e308 on a finite number is false', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5 }, { n: { $gt: 1e308 } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('19.26 multi-scalar $eq true does not match a stored 1', async () => {
            const result = await matchJavascriptObject({ id: 'x', secret: 1 }, { secret: { $eq: true } } as unknown as WhereFilterDefinition, MultiScalarSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

    });
}
