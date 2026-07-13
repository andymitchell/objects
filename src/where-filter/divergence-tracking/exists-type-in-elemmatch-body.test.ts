/**
 * Pins MONGO-DIVERGENCES.md — slug `exists-type-in-elemmatch-body` (#15): `$exists` and `$type` are
 * field-level operators with no per-element meaning, so a scalar `$elemMatch` body mentioning either
 * is deep-equalled as a literal object against each element and matches nothing (MongoDB applies
 * them element-wise).
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
const rowWithTags = { id: '1', tags: ['a'] };
const rowWithoutTags = { id: '2', tags: [] as string[] };

describe('divergence `exists-type-in-elemmatch-body` (#15)', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$elemMatch { $exists: true } describes no element, so a non-empty array does not match (MongoDB would match)', async () => {
            expect(await match(rowWithTags, { tags: { $elemMatch: { $exists: true } } }, RowSchema)).toEqual(matched(false));
        });

        test('$elemMatch { $exists: true } does not match an empty array either — strictly conservative', async () => {
            expect(await match(rowWithoutTags, { tags: { $elemMatch: { $exists: true } } }, RowSchema)).toEqual(matched(false));
        });

        test('$elemMatch { $type: "string" } describes no element, so an array of strings does not match (MongoDB would match)', async () => {
            expect(await match(rowWithTags, { tags: { $elemMatch: { $type: 'string' } } }, RowSchema)).toEqual(matched(false));
        });

        test('mixing $exists with a scalar predicate does not rescue it: { $exists: true, $eq: "a" } fails on ["a"]', async () => {
            expect(await match(rowWithTags, { tags: { $elemMatch: { $exists: true, $eq: 'a' } } }, RowSchema)).toEqual(matched(false));
        });

        test('the scalar predicate alone matches — only the field-level operators poison the body', async () => {
            expect(await match(rowWithTags, { tags: { $elemMatch: { $eq: 'a' } } }, RowSchema)).toEqual(matched(true));
        });
    });
});
