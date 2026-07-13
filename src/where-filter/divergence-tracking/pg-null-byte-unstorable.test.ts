/**
 * Pins MONGO-DIVERGENCES.md — slug `pg-null-byte-unstorable` (#10): Postgres text/jsonb cannot
 * represent U+0000, so a value carrying a null byte cannot be stored there and a filter targeting
 * it can never match — while JS and SQLite bind and compare the byte faithfully (as BSON does).
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { matched, matchOnJs, matchOnPostgres, matchOnSqlite, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const RowSchema = z.object({ id: z.string(), name: z.string() });
const nullByteRow = { id: '1', name: 'a\u0000b' };

describe('divergence `pg-null-byte-unstorable` (#10)', () => {

    test('js holds the null byte in memory and matches it', async () => {
        expect(await matchOnJs(nullByteRow, { name: 'a\u0000b' }, RowSchema)).toEqual(matched(true));
    });

    test('sqlite stores the null byte in JSON text and matches it', async () => {
        expect(await matchOnSqlite(nullByteRow, { name: 'a\u0000b' }, RowSchema)).toEqual(matched(true));
    });

    test('postgres cannot store the value at all — a typed environmental limit, never a match', async () => {
        expect(await matchOnPostgres(nullByteRow, { name: 'a\u0000b' }, RowSchema)).toMatchObject({
            kind: 'environmental',
            code: 'pg_null_byte_unstorable',
            value: false,
            divergenceId: '#10',
        });
    });

    test('the limit is the byte, not the neighbourhood: the same string without it round-trips on postgres', async () => {
        expect(await matchOnPostgres({ id: '2', name: 'ab' }, { name: 'ab' }, RowSchema)).toEqual(matched(true));
    });
});
