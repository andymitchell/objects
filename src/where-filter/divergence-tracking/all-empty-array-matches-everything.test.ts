/**
 * Pins MONGO-DIVERGENCES.md — slug `all-empty-array-matches-everything` (#2): `{ $all: [] }` returns
 * true for every row (vacuous truth), where MongoDB errors or returns no matches.
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

describe('divergence `all-empty-array-matches-everything` (#2)', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$all with an empty list matches a populated array (MongoDB errors or matches nothing)', async () => {
            expect(await match(rowWithTags, { tags: { $all: [] } }, RowSchema)).toEqual(matched(true));
        });

        test('$all with an empty list matches even an empty array', async () => {
            expect(await match(rowWithoutTags, { tags: { $all: [] } }, RowSchema)).toEqual(matched(true));
        });

        test('a populated $all still requires its values: present value matches', async () => {
            expect(await match(rowWithTags, { tags: { $all: ['a'] } }, RowSchema)).toEqual(matched(true));
        });

        test('a populated $all still requires its values: absent value fails', async () => {
            expect(await match(rowWithTags, { tags: { $all: ['z'] } }, RowSchema)).toEqual(matched(false));
        });
    });
});
