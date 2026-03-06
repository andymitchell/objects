import z from "zod";
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import { spreadJsonbArrays } from "./spreadJsonbArrays.ts";


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


