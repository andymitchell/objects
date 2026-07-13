/**
 * Guards a RETIRED entry of MONGO-DIVERGENCES.md — slug `size-on-spread-dotprop-paths` (#6):
 * `$size` on a spread dot-prop path once diverged on SQL; every engine now counts each individual
 * leaf array, as MongoDB does. Red here means the divergence has REAPPEARED.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import type { WhereFilterDefinition } from "../types.ts";
import { allEngines, matched, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({
    id: z.string(),
    groups: z.array(z.object({ tags: z.array(z.string()) })),
});
type Row = z.infer<typeof RowSchema>;
const row: Row = { id: '1', groups: [{ tags: ['a', 'b'] }, { tags: ['c'] }] };

/** The compile-time path grammar cannot name an array-traversing dotted path; the runtime grammar accepts it (the validity gate still checks it). */
const asRowFilter = (filter: unknown) => filter as WhereFilterDefinition<Row>;

describe('retired divergence `size-on-spread-dotprop-paths` (#6) — the behaviour now conforms', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$size counts one leaf array: a two-element leaf satisfies $size 2', async () => {
            expect(await match(row, asRowFilter({ 'groups.tags': { $size: 2 } }), RowSchema)).toEqual(matched(true));
        });

        test('$size counts one leaf array: a one-element leaf satisfies $size 1', async () => {
            expect(await match(row, asRowFilter({ 'groups.tags': { $size: 1 } }), RowSchema)).toEqual(matched(true));
        });

        test('$size never pools leaves: no leaf has three elements, so $size 3 fails', async () => {
            expect(await match(row, asRowFilter({ 'groups.tags': { $size: 3 } }), RowSchema)).toEqual(matched(false));
        });
    });
});
