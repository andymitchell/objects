import { prepareWhereClauseForPg, PropertyTranslatorJsonbSchema } from "./index.ts";
import type { PreparedWhereClauseResult } from "../types.ts";

import { standardTests, type MatchJavascriptObjectInTesting } from "../../standardTests.ts";

import { DbMultipleTestsRunner } from "@andyrmitchell/pg-testable";
import { UNSAFE_WARNING } from "./convertDotPropPathToPostgresJsonPath.ts";




describe('postgres where clause builder', () => {

    let runner:DbMultipleTestsRunner;
    beforeAll(async () => {
        runner = new DbMultipleTestsRunner({type:'pglite'});
        runner.sequentialTest(async (runner, db) => {
            await db.query("select 'Hello world' as message;");
        })
    })
    afterAll(async () => {
        await runner.dispose();
        console.log("Db shutdown OK");
    })



    const matchJavascriptObjectInDb:MatchJavascriptObjectInTesting = async (object, filter, schema) => {

        return await runner.sequentialTest(async (runner, db, schemaName, schemaScope) => {

            const pm = new PropertyTranslatorJsonbSchema(schema, 'recordColumn');

            await db.exec(`CREATE TABLE IF NOT EXISTS ${schemaScope('test_table_123')} (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL)`);

            await db.query(`INSERT INTO ${schemaScope('test_table_123')} (recordColumn) VALUES($1::jsonb)`, [JSON.stringify(object)]);

            let clause:PreparedWhereClauseResult | undefined;
            try {
                clause = prepareWhereClauseForPg(filter, pm);

            } catch(e) {
                if( e instanceof Error ) {
                    if( e.message.toLowerCase().indexOf('unsupported')>-1 ) {
                        return undefined;
                    } else if( e.message.indexOf(UNSAFE_WARNING)>-1 ) {
                        return false;
                    }
                }
                debugger;
                throw e;
            }

            if( !clause.success ) {
                // Re-throw validation errors so standardTests error-handling tests still work.
                // Capability-gap errors (e.g. $regex on SQLite) return undefined to skip.
                const msg = clause.errors.map(e => e.message).join('; ');
                if( msg.toLowerCase().includes('not well-defined') ) {
                    throw new Error(msg);
                }
                return undefined;
            }

            let queryStr:string;
            if( clause.where_clause_statement ) {
                queryStr = `SELECT * FROM ${schemaScope('test_table_123')} WHERE ${clause.where_clause_statement}`;
            } else {
                queryStr = `SELECT * FROM ${schemaScope('test_table_123')}`;
            }

            try {
                const result = await db.query(queryStr, clause.statement_arguments);

                const rows = result.rows;

                return rows.length>0;
            } catch(e) {
                debugger;
                throw e;
            }
        } )

    }

    standardTests({
        test,
        expect,
        matchJavascriptObject:matchJavascriptObjectInDb,
        implementationName: 'postgres'
    })



})
