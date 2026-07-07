import { TagsSchema, ContactSchema, BigNumSchema, NullishGridSchema, ObjArraySchema, BooleanContactSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §22. $type mapping.
 *
 * `$type` checks the FIELD's own runtime type, not its elements (divergence #1): an array field is
 * `'array'`, never the element type. `'number'` covers ints and reals, `'object'` excludes arrays,
 * `'null'` matches explicit null (and, per divergence #4, missing on JS), and the SQLite `'bool'`
 * mapping is a documented divergence (#5). `$type` composes with nested paths, spreading, and $elemMatch.
 */
export function registerTypeMapping(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

    describe('22. $type mapping', () => {

        test('22.1 $type "object" excludes arrays', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $type: 'object' } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('22.2 $type "object" matches a plain object', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { contact: { $type: 'object' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.3 $type "number" covers integers', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5 }, { n: { $type: 'number' } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.4 $type "number" covers reals', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5.5 }, { n: { $type: 'number' } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.5 $type "array" on an array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $type: 'array' } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.6 $type "array" on an empty array', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $type: 'array' } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.7 $type "string" on a string array is false (checks the field, not elements)', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $type: 'string' } }, TagsSchema);
            expectOrAcknowledgeDivergence(result, false, '#1 $type checks the field, not array elements');
        });

        test('22.8 $type "bool" maps a boolean field', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', isVIP: true } }, { 'contact.isVIP': { $type: 'bool' } }, BooleanContactSchema);
            expectOrAcknowledgeDivergence(result, true, '#5 $type bool on SQLite');
        });

        test('22.9 $type "null" on an explicit null', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: null }, { n: { $type: 'null' } }, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.10 $type "null" on a missing field', async () => {
            const result = await matchJavascriptObject({ id: 'x' }, { n: { $type: 'null' } }, NullishGridSchema);
            expectOrAcknowledgeDivergence(result, true, '#4 $type null on missing fields');
        });

        test('22.11 $type on a nested path', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $type: 'string' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.12 $type on a spread leaf', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', locations: [{ city: 'NY' }] } }, { 'contact.locations.city': { $type: 'string' } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.13 $type inside $elemMatch', async () => {
            const result = await matchJavascriptObject({ id: 'o', items: [{ k: 'a', v: 1 }] }, { items: { $elemMatch: { v: { $type: 'number' } } } }, ObjArraySchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('22.14 $type "string" on a number is false', async () => {
            const result = await matchJavascriptObject({ id: 'b', n: 5 }, { n: { $type: 'string' } }, BigNumSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

    });
}
