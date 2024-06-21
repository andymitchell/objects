import postgresWhereClauseBuilder, {  PreparedWhereClauseStatement, PropertyMapSchema, spreadJsonbArrays } from "./postgresWhereClauseBuilder";

import {  MatchJavascriptObjectInTesting } from "./types";
import {  standardTests } from "./standardTests";

import { DbMultipleTestsRunner, PgTestable } from "@andyrmitchell/pg-testable";
import { z } from "zod";
import { convertSchemaToDotPropPathTree } from "../dot-prop-paths/zod";
import { UNSAFE_WARNING } from "./convertDotPropPathToPostgresJsonPath";




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
            
            const pm = new PropertyMapSchema(schema, 'recordColumn');

            await db.exec(`CREATE TABLE IF NOT EXISTS ${schemaScope('test_table_123')} (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL)`);

            await db.query(`INSERT INTO ${schemaScope('test_table_123')} (recordColumn) VALUES('${JSON.stringify(object)}'::jsonb)`);

            let clause:PreparedWhereClauseStatement | undefined;
            try {
                clause = postgresWhereClauseBuilder(filter, pm);

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

            const queryStr = `SELECT * FROM ${schemaScope('test_table_123')} WHERE ${clause.whereClauseStatement}`;
            try {
                const result = await db.query(queryStr, clause.statementArguments);
                
                const rows = result.rows;
            
                return rows.length>0;
            } catch(e) {
                debugger;
                throw e;
            }
        } )
        
    }

    /*
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
    type S1 = z.infer<typeof schema>;

    const object:S1 = {
        'contact': {
            'name': 'P1',
            'children': [
                {
                    name: 'C1',
                    family: {
                        'grandchildren': [
                            {
                                name: 'G1'
                            }
                        ]
                    }
                },
                {
                    name: 'C2',
                    family: {
                        'grandchildren': [
                            {
                                name: 'G2'
                            },
                            {
                                name: 'G3'
                            }
                        ]
                    }
                }
            ]
        }
    }
    const filter:WhereFilterDefinition<S1> = {
        'contact.children.family.grandchildren': {
            name: 'G3'
        }
    }

    const result = matchJavascriptObjectInDb(object, filter, schema);
    debugger;
    */


    

    
    
    standardTests({
        test,
        expect,
        matchJavascriptObject:matchJavascriptObjectInDb
    })
    
    

    
    test('spreadJsonbArrays 0 array', () => {

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
        while( target!.parent ) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonbArrays('recordColumn', path);
        expect(sa).toBe(undefined)
        

    });

    test('spreadJsonbArrays 1x array', () => {

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
        while( target!.parent ) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonbArrays('recordColumn', path);
        
        expect(sa).toEqual(
            {
                "sql": "jsonb_array_elements(recordColumn->'contact'->'children') AS recordColumn1",
                "output_column": "recordColumn1",
                "output_identifier": "recordColumn1 #>> '{}'"
            }
        )
        

    });
    
    test('spreadJsonbArrays 2x nested', () => {

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
        while( target!.parent ) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonbArrays('recordColumn', path);
        
        expect(sa).toEqual(
            {
                "sql": "jsonb_array_elements(recordColumn->'contact'->'children') AS recordColumn1 CROSS JOIN jsonb_array_elements(recordColumn1->'family'->'grandchildren') AS recordColumn2",
                "output_column": "recordColumn2",
                "output_identifier": "recordColumn2 #>> '{}'"
            }
        )
        

    });
    

    
    
})
