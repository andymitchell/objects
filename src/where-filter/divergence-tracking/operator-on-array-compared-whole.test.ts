/**
 * Guards a RETIRED entry of MONGO-DIVERGENCES.md — slug `operator-on-array-compared-whole` (#13):
 * a comparison operator on an array field once compared against the whole array value; it now reads
 * element-wise, as MongoDB does. The old behaviour's negation over-matched (`$not` of an unreachable
 * predicate matched everything), which is why it was fixed. Red here means the divergence has
 * REAPPEARED.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({ id: z.string(), tags: z.array(z.string()) });
const row = { id: '1', tags: ['a'] };

describe('retired divergence `operator-on-array-compared-whole` (#13) — the behaviour now conforms', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$eq on an array field reads element-wise: { $eq: "a" } matches ["a"]', async () => {
            expect(await match(row, { tags: { $eq: 'a' } }, RowSchema)).toEqual(matched(true));
        });

        test('$eq on an array field fails when no element equals the operand', async () => {
            expect(await match(row, { tags: { $eq: 'z' } }, RowSchema)).toEqual(matched(false));
        });

        test('the over-match that forced the fix: $not $eq excludes a row holding the value', async () => {
            expect(await match(row, { tags: { $not: { $eq: 'a' } } }, RowSchema)).toEqual(matched(false));
        });

        test('$not $eq keeps a row that does not hold the value', async () => {
            expect(await match(row, { tags: { $not: { $eq: 'z' } } }, RowSchema)).toEqual(matched(true));
        });
    });
});
