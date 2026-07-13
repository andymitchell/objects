/**
 * Pins MONGO-DIVERGENCES.md — slug `nan-infinity-stored-as-json-null` (#7): JSON cannot carry
 * NaN/Infinity, so `JSON.stringify` turns them to null at the SQL storage boundary and the stored
 * distinction is lost there, while the in-memory JS matcher keeps the values (as BSON does).
 * Filter-side non-finite operands short-circuit identically on every engine.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, matchOnJs, matchOnPostgres, matchOnSqlite, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({ id: z.string(), age: z.number() });
const infinityRow = { id: '1', age: Infinity };
const nanRow = { id: '2', age: NaN };
const finiteRow = { id: '3', age: 5 };

describe('divergence `nan-infinity-stored-as-json-null` (#7)', () => {

    describe('the split: stored Infinity under a huge lower bound', () => {

        test('js keeps Infinity in memory, so $gt 1e308 matches (as MongoDB does)', async () => {
            expect(await matchOnJs(infinityRow, { age: { $gt: 1e308 } }, RowSchema)).toEqual(matched(true));
        });

        test('sqlite stored it as JSON null, so $gt 1e308 fails', async () => {
            expect(await matchOnSqlite(infinityRow, { age: { $gt: 1e308 } }, RowSchema)).toEqual(matched(false));
        });

        test('postgres stored it as JSON null, so $gt 1e308 fails', async () => {
            expect(await matchOnPostgres(infinityRow, { age: { $gt: 1e308 } }, RowSchema)).toEqual(matched(false));
        });
    });

    describe.each(allEngines)('on $name', ({ match }) => {

        test('stored NaN still $exists everywhere — the JSON null it becomes is a present value', async () => {
            expect(await match(nanRow, { age: { $exists: true } }, RowSchema)).toEqual(matched(true));
        });

        test('a filter-side NaN bound matches nothing: $gt NaN is false', async () => {
            expect(await match(finiteRow, { age: { $gt: NaN } }, RowSchema)).toEqual(matched(false));
        });

        test('a filter-side NaN inequality matches everything with a value: $ne NaN is true', async () => {
            expect(await match(finiteRow, { age: { $ne: NaN } }, RowSchema)).toEqual(matched(true));
        });
    });
});
