import { z } from "zod";
import { getZodSchemaAtSchemaDotPropPath } from "./zod";

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
        expect(petsSchema?.safeParse(obj.children[0].pets[0]).success).toBe(true);

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
        expect(childrenChildren?.safeParse(nested.children[0].children[0]).success).toBe(true);
    })

});