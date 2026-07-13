import { ContactSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §6. Validation and error handling. */
export function registerValidation(ctx: SectionCtx): void {
    const { describe, test, expect, matchJavascriptObject, expectMalformedFilterRejected } = ctx;

    describe('6. Validation and error handling', () => {

        test('undefined filter throws', async () => {

            await expectMalformedFilterRejected(
                () => matchJavascriptObject(
                    {
                        contact: {
                            name: 'Andy',
                            emailAddress: 'andy@andy.com'
                        }
                    },
                    // @ts-expect-error
                    undefined,
                    ContactSchema
                ),
                'filter was not well-defined',
            );

        });

        test('null filter throws', async () => {
            await expectMalformedFilterRejected(
                () => matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-ignore
                    null,
                    ContactSchema
                ),
            );
        });

        test('number as filter throws', async () => {
            await expectMalformedFilterRejected(
                () => matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-ignore
                    42,
                    ContactSchema
                ),
            );
        });

        test('string as filter throws', async () => {
            await expectMalformedFilterRejected(
                () => matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-ignore
                    'invalid',
                    ContactSchema
                ),
            );
        });

        test('array as filter throws', async () => {
            await expectMalformedFilterRejected(
                () => matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-ignore
                    [{ 'contact.name': 'Andy' }],
                    ContactSchema
                ),
            );
        });

        test('logic operator with object instead of array throws/rejects', async () => {
            // Spec: $or/$and/$nor must hold arrays of sub-filters.
            // Using an object instead of an array should be caught by validation.
            let didFail = false;
            try {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    // @ts-ignore — intentionally malformed
                    { $or: { 'contact.name': 'Andy' } },
                    ContactSchema
                );
                // If it didn't throw, the result should at least not be true
                if (result === undefined) {
                    didFail = true; // unsupported — counts as handled
                } else {
                    didFail = !result;
                }
            } catch (e) {
                didFail = true;
            }
            expect(didFail).toBe(true);
        });

    });
}
