import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerBigintSortTests } from '../standardTests.bigint.ts';
import { standardTests, type Execute } from '../standardTests.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import { prepareColumnTableQuery } from './prepareColumnTableQuery.ts';
import { COLUMN_TABLE, COLUMN_TABLE_DDL, parsePayload, toColumnRowParams } from './standardTestSqlSupport.ts';

/**
 * Runs the shared standard tests against a real Postgres engine (PGlite) using a relational
 * table: each fixture field is a typed column the engine natively ORDERs BY, and the full item
 * rides along as a JSON `payload` so results round-trip exactly. This is what proves the
 * column-table Postgres encodings (quoted identifiers, NULLS LAST, cursor subqueries) agree
 * with `sortAndSliceObjects`.
 */
describe('prepareColumnTableQuery against Postgres (PGlite)', () => {

    // One PGlite instance per file — the boot compiles a 6.4MB WASM payload. Each execute clears the
    // table instead of rebuilding it; tests in a file run sequentially, so sharing is race-free.
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`CREATE TABLE items (
            id TEXT PRIMARY KEY,
            age DOUBLE PRECISION,
            name TEXT,
            category TEXT,
            date TEXT,
            value DOUBLE PRECISION,
            score DOUBLE PRECISION,
            flag BOOLEAN,
            amount BIGINT,
            payload TEXT NOT NULL
        )`);
    });
    // A live WASM instance can hold the worker open past its teardown budget.
    afterAll(async () => { await db.close(); });

    const execute: Execute<any> = async (items, sortAndSlice) => {
        await db.exec('DELETE FROM items');
        for (const item of items) {
            await db.query(
                'INSERT INTO items (id, age, name, category, date, value, score, flag, amount, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                toColumnRowParams(item, 'pg')
            );
        }

        const prepared = prepareColumnTableQuery('pg', COLUMN_TABLE, sortAndSlice);
        if (!prepared.success) {
            // COLUMN_TABLE_DDL statically gates every sort key to a real column, so a builder
            // failure here is a real fault, never a capability gap — fail loudly rather than skip.
            throw new Error(`prepareColumnTableQuery failed: ${prepared.errors.map(e => `${e.type}: ${e.message}`).join('; ')}`);
        }

        const { sql, parameters } = flattenQueryClausesToSql(prepared, 'pg');
        const result = await db.query(`SELECT payload FROM items ${sql}`, parameters as unknown[]);
        return (result.rows as Array<{ payload: string }>).map(row => parsePayload(row.payload));
    };

    standardTests({ it, expect, execute, implementationName: 'column-table-pg', ddl: COLUMN_TABLE_DDL });
    registerBigintSortTests({ it, expect, execute, implementationName: 'column-table-pg' });
});
