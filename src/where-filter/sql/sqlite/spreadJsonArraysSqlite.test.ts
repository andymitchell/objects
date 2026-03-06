import z from "zod";
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import { spreadJsonArraysSqlite } from "./spreadJsonArraysSqlite.ts";

    test('spreadJsonArraysSqlite 0 array', () => {

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
        while (target!.parent) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonArraysSqlite('recordColumn', path);
        expect(sa).toBe(undefined)

    });

    test('spreadJsonArraysSqlite 1x array', () => {

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
        while (target!.parent) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonArraysSqlite('recordColumn', path);

        expect(sa).toEqual(
            {
                "sql": "json_each(recordColumn, '$.contact.children') AS je1",
                "output_column": "je1.value",
                "output_identifier": "je1.value"
            }
        )

    });

    test('spreadJsonArraysSqlite 2x nested', () => {

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
        while (target!.parent) {
            path.unshift(target!);
            target = target!.parent;
        }
        const sa = spreadJsonArraysSqlite('recordColumn', path);

        expect(sa).toEqual(
            {
                "sql": "json_each(recordColumn, '$.contact.children') AS je1 CROSS JOIN json_each(je1.value, '$.family.grandchildren') AS je2",
                "output_column": "je2.value",
                "output_identifier": "je2.value"
            }
        )

    });