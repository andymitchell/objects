import postgresWhereClauseBuilder, {  PropertySqlMap, postgresCreatePropertySqlMapFromSchema } from "./postgresWhereClauseBuilder";
import { z } from "zod";
import {newDb} from 'pg-mem';
import { WhereFilterDefinition } from "./types";



const validateAndConvertDotPropKeyToSqlKey:PropertySqlMap = (key) => key;
    
    
const RecordSchema = z.object({
    contact: z.object({
        name: z.string(),
        age: z.number(), 
        address: z.string(),
        next_kin: z.object({
            name: z.string()
        })
    })
});
type Record = z.infer<typeof RecordSchema>;
const dotPropPathToSqlKey = postgresCreatePropertySqlMapFromSchema(RecordSchema, 'recordColumn');



describe('postgres where clause builder', () => {
    test('postgres sql basic ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    'contact.name': 'Andy'
                },
                validateAndConvertDotPropKeyToSqlKey
            )
        ).toEqual({whereClauseStatement: `contact.name = $1`, statementArguments: ['Andy']});
    });

    test('', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    'contact.name': {
                        'contains': 'And'
                    }
                },
                validateAndConvertDotPropKeyToSqlKey
            )
        ).toEqual({whereClauseStatement: `contact.name LIKE $1`, statementArguments: ['%And%']});
    });

    
    test('postgres sql OR ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    OR: [
                        {
                            'contact.name': 'Andy'
                        },
                        {
                            'contact.name': {
                                'contains': 'And'
                            }
                        }
                    ]
                    
                },
                validateAndConvertDotPropKeyToSqlKey
            )
        ).toEqual({whereClauseStatement: `(contact.name = $1 OR contact.name LIKE $2)`, statementArguments: ['Andy', '%And%']});
    });

    test('postgres sql OR/AND ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    OR: [
                        {
                            'contact.name': 'Andy'
                        },
                        {
                            AND: [
                                {
                                    'contact.age': 100
                                },
                                {
                                    'contact.address': 'York'
                                }
                            ]
                        }
                    ]
                    
                },
                validateAndConvertDotPropKeyToSqlKey
            )
        ).toEqual({whereClauseStatement: `(contact.name = $1 OR (contact.age = $2 AND contact.address = $3))`, statementArguments: ['Andy', 100, 'York']});
    });


    test('postgres sql NOT ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    NOT: [
                        {
                            'contact.name': 'Andy'
                        },
                        {
                            'contact.name': 'Bob'
                        }
                    ]
                    
                },
                validateAndConvertDotPropKeyToSqlKey
            )
        ).toEqual({whereClauseStatement: `NOT (contact.name = $1 OR contact.name = $2)`, statementArguments: ['Andy', 'Bob']} );
    });

    // JSONB

    test('postgres jsonb basic ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    'contact.name': 'Andy'
                },
                dotPropPathToSqlKey
            ) 
        ).toEqual({whereClauseStatement: `(recordColumn->'contact'->>'name')::text = $1`, statementArguments: ['Andy']});
    });

    test('postgres jsonb OR/AND ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    OR: [
                        {
                            'contact.name': 'Andy'
                        },
                        {
                            AND: [
                                {
                                    'contact.age': 100
                                },
                                {
                                    'contact.address': 'York'
                                }
                            ]
                        }
                    ]
                    
                },
                dotPropPathToSqlKey
            )
        ).toEqual({whereClauseStatement: `((recordColumn->'contact'->>'name')::text = $1 OR ((recordColumn->'contact'->>'age')::numeric = $2 AND (recordColumn->'contact'->>'address')::text = $3))`, statementArguments: ['Andy', 100, 'York']});
    });

    test('postgres jsonb NOT ok', () => {
        expect(
            postgresWhereClauseBuilder(
                {
                    NOT: [
                        {
                            'contact.name': 'Andy'
                        },
                        {
                            'contact.name': 'Bob'
                        }
                    ]
                    
                },
                dotPropPathToSqlKey
            )
        ).toEqual({whereClauseStatement: `NOT ((recordColumn->'contact'->>'name')::text = $1 OR (recordColumn->'contact'->>'name')::text = $2)`, statementArguments: ['Andy', 'Bob']} );
    });

    function setupPgMem() {
        const instance = newDb();



        instance.public.query(`CREATE TABLE IF NOT EXISTS test_table (pk SERIAL PRIMARY KEY,recordColumn JSONB NOT NULL)`);
        instance.public.query(`INSERT INTO test_table (recordColumn) VALUES ('{"contact": {"name": "Bob", "age": 1, "address": "London", "next_kin": {"name": "Sue"}}}')`);
        instance.public.query(`INSERT INTO test_table (recordColumn) VALUES ('{"contact": {"name": "Sue", "age": 2, "address": "New York", "next_kin": {"name": "Bob"}}}')`);

        function query(whereFilter:WhereFilterDefinition<Record>):Record[] {
            const clause = postgresWhereClauseBuilder(whereFilter, dotPropPathToSqlKey);
            let finalQuery = clause.whereClauseStatement;

            // Iterate over the parameters
            clause.statementArguments.forEach((param, index) => {
                const placeholder = new RegExp(`\\$${index + 1}`, 'g');

                const safeParam = typeof param === 'string' ? param.replace(/'/g, "''") : param;
                finalQuery = finalQuery.replace(placeholder, `'${safeParam}'`);
            });
            
            const query = `SELECT * FROM test_table WHERE ${finalQuery}`;
            return instance.public.query(query).rows;
        }

        return {instance, query};
    }

    test('postgres jsonb pg-mem basic', () => {
        
        const db = setupPgMem();
        expect(db.query({
            'contact.name': 'Bob'
        }).length).toBe(1);

        expect(db.query({
            'contact.name': 'Rita'
        }).length).toBe(0);


        expect(db.query({
            'contact.next_kin.name': 'Bob'
        }).length).toBe(1);
    })

    test('postgres jsonb pg-mem OR', () => {
        
        const db = setupPgMem();
        expect(db.query({
            OR: [
                {
                    'contact.name': 'Bob'
                },
                {
                    'contact.name': 'Rita'
                }
            ]
        }).length).toBe(1);
        

        expect(db.query({
            OR: [
                {
                    'contact.name': 'Bob'
                },
                {
                    'contact.name': 'Sue'
                }
            ]
        }).length).toBe(2);
    })

    test('postgres jsonb pg-mem AND', () => {
        
        const db = setupPgMem();
        
        

        expect(db.query({
            AND: [
                {
                    'contact.name': 'Bob'
                },
                {
                    'contact.name': 'Sue'
                }
            ]
        }).length).toBe(0);


        expect(db.query({
            AND: [
                {
                    'contact.name': 'Bob'
                },
                {
                    'contact.next_kin.name': 'Sue'
                }
            ]
        }).length).toBe(1);
    })


    test('postgres jsonb pg-mem NOT', () => {
        
        const db = setupPgMem();
        
        

        expect(db.query({
            NOT: [
                {
                    'contact.name': 'Bob'
                }
            ]
        }).length).toBe(1);


        expect(db.query({
            NOT: [
                {
                    'contact.name': 'Rita'
                }
            ]
        }).length).toBe(2);


        expect(db.query({
            NOT: [
                {
                    'contact.name': 'Bob'
                },
                {
                    'contact.name': 'Sue'
                }
            ]
        }).length).toBe(0);
    })
})
    
