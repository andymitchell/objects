import { z } from "zod";
import { ContactSchema, NullishGridSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §21. Logic-tree torture.
 *
 * The empty-logic identities (`$and:[]`→true, `$or:[]`→false, `$nor:[]`→true) pinned cross-engine; wide
 * (1000-key implicit `$and`) and deep (8-level nested `$elemMatch`) trees that must not overflow or
 * mis-evaluate; and `$nor`'s three-valued behaviour over absent fields.
 */
export function registerLogicTrees(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('21. Logic-tree torture', () => {

        test('21.1 empty $and matches everything', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { $and: [] }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.2 empty $or matches nothing', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { $or: [] }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('21.3 empty $nor matches everything', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { $nor: [] }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.4 $and:[{}] matches everything', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { $and: [{}] }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.5 a 1000-key implicit $and, all matching, is true', async () => {
            // A 1000-key object root: the torture targets filter-tree WIDTH; an object root keeps the case
            // constructible by schema-gated engines (a record root is not a single object shape).
            const WideSchema = z.object(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`f${i}`, z.string()])));
            const wide: Record<string, string> = {};
            for (let i = 0; i < 1000; i++) wide[`f${i}`] = `v${i}`;
            const result = await matchJavascriptObject(wide, { ...wide } as unknown as WhereFilterDefinition, WideSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.6 a 1000-key implicit $and with one mismatch is false', async () => {
            // A 1000-key object root — see 21.5.
            const WideSchema = z.object(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`f${i}`, z.string()])));
            const wide: Record<string, string> = {};
            for (let i = 0; i < 1000; i++) wide[`f${i}`] = `v${i}`;
            const filter = { ...wide, f500: 'WRONG' };
            const result = await matchJavascriptObject(wide, filter as unknown as WhereFilterDefinition, WideSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('21.7 an 8-level nested $elemMatch matches', async () => {
            let schema: z.ZodTypeAny = z.object({ leaf: z.number() });
            let obj: unknown = { leaf: 1 };
            let filter: unknown = { leaf: 1 };
            for (let i = 0; i < 8; i++) {
                schema = z.object({ items: z.array(schema) });
                obj = { items: [obj] };
                filter = { items: { $elemMatch: filter } };
            }
            const result = await matchJavascriptObject(obj as Record<string, any>, filter as unknown as WhereFilterDefinition, schema as unknown as z.ZodType<Record<string, any>>);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.8 an 8-level nested $elemMatch with a leaf mismatch is false', async () => {
            let schema: z.ZodTypeAny = z.object({ leaf: z.number() });
            let obj: unknown = { leaf: 1 };
            let filter: unknown = { leaf: 2 };
            for (let i = 0; i < 8; i++) {
                schema = z.object({ items: z.array(schema) });
                obj = { items: [obj] };
                filter = { items: { $elemMatch: filter } };
            }
            const result = await matchJavascriptObject(obj as Record<string, any>, filter as unknown as WhereFilterDefinition, schema as unknown as z.ZodType<Record<string, any>>);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('21.9 $nor over a null field is definitely true', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: null }, { $nor: [{ n: { $gt: 5 } }] } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.10 $nor over a missing field is definitely true', async () => {
            const result = await matchJavascriptObject({ id: 'x' }, { $nor: [{ n: { $gt: 5 } }] } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.11 $nor where one of two arms matches is false', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A', age: 30 } }, { $nor: [{ 'contact.name': 'A' }, { 'contact.age': 99 }] }, ContactSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('21.12 a 3-level $and > $or > $nor tree (positive)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'A', age: 30 } },
                { $and: [{ $or: [{ 'contact.name': 'A' }, { 'contact.name': 'B' }] }, { $nor: [{ 'contact.age': 99 }] }] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('21.13 a 3-level tree where the $nor arm matches (negative)', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'A', age: 30 } },
                { $and: [{ $or: [{ 'contact.name': 'A' }, { 'contact.name': 'B' }] }, { $nor: [{ 'contact.age': 30 }] }] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('21.14 $or and $nor on one object are ANDed', async () => {
            const result = await matchJavascriptObject(
                { contact: { name: 'A', age: 30 } },
                { $or: [{ 'contact.name': 'A' }], $nor: [{ 'contact.age': 30 }] },
                ContactSchema
            );
            expectOrAcknowledgeUnsupported(result, false);
        });

    });
}
