import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { standardTests, type Execute } from '../standardTests.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import { prepareObjectTableQuery } from './prepareObjectTableQuery.ts';
import { OBJECT_TABLE } from './standardTestSqlSupport.ts';

/**
 * Runs the shared standard tests against a real Postgres engine (PGlite): items are inserted
 * into a JSONB column, the prepared clauses are executed, and the returned rows are compared
 * to the contract's expected orderings. This is what proves the Postgres SQL encodings
 * (ORDER BY casts, NULLS LAST, cursor subqueries) agree with `sortAndSliceObjects`.
 */
describe('prepareObjectTableQuery against Postgres (PGlite)', () => {

    // One PGlite instance per file — the WASM boot is expensive. Each execute clears the table
    // instead of rebuilding it; tests in a file run sequentially, so sharing is race-free.
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec('CREATE TABLE items (data JSONB NOT NULL)');
    });

    const execute: Execute<any> = async (items, sortAndSlice) => {
        await db.exec('DELETE FROM items');
        for (const item of items) {
            await db.query('INSERT INTO items (data) VALUES ($1::jsonb)', [JSON.stringify(item)]);
        }

        const prepared = prepareObjectTableQuery('pg', OBJECT_TABLE, undefined, sortAndSlice);
        if (!prepared.success) {
            // Every standard-test sort key exists in the row schema, so a builder failure here is
            // a real fault, never a capability gap — fail loudly rather than skip.
            throw new Error(`prepareObjectTableQuery failed: ${prepared.errors.map(e => `${e.type}: ${e.message}`).join('; ')}`);
        }

        const { sql, parameters } = flattenQueryClausesToSql(prepared, 'pg');
        const result = await db.query(`SELECT data FROM items ${sql}`, parameters as unknown[]);
        // Depending on driver version, JSONB may arrive as a parsed object or a JSON string.
        return (result.rows as Array<{ data: unknown }>).map(row =>
            typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        );
    };

    standardTests({ it, expect, execute, implementationName: 'object-table-pg' });
});
