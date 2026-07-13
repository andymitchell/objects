/**
 * Pins MONGO-DIVERGENCES.md — slug `sqlite-regex-like-case-insensitive` (#3): SQLite translates
 * `$regex` to LIKE, which is case-insensitive for ASCII, so a pattern matches across case there
 * while JS, Postgres, and MongoDB stay case-sensitive by default.
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, matchOnJs, matchOnPostgres, matchOnSqlite, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({ id: z.string(), name: z.string() });
const andy = { id: '1', name: 'Andy' };
const nonAscii = { id: '2', name: 'ÉCOLE' };

describe('divergence `sqlite-regex-like-case-insensitive` (#3)', () => {

    describe('the split: a lowercase pattern against a capitalised value', () => {

        test('js is case-sensitive by default, as MongoDB is: no match', async () => {
            expect(await matchOnJs(andy, { name: { $regex: 'andy' } }, RowSchema)).toEqual(matched(false));
        });

        test('postgres is case-sensitive by default, as MongoDB is: no match', async () => {
            expect(await matchOnPostgres(andy, { name: { $regex: 'andy' } }, RowSchema)).toEqual(matched(false));
        });

        test('sqlite MATCHES across ASCII case — $regex runs as LIKE there', async () => {
            expect(await matchOnSqlite(andy, { name: { $regex: 'andy' } }, RowSchema)).toEqual(matched(true));
        });
    });

    describe.each(allEngines)('on $name', ({ match }) => {

        test('the portable route: $options "i" matches across case everywhere', async () => {
            expect(await match(andy, { name: { $regex: 'andy', $options: 'i' } }, RowSchema)).toEqual(matched(true));
        });

        test('a case-matching pattern matches everywhere', async () => {
            expect(await match(andy, { name: { $regex: 'And' } }, RowSchema)).toEqual(matched(true));
        });
    });

    describe('the sqlite insensitivity is ASCII-only', () => {

        test('a lowercase non-ASCII pattern does not match its uppercase value on sqlite', async () => {
            expect(await matchOnSqlite(nonAscii, { name: { $regex: 'école' } }, RowSchema)).toEqual(matched(false));
        });
    });
});
