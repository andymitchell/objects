import { ContactSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";
import type { WhereFilterDefinition } from "../types.ts";

/** §5. Edge cases. */
export function registerEdgeCases(ctx: SectionCtx): void {
    const { describe, test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    // A field explicitly set to `undefined` is a deliberately-malformed filter value the compile-time type now
    // rejects (see types.test.ts); this states it verbatim to keep the runtime "never matches" behaviour tested.
    const bad = (f: unknown): WhereFilterDefinition => f as WhereFilterDefinition;

    describe('5. Edge cases', () => {

        test('empty filter {} matches all', async () => {
            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {},
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, true);
        });

        test('undefined filter value: returns false', async () => {


            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                bad({
                    $or: [
                        { 'contact.name': undefined }
                    ]
                }),
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, false);
        })


        test('{$or: []} matches nothing (no conditions to succeed)', async () => {


            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {
                    $or: []
                },
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, false);
        })

        test('{$and: []} matches all (no conditions to fail)', async () => {


            const result = await matchJavascriptObject(
                {
                    contact: {
                        name: 'Andy',
                        emailAddress: 'andy@andy.com'
                    }
                },
                {
                    $and: []
                },
                ContactSchema
            );

            expectOrAcknowledgeUnsupported(result, true);
        })

        test('{$nor: []} matches all (no conditions to match negatively)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                { $nor: [] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('non-existent deep dot-prop path: returns false', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                // @ts-ignore
                { 'contact.nonexistent.deep': 'x' },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('{$and: [{}]} matches all (empty sub-filter matches all)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                { $and: [{}] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('empty string \'\' matches empty-string filter (distinct present value)', async () => {
            // '' is a valid distinct value. An impl that coerces '' to "missing"
            // silently breaks form-validation queries.
            const result = await matchJavascriptObject(
                { contact: { name: '' } },
                { 'contact.name': '' },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('missing field does not match empty-string filter', async () => {
            // Pins the '' !== undefined boundary.
            const result = await matchJavascriptObject(
                { contact: { name: 'Andy' } },
                { 'contact.emailAddress': '' },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('$exists true matches a field whose value is empty string (\'\' is present)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: '', emailAddress: '' } },
                { 'contact.emailAddress': { $exists: true } },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

    });
}
