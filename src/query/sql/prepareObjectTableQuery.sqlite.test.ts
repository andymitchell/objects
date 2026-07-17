import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { standardTests, type Execute } from '../standardTests.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import { prepareObjectTableQuery } from './prepareObjectTableQuery.ts';
import { OBJECT_TABLE } from './standardTestSqlSupport.ts';

/**
 * Runs the shared standard tests against a real SQLite engine (better-sqlite3): items are
 * inserted into a JSON TEXT column, the prepared clauses are executed, and the returned rows
 * are compared to the contract's expected orderings. This is what proves the SQLite SQL
 * encodings (json_extract ordering, the IS NULL nulls-last simulation, cursor subqueries)
 * agree with `sortAndSliceObjects`.
 */
describe('prepareObjectTableQuery against SQLite (better-sqlite3)', () => {

    const execute: Execute<any> = async (items, sortAndSlice) => {
        // A fresh in-memory database per call keeps every test hermetic; SQLite boot is cheap.
        const db = new Database(':memory:');
        try {
            db.exec('CREATE TABLE items (data TEXT NOT NULL)');
            const insert = db.prepare('INSERT INTO items (data) VALUES (?)');
            for (const item of items) {
                insert.run(JSON.stringify(item));
            }

            const prepared = prepareObjectTableQuery('sqlite', OBJECT_TABLE, undefined, sortAndSlice);
            if (!prepared.success) {
                // Every standard-test sort key exists in the row schema, so a builder failure here is
                // a real fault, never a capability gap — fail loudly rather than skip.
                throw new Error(`prepareObjectTableQuery failed: ${prepared.errors.map(e => `${e.type}: ${e.message}`).join('; ')}`);
            }

            const { sql, parameters } = flattenQueryClausesToSql(prepared, 'sqlite');
            const rows = db.prepare(`SELECT data FROM items ${sql}`).all(...parameters) as Array<{ data: string }>;
            return rows.map(row => JSON.parse(row.data));
        } finally {
            db.close();
        }
    };

    standardTests({ it, expect, execute, implementationName: 'object-table-sqlite' });
});
