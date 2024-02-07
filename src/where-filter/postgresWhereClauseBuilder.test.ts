import { isEqual } from "lodash-es";
import matchJavascriptObject from "./matchJavascriptObject";
import postgresWhereClauseBuilder, {  PreparedWhereClauseStatement, PropertySqlMap, postgresCreatePropertySqlMapFromSchema } from "./postgresWhereClauseBuilder";
import { z } from "zod";


function expect(a:PreparedWhereClauseStatement, b:PreparedWhereClauseStatement, details?: string) {
    if( !isEqual(a, b) ) {
        debugger;
        throw new Error(`Failed test. Details: ${details || 'na'}`)
    }
}
export default function testPostgresWhereClauseBuilder() {
    const validateAndConvertDotPropKeyToSqlKey:PropertySqlMap = (key) => key;
    
    



    
    expect(
        postgresWhereClauseBuilder(
            {
                'contact.name': 'Andy'
            },
            validateAndConvertDotPropKeyToSqlKey
        ), 
        {whereClauseStatement: `contact.name = $1`, statementArguments: ['Andy']}
    );


    
    expect(
        postgresWhereClauseBuilder(
            {
                'contact.name': {
                    'contains': 'And'
                }
            },
            validateAndConvertDotPropKeyToSqlKey
        ), 
        {whereClauseStatement: `contact.name LIKE $1`, statementArguments: ['%And%']}
    );

    
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
        ), 
        {whereClauseStatement: `(contact.name = $1 OR contact.name LIKE $2)`, statementArguments: ['Andy', '%And%']}
    );

    
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
        ), 
        {whereClauseStatement: `(contact.name = $1 OR (contact.age = $2 AND contact.address = $3))`, statementArguments: ['Andy', 100, 'York']}
    );


    
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
        ),
        {whereClauseStatement: `NOT (contact.name = $1 OR contact.name = $2)`, statementArguments: ['Andy', 'Bob']} 
    );


    // JSONB

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

    expect(
        postgresWhereClauseBuilder(
            {
                'contact.name': 'Andy'
            },
            dotPropPathToSqlKey
        ), 
        {whereClauseStatement: `(recordColumn#>>'{contact,name}')::text = $1`, statementArguments: ['Andy']}
    );

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
        ), 
        {whereClauseStatement: `((recordColumn#>>'{contact,name}')::text = $1 OR ((recordColumn#>>'{contact,age}')::numeric = $2 AND (recordColumn#>>'{contact,address}')::text = $3))`, statementArguments: ['Andy', 100, 'York']}
    );


    
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
        ),
        {whereClauseStatement: `NOT ((recordColumn#>>'{contact,name}')::text = $1 OR (recordColumn#>>'{contact,name}')::text = $2)`, statementArguments: ['Andy', 'Bob']} 
    );

    console.log("Passed: postgresWhereClauseBuilder OK");
}