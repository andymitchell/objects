import postgresWhereClauseBuilder, {  PreparedWhereClauseStatement, PropertyMapSchema, spreadJsonbArrays } from "./postgresWhereClauseBuilder";

import { MatchJavascriptObject, MatchJavascriptObjectInTesting, WhereFilterDefinition } from "./types";
import { standardTests } from "./standardTests";

import { DbMultipleTestsRunner } from "@andyrmitchell/pg-testable";




describe('postgres where clause builder', () => {


    

    const runner = new DbMultipleTestsRunner();//true, undefined, true, 1000*10);
    
    test("postgres cleanup", async () => {
        await runner.isComplete();
        expect(true).toBe(true);
    }, 1000*60*5); 

    const matchJavascriptObjectInDb:MatchJavascriptObjectInTesting = async (object, filter, schema) => {

        return await runner.sequentialTest(async (runner, db, uniqueTableName) => {
            const pm = new PropertyMapSchema(schema, 'recordColumn');

            await db.exec(`CREATE TABLE IF NOT EXISTS ${uniqueTableName} (pk SERIAL PRIMARY KEY, recordColumn JSONB NOT NULL)`);

            await db.query(`INSERT INTO ${uniqueTableName} (recordColumn) VALUES('${JSON.stringify(object)}'::jsonb)`);

            let clause:PreparedWhereClauseStatement | undefined;
            try {
                clause = postgresWhereClauseBuilder(filter, pm);
            } catch(e) {
                if( !(e instanceof Error) || e.message.toLowerCase().indexOf('unsupported')===-1 ) {
                    throw e;
                }
            }
            if( !clause ) return undefined; 

            const sql2 = `SELECT jsonb_array_elements(recordColumn->'contact'->'locations') as recordColumn1 FROM ${uniqueTableName}`;
            const result2 = await db.query(sql2);

            //const sql3 = `SELECT * FROM test_0_table WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(recordColumn->'contact'->'locations') AS recordColumn1 WHERE (recordColumn1 IS NOT NULL AND recordColumn1 #>> '{}' = 'London'))`;
            //const sql3 = `SELECT * FROM test_0_table WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(recordColumn->'contact'->'locations') AS recordColumn1 WHERE (recordColumn1 IS NOT NULL AND recordColumn1::text = 'London'))`;
            //const sql3 = `SELECT * FROM test_0_table WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(recordColumn->'contact'->'locations') AS recordColumn1 WHERE (((recordColumn1->>'city')::text IS NOT NULL AND (recordColumn1->>'city')::text = 'London') AND ((recordColumn1->>'country')::text IS NOT NULL AND (recordColumn1->>'country')::text = 'US')))`
            //const result3 = await db.query(sql3);

            const queryStr = `SELECT * FROM ${uniqueTableName} WHERE ${clause.whereClauseStatement}`;
            console.log(queryStr, clause.statementArguments);
            //debugger;
            const result = await db.query(queryStr, clause.statementArguments);
            
            
            const rows = result.rows;

            
            
            
            return rows.length>0;
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
    

    /*RESTORE
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
        while( target.parent ) {
            path.unshift(target);
            target = target.parent;
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
        while( target.parent ) {
            path.unshift(target);
            target = target.parent;
        }
        const sa = spreadJsonbArrays('recordColumn', path);
        expect(sa).toEqual(
            {
                "sql": "jsonb_array_elements(recordColumn->'contact'->'children') AS recordColumn1",
                "output_column": "recordColumn1.value"
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
        while( target.parent ) {
            path.unshift(target);
            target = target.parent;
        }
        const sa = spreadJsonbArrays('recordColumn', path);
        expect(sa).toEqual(
            {
                "sql": "jsonb_array_elements(recordColumn->'contact'->'children') AS recordColumn1 CROSS JOIN jsonb_array_elements(recordColumn1.value->'family'->'grandchildren') AS recordColumn2",
                "output_column": "recordColumn2.value"
            }
        )
        

    });
    */

    
    

    
})
