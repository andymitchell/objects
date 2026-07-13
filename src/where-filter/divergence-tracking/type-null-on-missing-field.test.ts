/**
 * Guards a RETIRED entry of MONGO-DIVERGENCES.md — slug `type-null-on-missing-field` (#4):
 * `$type: 'null'` once matched a missing field on the JS engine; it now requires the field to be
 * present and hold null, as MongoDB and the SQL engines always did. Red here means the divergence
 * has REAPPEARED.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({ id: z.string(), age: z.number().nullable().optional() });

describe('retired divergence `type-null-on-missing-field` (#4) — the behaviour now conforms', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$type "null" does NOT match a missing field — the field must exist', async () => {
            expect(await match({ id: '1' }, { age: { $type: 'null' } }, RowSchema)).toEqual(matched(false));
        });

        test('$type "null" matches a field that is present and holds null', async () => {
            expect(await match({ id: '2', age: null }, { age: { $type: 'null' } }, RowSchema)).toEqual(matched(true));
        });

        test('$type "null" does not match a field holding a value', async () => {
            expect(await match({ id: '3', age: 30 }, { age: { $type: 'null' } }, RowSchema)).toEqual(matched(false));
        });
    });
});
