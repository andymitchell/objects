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

    describe('union_aware', () => {

        const SHARED_OPTS = { exclude_parent_reference: true, exclude_schema_reference: true };

        test('a union of objects throws without the option', () => {
            // The flat-map walker cannot place two object shapes at one dot-prop path.
            const schema = z.object({
                k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]),
            });
            expect(() => convertSchemaToDotPropPathTree(schema)).toThrow();
        });

        test('a top-level union throws without the option', () => {
            const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
            expect(() => convertSchemaToDotPropPathTree(schema)).toThrow();
        });

        test('a top-level union becomes a ZodUnion node with one subtree per variant', () => {
            const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });

            expect(root.kind).toBe('ZodUnion');
            expect(root.children.length).toBe(2);
            expect(root.children.every(c => c.union_variant === true)).toBe(true);

            const variantA = root.children[0]!;
            const variantB = root.children[1]!;
            expect(variantA.children.length).toBe(1);
            expect(variantA.children[0]!.name).toBe('a');
            expect(variantA.children[0]!.kind).toBe('ZodString');
            expect(variantB.children[0]!.name).toBe('b');
        });

        test('a nested union becomes a ZodUnion node and keeps every variant distinct', () => {
            const schema = z.object({
                k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]),
            });
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });

            const unionNode = root.children.find(c => c.name === 'k')!;
            expect(unionNode.kind).toBe('ZodUnion');
            expect(unionNode.children.length).toBe(2);

            // Both variants of `k.a` survive with their own type — no first-wins loss.
            const variant1A = unionNode.children[0]!.children.find(c => c.name === 'a');
            const variant2A = unionNode.children[1]!.children.find(c => c.name === 'a');
            expect(variant1A?.kind).toBe('ZodString');
            expect(variant2A?.kind).toBe('ZodNumber');
        });

        test('a union inside an array nests its variants under the array element', () => {
            const schema = z.object({
                tags: z.array(z.union([z.string(), z.object({ label: z.string() })])),
            });
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });

            const arrayNode = root.children.find(c => c.name === 'tags')!;
            expect(arrayNode.kind).toBe('ZodArray');
            expect(arrayNode.children.length).toBe(1);

            const unionNode = arrayNode.children[0]!;
            expect(unionNode.kind).toBe('ZodUnion');
            expect(unionNode.nameless_array_element).toBe(true);
            expect(unionNode.children.length).toBe(2);
            expect(unionNode.children[0]!.kind).toBe('ZodString');
            expect(unionNode.children[1]!.kind).toBe('ZodObject');
        });

        test('the union-aware tree validates against TreeNodeSchema', () => {
            const schema = z.object({
                k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]),
            });
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });
            expect(TreeNodeSchema.safeParse(root).success).toBe(true);
        });

        test('omitting the option leaves a union-in-array flattened with no ZodUnion node', () => {
            const schema = z.object({
                tags: z.array(z.union([z.string(), z.number()])),
            });
            const { root } = convertSchemaToDotPropPathTree(schema, SHARED_OPTS);
            const arrayNode = root.children.find(c => c.name === 'tags')!;
            expect(arrayNode.children.length).toBe(2);
            expect(arrayNode.children[0]!.kind).toBe('ZodString');
            expect(arrayNode.children[1]!.kind).toBe('ZodNumber');
            expect(arrayNode.children.some(c => c.kind === 'ZodUnion')).toBe(false);
        });

    });

});