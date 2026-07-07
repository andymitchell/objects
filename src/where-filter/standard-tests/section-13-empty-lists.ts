import { ContactSchema, TagsSchema } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §13. Empty-list operands.
 *
 * `$in:[]` matches nothing and `$nin:[]` matches everything (the vacuous-truth boundaries). Postgres
 * guards these with constant `1=0`/`1=1`; SQLite emits a bare `IN ()` / `NOT IN ()`, which is a syntax
 * error — so these pin the guard and its asymmetry. `$all:[]` is the documented match-everything divergence.
 */
export function registerEmptyLists(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

    describe('13. Empty-list operands', () => {

        test('13.1 scalar $in [] matches nothing', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $in: [] } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('13.2 scalar $nin [] matches everything', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.name': { $nin: [] } }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('13.3 array-field $in [] matches nothing', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $in: [] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('13.4 array-field $nin [] matches everything', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $nin: [] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('13.5 $in [] on an empty array field is false', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $in: [] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('13.6 $all [] matches everything', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $all: [] } }, TagsSchema);
            expectOrAcknowledgeDivergence(result, true, '#2 $all empty matches everything');
        });

        test('13.7 $all [] on an empty array still matches everything', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [] }, { tags: { $all: [] } }, TagsSchema);
            expectOrAcknowledgeDivergence(result, true, '#2 $all empty matches everything');
        });

        test('13.8 a non-empty $in still works (guard-asymmetry control)', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $in: ['a', 'b'] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('13.9 numeric $in [] matches nothing', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [1] }, { nums: { $in: [] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('13.10 numeric $nin [] matches everything', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: [], nums: [1] }, { nums: { $nin: [] } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('13.11 $in [] inside $elemMatch matches nothing', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $in: [] } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('13.12 $nin [] inside $elemMatch matches every element', async () => {
            const result = await matchJavascriptObject({ id: 't', tags: ['a'], nums: [] }, { tags: { $elemMatch: { $nin: [] } } }, TagsSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

    });
}
