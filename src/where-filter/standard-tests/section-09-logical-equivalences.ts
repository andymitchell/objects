import { z } from "zod";
import { ContactSchema } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/** §9. Logical equivalences (property tests) — De Morgan, double negation. */
export function registerLogicalEquivalences(ctx: SectionCtx): void {
    const { test, expect, matchJavascriptObject } = ctx;

    describe('9. Logical equivalences (property tests)', () => {

        const dataset: Array<z.infer<typeof ContactSchema>> = [
            { contact: { name: 'Andy', age: 30 } },
            { contact: { name: 'Bob', age: 50 } },
            { contact: { name: 'Andy', age: 50 } },
            { contact: { name: 'Carol' } },
        ];

        /** Run two filters over the same dataset and assert identical booleans per item. */
        async function assertEquivalent(
            a: WhereFilterDefinition<z.infer<typeof ContactSchema>>,
            b: WhereFilterDefinition<z.infer<typeof ContactSchema>>,
        ) {
            for (const item of dataset) {
                const ra = await matchJavascriptObject(item, a, ContactSchema);
                const rb = await matchJavascriptObject(item, b, ContactSchema);
                if (ra === undefined || rb === undefined) continue;
                expect(ra).toBe(rb);
            }
        }

        describe('De Morgan\'s laws', () => {

            test('NOT (A AND B) ≡ (NOT A) OR (NOT B)', async () => {
                // Catches an impl that mis-distributes $nor over $and: such an impl
                // passes every example-based section-1 test yet diverges on combined queries.
                const A: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.name': 'Andy' };
                const B: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.age': 30 };
                const lhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { $nor: [{ $and: [A, B] }] };
                const rhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { $or: [{ $nor: [A] }, { $nor: [B] }] };
                await assertEquivalent(lhs, rhs);
            });

            test('NOT (A OR B) ≡ (NOT A) AND (NOT B)', async () => {
                // Pins the multi-element-array semantics of $nor.
                const A: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.name': 'Andy' };
                const B: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.age': 30 };
                const lhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { $nor: [A, B] };
                const rhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { $and: [{ $nor: [A] }, { $nor: [B] }] };
                await assertEquivalent(lhs, rhs);
            });

        });

        describe('Double negation', () => {

            test('field-level: $not($not(X)) ≡ X (when field is present)', async () => {
                // $not nesting appears in machine-generated queries (e.g. an access-policy
                // compiler that wraps every clause). An impl that early-returns on the inner
                // $not instead of fully recursing fails this and silently mis-evaluates.
                //
                // Restricted to present-field data: under MongoDB semantics, field-level $not
                // also matches missing fields (see existing test '$not on missing optional
                // field: passes'). That rule breaks the bare double-negation tautology when
                // the field can be missing — the bug-catching intent is preserved on data
                // where the field is present.
                const presentFieldData: Array<z.infer<typeof ContactSchema>> = [
                    { contact: { name: 'Andy', age: 30 } },
                    { contact: { name: 'Bob', age: 20 } },
                    { contact: { name: 'Carol', age: 25 } },
                ];
                // @ts-expect-error — type union for $not's argument doesn't include
                // ValueComparisonNot, so nested $not is not modelled at the type level.
                // Runtime supports it; this test pins the runtime behaviour.
                const lhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.age': { $not: { $not: { $gt: 25 } } } };
                const rhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.age': { $gt: 25 } };
                for (const item of presentFieldData) {
                    const ra = await matchJavascriptObject(item, lhs, ContactSchema);
                    const rb = await matchJavascriptObject(item, rhs, ContactSchema);
                    if (ra === undefined || rb === undefined) continue;
                    expect(ra).toBe(rb);
                }
            });

            test('top-level: $nor[$nor[X]] ≡ X', async () => {
                const X: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { 'contact.name': 'Andy' };
                const lhs: WhereFilterDefinition<z.infer<typeof ContactSchema>> = { $nor: [{ $nor: [X] }] };
                await assertEquivalent(lhs, X);
            });

        });

    });
}
