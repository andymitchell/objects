import { RegexSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §11. `$regex` engine fidelity.
 *
 * The JS reference is a real `RegExp`; the SQLite engine best-effort-translates `$regex` to `LIKE`
 * (documented case-insensitivity, divergence #3) and its complexity detector governs which patterns
 * it can express. These pin the pattern surface (literals, anchors, quantifiers, LIKE-metachar escaping,
 * `$options`) and the rejection surface for invalid flags/patterns.
 */
export function registerRegexFidelity(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectMalformedFilterRejected, expectOrAcknowledgeDivergence } = ctx;

    describe('11. $regex engine fidelity', () => {

        test('11.1 literal word containing "d" matches', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'andy' }, { name: { $regex: 'andy' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.2 literal "bob" matches', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'bob' }, { name: { $regex: 'bob' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.3 literal "Wednesday" matches', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'Wednesday' }, { name: { $regex: 'Wednesday' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.4 quantifier "a{2}" matches "aa"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'aa' }, { name: { $regex: 'a{2}' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.5 quantifier "a{2}" rejects "a"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'a' }, { name: { $regex: 'a{2}' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('11.6 "a-b" matches literally', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'a-b' }, { name: { $regex: 'a-b' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.7 mid-string escaped "^" matches literally', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'a^b' }, { name: { $regex: 'a\\^b' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.8 pattern "50%" matches literal percent (LIKE metachar escaped)', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: '50%' }, { name: { $regex: '50%' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.9 pattern "a_b" matches literal underscore (LIKE metachar escaped)', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'a_b' }, { name: { $regex: 'a_b' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.10 "50%" does not wildcard-match unrelated "50x"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: '50x' }, { name: { $regex: '50%' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('11.11 "^abc$" matches exactly', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'abc' }, { name: { $regex: '^abc$' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.12 "^abc$" rejects a superstring', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'abcd' }, { name: { $regex: '^abc$' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('11.13 prefix "^abc" matches "abcd"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'abcd' }, { name: { $regex: '^abc' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.14 suffix "abc$" matches "zabc"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'zabc' }, { name: { $regex: 'abc$' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.15 $options "i" honoured', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'ABC' }, { name: { $regex: 'abc', $options: 'i' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.16 case-sensitive by default: "andy" does not match "Andy"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'Andy' }, { name: { $regex: 'andy' } }, RegexSchema);
            // SQLite translates $regex→LIKE (ASCII case-insensitive) so it matches; JS/PG do not.
            expectOrAcknowledgeDivergence(result, false, '#3 $regex case-sensitivity on SQLite');
        });

        test('11.17 $options "m" (multiline) honoured', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'a\nb' }, { name: { $regex: '^b', $options: 'm' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.18 $options "s" (dotall) honoured', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'a\nb' }, { name: { $regex: 'a.b', $options: 's' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.19 $options "x" is rejected', async () => {
            // MEASURED: JS `new RegExp('a b','x')` throws "Invalid flags" — JS has no extended flag.
            // Spec: an unsupported flag must be rejected, not silently applied. SQLite (ignores options) / PG
            // (drops m/s/x/u) do not throw here → rejection-surface divergence, expected RED.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'r', name: 'ab' }, { name: { $regex: 'a b', $options: 'x' } }, RegexSchema));
        });

        test('11.20 multi-flag "im" honoured', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'A\nB' }, { name: { $regex: '^b', $options: 'im' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.21 invalid flag "q" is rejected', async () => {
            // MEASURED: JS throws "Invalid flags". SQLite maps to undefined/false (no throw) → RED there.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'r', name: 'a' }, { name: { $regex: 'a', $options: 'q' } }, RegexSchema));
        });

        test('11.22 invalid pattern "(" is rejected', async () => {
            // MEASURED: JS throws "Invalid regular expression". PG throws at query time; SQLite may not → divergent surface.
            await expectMalformedFilterRejected(() => matchJavascriptObject({ id: 'r', name: 'a' }, { name: { $regex: '(' } }, RegexSchema));
        });

        test('11.23 character class "[abc]" matches "b"', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'b' }, { name: { $regex: '[abc]' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('11.24 "." wildcard matches any single char', async () => {
            const result = await matchJavascriptObject({ id: 'r', name: 'aXb' }, { name: { $regex: 'a.b' } }, RegexSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

    });
}
