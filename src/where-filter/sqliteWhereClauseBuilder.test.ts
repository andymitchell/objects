import Database from 'better-sqlite3';
import sqliteWhereClauseBuilder, { SqlitePropertyMapSchema, spreadJsonArraysSqlite } from "./sqliteWhereClauseBuilder.js";
import { standardTests, type MatchJavascriptObjectInTesting } from "./standardTests.js";
import type { PreparedWhereClauseResult } from "./whereClauseEngine.js";
import { SQLITE_UNSAFE_WARNING } from "./convertDotPropPathToSqliteJsonPath.js";
import { z } from "zod";
import { convertSchemaToDotPropPathTree } from "../dot-prop-paths/zod.js";


describe('sqlite where clause builder', () => {

    const matchJavascriptObjectInDb: MatchJavascriptObjectInTesting = async (object, filter, schema) => {
        const db = new Database(':memory:');
        try {
            db.exec('CREATE TABLE test_table (pk INTEGER PRIMARY KEY AUTOINCREMENT, recordColumn TEXT NOT NULL)');
            db.prepare('INSERT INTO test_table (recordColumn) VALUES (?)').run(JSON.stringify(object));

            const pm = new SqlitePropertyMapSchema(schema, 'recordColumn');

            let clause: PreparedWhereClauseResult | undefined;
            try {
                clause = sqliteWhereClauseBuilder(filter, pm);
            } catch (e) {
                if (e instanceof Error) {
                    if (e.message.toLowerCase().indexOf('unsupported') > -1) {
                        return undefined;
                    } else if (e.message.indexOf(SQLITE_UNSAFE_WARNING) > -1) {
                        return false;
                    }
                }
                throw e;
            }

            if (!clause.success) {
                // Re-throw validation errors so standardTests error-handling tests still work.
                // Capability-gap errors (e.g. $regex on SQLite) return undefined to skip.
                const msg = clause.errors.map(e => e.message).join('; ');
                if (msg.toLowerCase().includes('not well-defined')) {
                    throw new Error(msg);
                }
                return undefined;
            }

            let queryStr: string;
            if (clause.where_clause_statement) {
                queryStr = `SELECT * FROM test_table WHERE ${clause.where_clause_statement}`;
            } else {
                queryStr = `SELECT * FROM test_table`;
            }

            try {
                const rows = db.prepare(queryStr).all(...clause.statement_arguments);
                return rows.length > 0;
            } catch (e) {
                throw e;
            }
        } finally {
            db.close();
        }
    }

    standardTests({
        test,
        expect,
        matchJavascriptObject: matchJavascriptObjectInDb
    })


    test('spreadJsonArraysSqlite 0 array', () => {

        const schema = z.object({
            'contact': z.object({
                name: z.string(),
                age: z.number().optional(),
                children: z.array(z.object({
                    name: z.string(),
                    family: z.object({
                        grandchildren: z.array(z.object({
                            name: z.string()
                        }))
                    })
                })).optional()
            })
        });

        const tree = convertSchemaToDotPropPathTree(schema);
        const path = [];
        let target = tree.map['contact'];
        while (target!.parent) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonArraysSqlite('recordColumn', path);
        expect(sa).toBe(undefined)

    });

    test('spreadJsonArraysSqlite 1x array', () => {

        const schema = z.object({
            'contact': z.object({
                name: z.string(),
                age: z.number().optional(),
                children: z.array(z.object({
                    name: z.string(),
                    family: z.object({
                        grandchildren: z.array(z.object({
                            name: z.string()
                        }))
                    })
                })).optional()
            })
        });

        const tree = convertSchemaToDotPropPathTree(schema);
        const path = [];
        let target = tree.map['contact.children'];
        while (target!.parent) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonArraysSqlite('recordColumn', path);

        expect(sa).toEqual(
            {
                "sql": "json_each(recordColumn, '$.contact.children') AS je1",
                "output_column": "je1.value",
                "output_identifier": "je1.value"
            }
        )

    });

    test('spreadJsonArraysSqlite 2x nested', () => {

        const schema = z.object({
            'contact': z.object({
                name: z.string(),
                age: z.number().optional(),
                children: z.array(z.object({
                    name: z.string(),
                    family: z.object({
                        grandchildren: z.array(z.object({
                            name: z.string()
                        }))
                    })
                })).optional()
            })
        });

        const tree = convertSchemaToDotPropPathTree(schema);
        const path = [];
        let target = tree.map['contact.children.family.grandchildren.name'];
        while (target!.parent) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonArraysSqlite('recordColumn', path);

        expect(sa).toEqual(
            {
                "sql": "json_each(recordColumn, '$.contact.children') AS je1 CROSS JOIN json_each(je1.value, '$.family.grandchildren') AS je2",
                "output_column": "je2.value",
                "output_identifier": "je2.value"
            }
        )

    });

})
