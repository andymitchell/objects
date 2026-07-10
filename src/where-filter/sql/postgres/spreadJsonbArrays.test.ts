import { z } from "zod";
import { convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import { spreadJsonbArrays } from "./spreadJsonbArrays.ts";
import { pgQuoteLiteral } from "../../../utils/sql/postgres/pgJsonbAccessor.ts";

/**
 * The raw `->` chain spreadJsonbArrays builds for one array source: the column, then each key quoted as a
 * Postgres escape-string literal, joined by `->`. Expressed via pgQuoteLiteral so a change to how a key is
 * quoted updates these pins with the emitter, never drifting into a hand-written literal.
 */
const rawChain = (column: string, ...keys: string[]) => [column, ...keys.map(pgQuoteLiteral)].join('->');


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

        const src = rawChain('recordColumn', 'contact', 'children');
        expect(sa).toEqual(
            {
                "sql": `jsonb_array_elements(CASE WHEN jsonb_typeof(${src}) = 'array' THEN ${src} ELSE '[]'::jsonb END) AS recordColumn1`,
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

        const outer = rawChain('recordColumn', 'contact', 'children');
        const inner = rawChain('recordColumn1', 'family', 'grandchildren');
        expect(sa).toEqual(
            {
                "sql": `jsonb_array_elements(CASE WHEN jsonb_typeof(${outer}) = 'array' THEN ${outer} ELSE '[]'::jsonb END) AS recordColumn1 CROSS JOIN jsonb_array_elements(CASE WHEN jsonb_typeof(${inner}) = 'array' THEN ${inner} ELSE '[]'::jsonb END) AS recordColumn2`,
                "output_column": "recordColumn2",
                "output_identifier": "recordColumn2 #>> '{}'"
            }
        )


    });


