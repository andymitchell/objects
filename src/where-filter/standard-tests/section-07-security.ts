import { ContactSchema } from "./fixtures.ts";
import { DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED } from "../../dot-prop-paths/getPropertySimpleDot.js";
import type { SectionCtx } from "./harness.ts";

/** §7. Security — disallowed / prototype-pollution property paths. */
export function registerSecurity(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('7. Security', () => {

        describe('Prototype pollution paths', () => {
            for (const dotPath of DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED) {
                test(`disallowed path "${dotPath}" returns false`, async () => {

                    const result = await matchJavascriptObject(
                        {
                            contact: {
                                name: 'Andy',
                                emailAddress: 'andy@andy.com'
                            }
                        },
                        {
                            [dotPath]: 'Anything'
                        },
                        ContactSchema
                    );

                    // A disallowed path resolves to nothing on every engine, so the row cannot match — a
                    // strict false, never an acknowledged skip. resolvePath's own-property guard makes SQL
                    // deny an inherited key (`__proto__`, `constructor`) rather than silently decline it.
                    expect(result).toBe(false);

                });
            }
        });

        describe('Inherited members beyond the denylist', () => {
            // Every `Object.prototype` member — not just the denylisted pollution trio — must resolve as
            // absent: an inherited name is not data, so `$exists` cannot observe it on any engine.
            for (const name of ['toString', 'valueOf', 'hasOwnProperty']) {
                test(`inherited member "${name}" does not $exist, top-level or nested`, async () => {
                    expect(await matchJavascriptObject(
                        { contact: { name: 'Andy', emailAddress: 'andy@andy.com' } },
                        { [name]: { $exists: true } },
                        ContactSchema
                    )).toBe(false);
                    expect(await matchJavascriptObject(
                        { contact: { name: 'Andy', emailAddress: 'andy@andy.com' } },
                        { [`contact.${name}`]: { $exists: true } },
                        ContactSchema
                    )).toBe(false);
                });
            }
        });

        describe('SQL injection resistance', () => {
            test('crafted string value with SQL injection does not match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: "'; DROP TABLE users; --" } },
                    { 'contact.name': "'; DROP TABLE users; --" },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('crafted string value with different SQL injection: does not false-match', async () => {
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': "' OR '1'='1" },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });
        });

        describe('Resource exhaustion', () => {
            test('deeply nested $and/$or chains do not crash', async () => {
                // Build a 50-level deep nested filter
                let filter: any = { 'contact.name': 'Andy' };
                for (let i = 0; i < 50; i++) {
                    filter = i % 2 === 0 ? { $and: [filter] } : { $or: [filter] };
                }
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    filter,
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('large $in array does not crash', async () => {
                const largeList = Array.from({ length: 1000 }, (_, i) => `name_${i}`);
                largeList.push('Andy');
                const result = await matchJavascriptObject(
                    { contact: { name: 'Andy' } },
                    { 'contact.name': { $in: largeList } },
                    ContactSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });
        });

    });
}
