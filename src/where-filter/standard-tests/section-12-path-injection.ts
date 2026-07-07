import { ContactSchema, TagsSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §12. Path integrity & injection.
 *
 * `$exists` and `$type` build their SQL accessor from the raw filter-key segments rather than the
 * validating path converter every other operator uses. These pin two guarantees: an unknown path is a
 * clean `false`/skip (never a match), and a quote (or a `DROP TABLE`) embedded in a filter KEY can never
 * break out of the emitted SQL — the worst-case outcome is `false`/skip, never a DB error or a match.
 */
export function registerPathInjection(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('12. Path integrity & injection', () => {

        test('12.1 $exists:false on an unknown path is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.ghost': { $exists: false } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.2 $exists:true on an unknown path is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.ghost': { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.3 $type on an unknown path is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.ghost': { $type: 'string' } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.4 a single-quote in a $exists key stays safe (false, never a DB error)', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { "contact.na'me": { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.5 a single-quote in a $type key stays safe', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { "x'y": { $type: 'string' } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.6 a DROP-TABLE-style $exists key stays safe', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { "a'); DROP TABLE t;--": { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.7 $exists:true on a present scalar is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $exists: true } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.8 $exists:true on a missing optional is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.age': { $exists: true } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.9 $type array-branch on an unknown path is false', async () => {
            const result = await matchJavascriptObject({ id: '1', tags: ['a'], nums: [] }, { ghost: { $type: 'array' } } as unknown as WhereFilterDefinition, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.10 a single-quote in a $type array-branch key stays safe', async () => {
            const result = await matchJavascriptObject({ id: '1', tags: ['a'], nums: [] }, { "ta'gs": { $type: 'array' } } as unknown as WhereFilterDefinition, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.11 $exists on an absent spread leaf is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.locations.city': { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('12.12 $exists on a present spread leaf is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', locations: [{ city: 'NY' }] } }, { 'contact.locations.city': { $exists: true } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.13 $type "string" on a present nested string is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $type: 'string' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('12.14 $type "number" on a present nested number is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', age: 5 } }, { 'contact.age': { $type: 'number' } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

    });
}
