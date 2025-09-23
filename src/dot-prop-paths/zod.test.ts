import { z } from "zod";
import { convertSchemaToDotPropPathTree, getZodSchemaAtSchemaDotPropPath, TreeNodeSchema } from "./zod.js";

describe('Zod test', () => {

    const schema = z.object({
        id: z.string(),
        children: z.array(
            z.object({
                name: z.string(),
                age: z.number(),
                pets: z.array(z.object({
                    type: z.string()
                }))
            })
        )
    });
    type SchemaType = z.infer<typeof schema>;

    const obj:SchemaType = {
        id: '1',
        children: [
            {
                name: 'Bob',
                age: 30,
                pets: [{
                    type: 'cat'
                }]
            }
        ]
    };

    

    test('getZodSchemaAtSchemaDotPropPath', () => {
        

        expect(schema.safeParse(obj).success).toBe(true);

        const childrenSchema = getZodSchemaAtSchemaDotPropPath(schema, 'children');
        expect(childrenSchema?.safeParse(obj.children[0]).success).toBe(true);
        expect(childrenSchema?.safeParse(obj.children).success).toBe(false);

        const petsSchema = getZodSchemaAtSchemaDotPropPath(schema, 'children.pets');
        expect(petsSchema?.safeParse(obj.children[0]!.pets[0]).success).toBe(true);

        const childrenTypeSchema = getZodSchemaAtSchemaDotPropPath(schema, 'children');
        expect(childrenTypeSchema?.safeParse(obj.children[0]).success).toBe(true);
        
    });

    test('getZodSchemaAtSchemaDotPropPath optional schema', () => {
        const Nested = z.object({
            children: z.array(
              z.object({
                cid: z.string(),
                children: z.array(
                  z.object({
                    ccid: z.string(),
                  })
                ),
              })
            ).optional(),
          });
          
        type Nested = z.infer<typeof Nested>;

        const nested:Nested = {
            children: [
                {
                    cid: 'Bob',
                    children: [{ccid: '1'}]
                }
            ]
        };

        const childrenChildren = getZodSchemaAtSchemaDotPropPath(Nested, 'children.children');
        if( !nested.children ) throw new Error("noop");
        expect(!!childrenChildren).toBe(true);
        expect(childrenChildren?.safeParse(nested.children[0]!.children[0]).success).toBe(true);
    })

    test('convertSchemaToDotPropPathTree', () => {
        const result = convertSchemaToDotPropPathTree(z.object({
            contact: z.object({
                name: z.string(),
                age: z.number().optional(),
                emailAddress: z.string().optional(),
                locations: z.array(z.union([
                    z.string(),
                    z.number(),
                    z.object({
                        city: z.string().optional(),
                        country: z.string().optional(),
                        flights: z.array(z.string()).optional()
                    })
                ])).optional()
            })
            
        }), {
            exclude_parent_reference: true,
            exclude_schema_reference: true
        })
        //debugger;
        // This result was copied from a run I was happy with. It's here to prevent regressions.
        const parseResult = TreeNodeSchema.safeParse(result.root);
        expect(parseResult.success).toBe(true);
        expect(result.root).toEqual({
            "name": "",
            "dotprop_path": "",
            "kind": "ZodObject",
            "children": [
                {
                    "name": "contact",
                    "dotprop_path": "contact",
                    "kind": "ZodObject",
                    "children": [
                        {
                            "name": "name",
                            "dotprop_path": "contact.name",
                            "kind": "ZodString",
                            "children": []
                        },
                        {
                            "name": "age",
                            "dotprop_path": "contact.age",
                            "kind": "ZodNumber",
                            "children": [],
                            "optional_or_nullable": true
                        },
                        {
                            "name": "emailAddress",
                            "dotprop_path": "contact.emailAddress",
                            "kind": "ZodString",
                            "children": [],
                            "optional_or_nullable": true
                        },
                        {
                            "name": "locations",
                            "dotprop_path": "contact.locations",
                            "kind": "ZodArray",
                            "children": [
                                {
                                    "name": "",
                                    "dotprop_path": "contact.locations",
                                    "kind": "ZodString",
                                    "children": [],
                                    "descended_from_array": true,
                                    "nameless_array_element": true
                                },
                                {
                                    "name": "",
                                    "dotprop_path": "contact.locations",
                                    "kind": "ZodNumber",
                                    "children": [],
                                    "descended_from_array": true,
                                    "nameless_array_element": true
                                },
                                {
                                    "name": "",
                                    "dotprop_path": "contact.locations",
                                    "kind": "ZodObject",
                                    "children": [
                                        {
                                            "name": "city",
                                            "dotprop_path": "contact.locations.city",
                                            "kind": "ZodString",
                                            "children": [],
                                            "descended_from_array": true,
                                            "optional_or_nullable": true
                                        },
                                        {
                                            "name": "country",
                                            "dotprop_path": "contact.locations.country",
                                            "kind": "ZodString",
                                            "children": [],
                                            "descended_from_array": true,
                                            "optional_or_nullable": true
                                        },
                                        {
                                            "name": "flights",
                                            "dotprop_path": "contact.locations.flights",
                                            "kind": "ZodArray",
                                            "children": [
                                                {
                                                    "name": "",
                                                    "dotprop_path": "contact.locations.flights",
                                                    "kind": "ZodString",
                                                    "children": [],
                                                    "descended_from_array": true,
                                                    "nameless_array_element": true
                                                }
                                            ],
                                            "descended_from_array": true,
                                            "optional_or_nullable": true
                                        }
                                    ],
                                    "descended_from_array": true,
                                    "nameless_array_element": true
                                }
                            ],
                            "optional_or_nullable": true
                        }
                    ]
                }
            ]
        })
        
    })

});