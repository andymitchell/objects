import { z } from "zod";
import { convertSchemaToDotPropPathTree, getZodSchemaAtSchemaDotPropPath, TreeNodeSchema } from "./schema-tree.ts";

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
            "kind": "object",
            "children": [
                {
                    "name": "contact",
                    "dotprop_path": "contact",
                    "kind": "object",
                    "children": [
                        {
                            "name": "name",
                            "dotprop_path": "contact.name",
                            "kind": "string",
                            "children": []
                        },
                        {
                            "name": "age",
                            "dotprop_path": "contact.age",
                            "kind": "number",
                            "children": [],
                            "optional_or_nullable": true
                        },
                        {
                            "name": "emailAddress",
                            "dotprop_path": "contact.emailAddress",
                            "kind": "string",
                            "children": [],
                            "optional_or_nullable": true
                        },
                        {
                            "name": "locations",
                            "dotprop_path": "contact.locations",
                            "kind": "array",
                            "children": [
                                {
                                    "name": "",
                                    "dotprop_path": "contact.locations",
                                    "kind": "string",
                                    "children": [],
                                    "descended_from_array": true,
                                    "nameless_array_element": true
                                },
                                {
                                    "name": "",
                                    "dotprop_path": "contact.locations",
                                    "kind": "number",
                                    "children": [],
                                    "descended_from_array": true,
                                    "nameless_array_element": true
                                },
                                {
                                    "name": "",
                                    "dotprop_path": "contact.locations",
                                    "kind": "object",
                                    "children": [
                                        {
                                            "name": "city",
                                            "dotprop_path": "contact.locations.city",
                                            "kind": "string",
                                            "children": [],
                                            "descended_from_array": true,
                                            "optional_or_nullable": true
                                        },
                                        {
                                            "name": "country",
                                            "dotprop_path": "contact.locations.country",
                                            "kind": "string",
                                            "children": [],
                                            "descended_from_array": true,
                                            "optional_or_nullable": true
                                        },
                                        {
                                            "name": "flights",
                                            "dotprop_path": "contact.locations.flights",
                                            "kind": "array",
                                            "children": [
                                                {
                                                    "name": "",
                                                    "dotprop_path": "contact.locations.flights",
                                                    "kind": "string",
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

        test('a union of objects under a key flattens to the first variant without the option (no throw)', () => {
            // The flat map cannot hold two shapes at one path, so the first variant wins rather than throwing;
            // a schema-driven consumer separately rejects a genuinely ambiguous scalar|array union via
            // findShapeAmbiguousPaths. Only a non-union duplicate (a real bug) still throws.
            const schema = z.object({
                k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]),
            });
            const { map } = convertSchemaToDotPropPathTree(schema);
            expect(map['k']?.kind).toBe('object');
            expect(map['k.a']?.kind).toBe('string'); // first variant wins in the flat map
        });

        test('a top-level union no longer throws without the option (variant fields register in the flat map)', () => {
            const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
            const { map } = convertSchemaToDotPropPathTree(schema);
            expect(map['a']?.kind).toBe('string');
            expect(map['b']?.kind).toBe('string');
        });

        test('a top-level union becomes a ZodUnion node with one subtree per variant', () => {
            const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });

            expect(root.kind).toBe('union');
            expect(root.children.length).toBe(2);
            expect(root.children.every(c => c.union_variant === true)).toBe(true);

            const variantA = root.children[0]!;
            const variantB = root.children[1]!;
            expect(variantA.children.length).toBe(1);
            expect(variantA.children[0]!.name).toBe('a');
            expect(variantA.children[0]!.kind).toBe('string');
            expect(variantB.children[0]!.name).toBe('b');
        });

        test('a nested union becomes a ZodUnion node and keeps every variant distinct', () => {
            const schema = z.object({
                k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]),
            });
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });

            const unionNode = root.children.find(c => c.name === 'k')!;
            expect(unionNode.kind).toBe('union');
            expect(unionNode.children.length).toBe(2);

            // Both variants of `k.a` survive with their own type — no first-wins loss.
            const variant1A = unionNode.children[0]!.children.find(c => c.name === 'a');
            const variant2A = unionNode.children[1]!.children.find(c => c.name === 'a');
            expect(variant1A?.kind).toBe('string');
            expect(variant2A?.kind).toBe('number');
        });

        test('a union inside an array nests its variants under the array element', () => {
            const schema = z.object({
                tags: z.array(z.union([z.string(), z.object({ label: z.string() })])),
            });
            const { root } = convertSchemaToDotPropPathTree(schema, { ...SHARED_OPTS, union_aware: true });

            const arrayNode = root.children.find(c => c.name === 'tags')!;
            expect(arrayNode.kind).toBe('array');
            expect(arrayNode.children.length).toBe(1);

            const unionNode = arrayNode.children[0]!;
            expect(unionNode.kind).toBe('union');
            expect(unionNode.nameless_array_element).toBe(true);
            expect(unionNode.children.length).toBe(2);
            expect(unionNode.children[0]!.kind).toBe('string');
            expect(unionNode.children[1]!.kind).toBe('object');
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
            expect(arrayNode.children[0]!.kind).toBe('string');
            expect(arrayNode.children[1]!.kind).toBe('number');
            expect(arrayNode.children.some(c => c.kind === 'union')).toBe(false);
        });

    });

});

describe('migration baseline — walker invariants (kind-free; must survive the zod4 representation change)', () => {
    // Deliberately free of `kind` assertions: the kind vocabulary changes by design in the zod4
    // migration (the v3 'ZodArray' kind is now 'array'), so pinning it here would prove nothing. These lock what
    // must NOT change — path discovery, array-ancestry, optionality, and a schema-at-a-path
    // actually validating the value that lives there. They are the regression net for the rewrite.

    const REPRESENTATIVE = z.object({
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
                    flights: z.array(z.string()).optional(),
                }),
            ])).optional(),
        }),
    });

    test('every leaf path is discovered, with correct array-ancestry and optionality', () => {
        const { map } = convertSchemaToDotPropPathTree(REPRESENTATIVE, {
            exclude_parent_reference: true,
            exclude_schema_reference: true,
        });

        // The flat map exposes exactly these dot-prop paths. Array-element and union variants
        // legitimately share their parent's path, so the map keeps the parent; the tree keeps siblings.
        expect(new Set(Object.keys(map))).toEqual(new Set([
            '',
            'contact',
            'contact.name',
            'contact.age',
            'contact.emailAddress',
            'contact.locations',
            'contact.locations.city',
            'contact.locations.country',
            'contact.locations.flights',
        ]));

        // Metadata that drives SQL casting / jsonb array spreading / IS-NOT-NULL guards downstream.
        const flags = (p: string) => ({
            descended_from_array: !!map[p]?.descended_from_array,
            optional_or_nullable: !!map[p]?.optional_or_nullable,
        });
        expect(flags('contact')).toEqual({ descended_from_array: false, optional_or_nullable: false });
        expect(flags('contact.name')).toEqual({ descended_from_array: false, optional_or_nullable: false });
        expect(flags('contact.age')).toEqual({ descended_from_array: false, optional_or_nullable: true });
        expect(flags('contact.emailAddress')).toEqual({ descended_from_array: false, optional_or_nullable: true });
        expect(flags('contact.locations')).toEqual({ descended_from_array: false, optional_or_nullable: true });
        expect(flags('contact.locations.city')).toEqual({ descended_from_array: true, optional_or_nullable: true });
        expect(flags('contact.locations.country')).toEqual({ descended_from_array: true, optional_or_nullable: true });
        expect(flags('contact.locations.flights')).toEqual({ descended_from_array: true, optional_or_nullable: true });
    });

    test('schema-at-path resolves through optional, nullable and array wrappers to the value living there', () => {
        const schema = z.object({
            title: z.string(),
            score: z.number().nullable(),
            tags: z.array(z.string()),
            profile: z.object({ nickname: z.string().optional() }).optional(),
        });

        // nullable leaf -> a schema that accepts the value OR null, and rejects the wrong type.
        const score = getZodSchemaAtSchemaDotPropPath(schema, 'score');
        expect(score?.safeParse(42).success).toBe(true);
        expect(score?.safeParse(null).success).toBe(true);
        expect(score?.safeParse('not a number').success).toBe(false);

        // array leaf -> the ELEMENT schema (parses one element, rejects the whole array).
        const tags = getZodSchemaAtSchemaDotPropPath(schema, 'tags');
        expect(tags?.safeParse('red').success).toBe(true);
        expect(tags?.safeParse(['red']).success).toBe(false);

        // a field beneath an optional nested object still resolves and validates its own type.
        const nickname = getZodSchemaAtSchemaDotPropPath(schema, 'profile.nickname');
        expect(nickname?.safeParse('bob').success).toBe(true);
        expect(nickname?.safeParse(123).success).toBe(false);
    });

    test('default / catch / readonly wrappers are transparent: paths beneath them are still found and resolve', () => {
        // These wrappers change a value's presence/default/mutability but not its structural shape, so
        // the walker must descend through them (the v3 walker did; the zod4 rewrite must preserve it).
        const schema = z.object({
            cfg: z.object({ on: z.boolean() }).default({ on: true }),
            fallback: z.object({ tier: z.string() }).catch({ tier: 'free' }),
            locked: z.object({ code: z.number() }).readonly(),
            tags: z.array(z.string()).default([]),
        });

        const { map } = convertSchemaToDotPropPathTree(schema, {
            exclude_parent_reference: true,
            exclude_schema_reference: true,
        });

        // Wrapped object/array fields are descended into, never treated as opaque leaves.
        expect(new Set(Object.keys(map))).toEqual(new Set([
            '', 'cfg', 'cfg.on', 'fallback', 'fallback.tier', 'locked', 'locked.code', 'tags',
        ]));

        // default/catch/readonly supply an always-present value, so they do NOT mark the field optional.
        expect(!!map['cfg']?.optional_or_nullable).toBe(false);
        expect(!!map['fallback']?.optional_or_nullable).toBe(false);
        expect(!!map['locked']?.optional_or_nullable).toBe(false);

        // schema-at-path resolves through each wrapper to the inner field's own validator.
        const on = getZodSchemaAtSchemaDotPropPath(schema, 'cfg.on');
        expect(on?.safeParse(true).success).toBe(true);
        expect(on?.safeParse('nope').success).toBe(false);

        const tier = getZodSchemaAtSchemaDotPropPath(schema, 'fallback.tier');
        expect(tier?.safeParse('paid').success).toBe(true);
        expect(tier?.safeParse(7).success).toBe(false);

        const code = getZodSchemaAtSchemaDotPropPath(schema, 'locked.code');
        expect(code?.safeParse(42).success).toBe(true);
        expect(code?.safeParse('x').success).toBe(false);
    });
});

describe('a nullable array keeps its array shape in the flat map regardless of union arm order', () => {
    // The schema-driven SQL builder reads the flat map to decide whether to spread a field as an array.
    // A nullable array (`array | null`, `literal(null) | array`) is the one array/non-array union that is
    // NOT shape-ambiguous, so it reaches the builder — but its null arm carries no array metadata. First-arm
    // -wins would let a leading null/literal-null arm mask the array, silently demoting an array field to a
    // scalar one (PG then errors on the literal path; SQLite text-compares the whole array). The map must keep
    // the array arm whichever order the union declares it (shape precedence: array > object > scalar > null).
    const arrayKindAtField = (fieldSchema: z.ZodType): string | undefined => {
        const { map } = convertSchemaToDotPropPathTree(z.object({ field: fieldSchema }));
        return map['field']?.kind;
    };

    test('z.null() declared before the array arm still resolves to the array shape', () => {
        expect(arrayKindAtField(z.union([z.null(), z.array(z.string())]))).toBe('array');
    });

    test('z.literal(null) declared before the array arm still resolves to the array shape', () => {
        expect(arrayKindAtField(z.union([z.literal(null), z.array(z.string())]))).toBe('array');
    });

    test('the array arm declared first resolves to the array shape (regression: this order always worked)', () => {
        expect(arrayKindAtField(z.union([z.array(z.string()), z.null()]))).toBe('array');
        expect(arrayKindAtField(z.union([z.array(z.string()), z.literal(null)]))).toBe('array');
    });

    test('the array element is still discovered beneath the array even when the null arm comes first', () => {
        const { map } = convertSchemaToDotPropPathTree(z.object({ field: z.union([z.literal(null), z.array(z.string())]) }));
        expect(map['field']?.kind).toBe('array');
        // The nameless string element is a child of the array node, so the builder can cast/spread it.
        expect(map['field']?.children.some(c => c.kind === 'string' && c.nameless_array_element === true)).toBe(true);
    });

    test('two flattened object variants still tie to the first (precedence only overrides a strictly lower shape)', () => {
        // Guard the precedence rule does NOT disturb equal-shape collisions: object-vs-object stays first-wins.
        const { map } = convertSchemaToDotPropPathTree(z.object({
            k: z.union([z.object({ a: z.string() }), z.object({ a: z.number() })]),
        }));
        expect(map['k']?.kind).toBe('object');
        expect(map['k.a']?.kind).toBe('string');
    });
});

describe('getZodSchemaAtSchemaDotPropPath { crossArrays: false }', () => {
    // Matches DotPropPathsUnion<T> (stops at arrays) + getProperty (no spread) — for validating a single
    // sortable path like a default_ordering_key, which must not descend into an array element.
    const s = z.object({
        id: z.string(),
        background: z.object({ created_at: z.string() }),
        children: z.array(z.object({ name: z.string(), age: z.number() })),
    });

    it('accepts a top-level key and a nested-object path', () => {
        expect(getZodSchemaAtSchemaDotPropPath(s, 'id', { crossArrays: false })).toBeDefined();
        expect(getZodSchemaAtSchemaDotPropPath(s, 'background.created_at', { crossArrays: false })).toBeDefined();
    });

    it('rejects a path that descends INTO an array element (which the array-unwrapping default accepts)', () => {
        expect(getZodSchemaAtSchemaDotPropPath(s, 'children.age', { crossArrays: false })).toBeUndefined();
        expect(getZodSchemaAtSchemaDotPropPath(s, 'children.age')).toBeDefined();
    });

    it('rejects an absent key', () => {
        expect(getZodSchemaAtSchemaDotPropPath(s, 'nope', { crossArrays: false })).toBeUndefined();
    });
});