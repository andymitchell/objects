import { NullishGridSchema, NullableAgeContactSchema, ContactSchema, type NullishGrid } from "./fixtures.ts";
import type { WhereFilterDefinition } from "../types.ts";
import type { SectionCtx } from "./harness.ts";

/**
 * §15. Nullish matrix.
 *
 * Every operator against a field in each of its two absent forms — missing (key not present) and
 * explicit `null` — pinned to the value-driven JS reference. This is the three-valued-logic core:
 * narrowing operators (`$eq 5`, `$in`, `$gt`, `$regex`, `$size`) fail on absent values; broadening ones
 * (`$ne`, `$nin`, `$not`, `$nor`) succeed; `$exists`/`$eq null` distinguish missing from null.
 */
export function registerNullishMatrix(ctx: SectionCtx): void {
    const { describe, test, matchJavascriptObject, expectOrAcknowledgeUnsupported, expectOrAcknowledgeDivergence } = ctx;

    // The nullable field types collapse the value-comparison operators to `never` (the very gap §15
    // exercises at runtime), so the grid filters are the untyped runtime form rather than per-row casts.
    const grid: { op: string; field: 'n' | 's' | 'arr'; filter: WhereFilterDefinition; missing: boolean; nul: boolean; missingDivergence?: string }[] = [
        { op: '$eq null', field: 'n', filter: { n: { $eq: null } }, missing: true, nul: true },
        { op: 'bare null', field: 'n', filter: { n: null }, missing: true, nul: true },
        { op: '$ne 5', field: 'n', filter: { n: { $ne: 5 } }, missing: true, nul: true },
        { op: '$in [5]', field: 'n', filter: { n: { $in: [5] } }, missing: false, nul: false },
        { op: '$nin [5]', field: 'n', filter: { n: { $nin: [5] } }, missing: true, nul: true },
        { op: '$not {$gt:5}', field: 'n', filter: { n: { $not: { $gt: 5 } } }, missing: true, nul: true },
        { op: '$exists true', field: 'n', filter: { n: { $exists: true } }, missing: false, nul: true },
        { op: '$exists false', field: 'n', filter: { n: { $exists: false } }, missing: true, nul: false },
        { op: "$type 'null'", field: 'n', filter: { n: { $type: 'null' } }, missing: false, nul: true },
        { op: "$not {$type:'null'}", field: 'n', filter: { n: { $not: { $type: 'null' } } }, missing: true, nul: false },
        { op: '$gt 5', field: 'n', filter: { n: { $gt: 5 } }, missing: false, nul: false },
        { op: "$regex 'x'", field: 's', filter: { s: { $regex: 'x' } }, missing: false, nul: false },
        { op: '$size 0', field: 'arr', filter: { arr: { $size: 0 } }, missing: false, nul: false },
        { op: '$all [1]', field: 'arr', filter: { arr: { $all: [1] } }, missing: false, nul: false },
        { op: '$elemMatch {$gt:0}', field: 'arr', filter: { arr: { $elemMatch: { $gt: 0 } } }, missing: false, nul: false },
    ];

    const nullObjFor = (field: 'n' | 's' | 'arr'): NullishGrid =>
        field === 'n' ? { id: 'x', n: null } : field === 's' ? { id: 'x', s: null } : { id: 'x', arr: null };

    describe('15. Nullish matrix', () => {

        for (const row of grid) {
            test(`${row.op} on a missing field`, async () => {
                const result = await matchJavascriptObject({ id: 'x' }, row.filter, NullishGridSchema);
                if (row.missingDivergence) expectOrAcknowledgeDivergence(result, row.missing, row.missingDivergence);
                else expectOrAcknowledgeUnsupported(result, row.missing);
            });

            test(`${row.op} on a null field`, async () => {
                const result = await matchJavascriptObject(nullObjFor(row.field), row.filter, NullishGridSchema);
                expectOrAcknowledgeUnsupported(result, row.nul);
            });
        }

        test('15.E3 $ne on an unknown field is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { ghostField: { $ne: 5 } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('15.E3b $nin on an unknown field is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { ghostField: { $nin: [5] } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('15.E3c $not on an unknown field is true', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { ghostField: { $not: { $gt: 5 } } } as unknown as WhereFilterDefinition, ContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('15.E4 a {field: undefined} filter never matches', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: 5 }, { n: undefined } as unknown as WhereFilterDefinition, NullishGridSchema);
            // Every engine returns false, for any row: JS treats an undefined filter value as "never matches",
            // and the SQL emitter compiles a bare `undefined` to a self-contradictory `(f IS NOT NULL AND f IS
            // NULL)` guard (always false — NOT a plain IS NULL, so it does not spuriously match null/missing
            // rows). No cross-engine divergence exists here, so this is pinned strictly, not acknowledged.
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('15.E6a $exists:false on an explicit null is false', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: null }, { n: { $exists: false } }, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, false);
        });

        test('15.E6b $eq null matches a missing optional field', async () => {
            const result = await matchJavascriptObject({ contact: { name: 'A' } }, { 'contact.age': { $eq: null } } as unknown as WhereFilterDefinition, NullableAgeContactSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('15.E7 $nor over a null field is definitely true', async () => {
            const result = await matchJavascriptObject({ id: 'x', n: null }, { $nor: [{ n: { $gt: 5 } }] } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

        test('15.E8 $nor over a missing field is definitely true', async () => {
            const result = await matchJavascriptObject({ id: 'x' }, { $nor: [{ n: { $gt: 5 } }] } as unknown as WhereFilterDefinition, NullishGridSchema);
            expectOrAcknowledgeUnsupported(result, true);
        });

    });
}
