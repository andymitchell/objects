import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { standardTests, type Execute } from '../standardTests.ts';
import { encodeSortValue } from '../sortCompare.ts';
import type { SortAndSlice, SortBoundary, SortDefinition } from '../types.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import { prepareObjectTableQuery } from './prepareObjectTableQuery.ts';
import { OBJECT_TABLE, type StandardTestRow } from './standardTestSqlSupport.ts';

// One PGlite instance for the whole file — the boot compiles a 6.4MB WASM payload, so it is paid once and
// shared by every suite below. Each entry point clears the table instead of rebuilding it; tests in a file run
// sequentially, so sharing is race-free.
let db: PGlite;
beforeAll(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE items (data JSONB NOT NULL)');
});
// A live WASM instance can hold the worker open past its teardown budget.
afterAll(async () => { await db.close(); });

/**
 * Runs the shared standard tests against a real Postgres engine (PGlite): items are inserted
 * into a JSONB column, the prepared clauses are executed, and the returned rows are compared
 * to the contract's expected orderings. This is what proves the Postgres SQL encodings
 * (ORDER BY casts, NULLS LAST, cursor subqueries) agree with `sortAndSliceObjects`.
 */
describe('prepareObjectTableQuery against Postgres (PGlite)', () => {

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

/**
 * A keyset cursor predicate is an OR of arms (one per sort key, plus the id tiebreaker). Composed
 * after a filter — which joins with AND, and AND binds tighter than OR — the arms must be grouped
 * as a unit, or a later arm's rows escape the filter entirely: an access-control bypass. This runs
 * a real engine to prove the filter binds across every arm, for both cursor modes.
 */
describe('prepareObjectTableQuery keeps a WHERE filter binding across every keyset arm (PGlite)', () => {
    // Sorting by age appends the id tiebreaker, so the cursor is a two-arm predicate:
    // (age past 10) OR (age tied at 10 AND id past 'b'). Row 'z' matches only that second arm and
    // sits in the excluded category — the row a precedence bug leaks past `category = 'keep'`.
    const items: StandardTestRow[] = [
        { id: 'b', age: 10, category: 'keep' },
        { id: 'z', age: 10, category: 'drop' },
        { id: 'k', age: 20, category: 'keep' },
        { id: 'd', age: 30, category: 'drop' },
    ];
    const sort: SortDefinition<StandardTestRow> = [{ key: 'age', direction: 1 }];

    const idsAfter = async (sortAndSlice: SortAndSlice<StandardTestRow>): Promise<string[]> => {
        await db.exec('DELETE FROM items');
        for (const item of items) {
            await db.query('INSERT INTO items (data) VALUES ($1::jsonb)', [JSON.stringify(item)]);
        }
        const prepared = prepareObjectTableQuery('pg', OBJECT_TABLE, { category: 'keep' }, sortAndSlice);
        if (!prepared.success) throw new Error(prepared.errors.map(e => `${e.type}: ${e.message}`).join('; '));
        const { sql, parameters } = flattenQueryClausesToSql(prepared, 'pg');
        const result = await db.query(`SELECT data FROM items ${sql}`, parameters as unknown[]);
        return (result.rows as Array<{ data: unknown }>).map(row => {
            const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            return (data as StandardTestRow).id;
        });
    };

    it('does not let a value-boundary arm bypass the filter', async () => {
        const boundary: SortBoundary = { values: [encodeSortValue(10)], pk: 'b' };
        expect(await idsAfter({ sort, after_boundary: boundary })).toEqual(['k']);
    });

    it('does not let a pk-cursor arm bypass the filter', async () => {
        expect(await idsAfter({ sort, after_pk: 'b' })).toEqual(['k']);
    });
});
