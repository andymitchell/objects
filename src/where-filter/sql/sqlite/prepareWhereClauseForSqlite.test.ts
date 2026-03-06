import Database from 'better-sqlite3';
import { prepareWhereClauseForSqlite, PropertyTranslatorSqliteJsonSchema } from "./index.ts";
import { standardTests, type MatchJavascriptObjectInTesting } from "../../standardTests.ts";
import type { PreparedWhereClauseResult } from "../types.ts";
import { SQLITE_UNSAFE_WARNING } from "./convertDotPropPathToSqliteJsonPath.ts";



describe('sqlite where clause builder', () => {

    const matchJavascriptObjectInDb: MatchJavascriptObjectInTesting = async (object, filter, schema) => {
        const db = new Database(':memory:');
        try {
            db.exec('CREATE TABLE test_table (pk INTEGER PRIMARY KEY AUTOINCREMENT, recordColumn TEXT NOT NULL)');
            db.prepare('INSERT INTO test_table (recordColumn) VALUES (?)').run(JSON.stringify(object));

            const pm = new PropertyTranslatorSqliteJsonSchema(schema, 'recordColumn');

            let clause: PreparedWhereClauseResult | undefined;
            try {
                clause = prepareWhereClauseForSqlite(filter, pm);
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
        matchJavascriptObject: matchJavascriptObjectInDb,
        implementationName: 'sqlite'
    })



})
