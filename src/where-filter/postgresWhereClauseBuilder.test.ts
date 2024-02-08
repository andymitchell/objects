import postgresWhereClauseBuilder, {  PropertySqlMap, postgresCreatePropertySqlMapFromSchema } from "./postgresWhereClauseBuilder";
import { z } from "zod";



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
        ).toEqual({whereClauseStatement: `(recordColumn#>>'{contact,name}')::text = $1`, statementArguments: ['Andy']});
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
        ).toEqual({whereClauseStatement: `((recordColumn#>>'{contact,name}')::text = $1 OR ((recordColumn#>>'{contact,age}')::numeric = $2 AND (recordColumn#>>'{contact,address}')::text = $3))`, statementArguments: ['Andy', 100, 'York']});
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
        ).toEqual({whereClauseStatement: `NOT ((recordColumn#>>'{contact,name}')::text = $1 OR (recordColumn#>>'{contact,name}')::text = $2)`, statementArguments: ['Andy', 'Bob']} );
    });
})
    
