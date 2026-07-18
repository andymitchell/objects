import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { registerBigintSortTests } from '../standardTests.bigint.ts';
import { standardTests, type Execute } from '../standardTests.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import { prepareColumnTableQuery } from './prepareColumnTableQuery.ts';
import { COLUMN_TABLE, COLUMN_TABLE_DDL, parsePayload, toColumnRowParams } from './standardTestSqlSupport.ts';

/**
 * Runs the shared standard tests against a real SQLite engine (better-sqlite3) using a
 * relational table: each fixture field is a typed column the engine natively ORDERs BY, and
 * the full item rides along as a JSON `payload` so results round-trip exactly. This is what
 * proves the column-table SQLite encodings (quoted identifiers, the IS NULL nulls-last
 * simulation, cursor subqueries) agree with `sortAndSliceObjects`.
 */
describe('prepareColumnTableQuery against SQLite (better-sqlite3)', () => {

    const execute: Execute<any> = async (items, sortAndSlice) => {
        // A fresh in-memory database per call keeps every test hermetic; SQLite boot is cheap.
        const db = new Database(':memory:');
        try {
            db.exec(`CREATE TABLE items (
                id TEXT PRIMARY KEY,
                age REAL,
                name TEXT,
                category TEXT,
                date TEXT,
                value REAL,
                score REAL,
                flag INTEGER,
                amount INTEGER,
                payload TEXT NOT NULL
            )`);
            const insert = db.prepare('INSERT INTO items (id, age, name, category, date, value, score, flag, amount, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            for (const item of items) {
                insert.run(...toColumnRowParams(item, 'sqlite'));
            }

            const prepared = prepareColumnTableQuery('sqlite', COLUMN_TABLE, sortAndSlice);
            if (!prepared.success) {
                // COLUMN_TABLE_DDL statically gates every sort key to a real column, so a builder
                // failure here is a real fault, never a capability gap — fail loudly rather than skip.
                throw new Error(`prepareColumnTableQuery failed: ${prepared.errors.map(e => `${e.type}: ${e.message}`).join('; ')}`);
            }

            const { sql, parameters } = flattenQueryClausesToSql(prepared, 'sqlite');
            const rows = db.prepare(`SELECT payload FROM items ${sql}`).all(...parameters) as Array<{ payload: string }>;
            return rows.map(row => parsePayload(row.payload));
        } finally {
            db.close();
        }
    };

    standardTests({ it, expect, execute, implementationName: 'column-table-sqlite', ddl: COLUMN_TABLE_DDL });
    registerBigintSortTests({ it, expect, execute, implementationName: 'column-table-sqlite' });
});
