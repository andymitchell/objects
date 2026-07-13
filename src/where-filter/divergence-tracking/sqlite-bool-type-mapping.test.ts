/**
 * Pins MONGO-DIVERGENCES.md — slug `sqlite-bool-type-mapping` (#5): SQLite's `json_type()` reports
 * booleans as 'true'/'false' rather than one boolean type; the SQLite engine maps both to satisfy
 * `$type: 'bool'`, and the mapping must not leak to non-boolean values.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({ id: z.string(), flag: z.union([z.boolean(), z.number(), z.string()]) });

describe('divergence `sqlite-bool-type-mapping` (#5)', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$type "bool" matches a true value', async () => {
            expect(await match({ id: '1', flag: true }, { flag: { $type: 'bool' } }, RowSchema)).toEqual(matched(true));
        });

        test("$type \"bool\" matches a false value (SQLite's json_type reports it as 'false', not 'boolean')", async () => {
            expect(await match({ id: '2', flag: false }, { flag: { $type: 'bool' } }, RowSchema)).toEqual(matched(true));
        });

        test('the mapping does not leak: a number is not a bool', async () => {
            expect(await match({ id: '3', flag: 1 }, { flag: { $type: 'bool' } }, RowSchema)).toEqual(matched(false));
        });

        test('the mapping does not leak: the string "true" is not a bool', async () => {
            expect(await match({ id: '4', flag: 'true' }, { flag: { $type: 'bool' } }, RowSchema)).toEqual(matched(false));
        });
    });
});
