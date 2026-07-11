import { z } from "zod";
import { convertSchemaToDotPropPathTree } from "../../dot-prop-paths/schema-tree.ts";
import { resolvePath } from "../../dot-prop-paths/resolvePath.ts";
import type { TreeNodeMap } from "../../dot-prop-paths/schema-tree.ts";
import type { Predicate } from "../ast/index.ts";
import { planSqlArrayTraversal } from "./planSqlArrayTraversal.ts";
import type { SqlPredicate } from "./planSqlArrayTraversal.ts";

const SIZE_TWO: Predicate = { kind: 'size', n: 2 };

const plan = (path: string, nodeMap: TreeNodeMap, predicate: Predicate = SIZE_TWO): SqlPredicate => {
    const resolved = resolvePath(path, nodeMap);
    if (!resolved.success) throw new Error(`test path did not resolve: ${path}`);
    return planSqlArrayTraversal(resolved.resolved, predicate);
};

const mapOf = (schema: z.ZodTypeAny): TreeNodeMap => convertSchemaToDotPropPathTree(schema as z.ZodSchema<any>).map;

describe('planning how a SQL emitter reaches the array a path ends at', () => {

    describe('a path that does not end at an array is left alone', () => {
        const nodeMap = mapOf(z.object({
            name: z.string(),
            children: z.array(z.object({ child_name: z.string() })),
        }));

        test('a path crossing no array is unplanned', () => {
            expect(plan('name', nodeMap)).toEqual(SIZE_TWO);
        });

        test('a scalar leaf beneath an array is unplanned, because it is read from each spread element', () => {
            expect(plan('children.child_name', nodeMap)).toEqual(SIZE_TWO);
        });

        test('a record path that crosses an array is left unplanned: it has no enumerated node to traverse', () => {
            // A record-value array (`data.<key>.tags`) resolves with arrayDepth > 0 but no path-map node — a
            // schema-planned traversal cannot address a dynamic key. The planner passes the predicate through;
            // such a path is refused upstream, never reaching an emitter that would try to spread it.
            const recordMap = mapOf(z.object({ data: z.record(z.string(), z.object({ tags: z.array(z.string()) })) }));
            expect(plan('data.foo.tags', recordMap)).toEqual(SIZE_TWO);
        });
    });

    describe('a path ending at an array binds the condition to that leaf array', () => {

        test('an array reached without crossing another is addressed straight from the column', () => {
            const planned = plan('tags', mapOf(z.object({ tags: z.array(z.string()) })));
            expect(planned).toMatchObject({ kind: 'traverseArray', intermediates: [], leafSegments: ['tags'] });
        });

        test('a nested array names the array above it to spread, and the keys reaching the leaf', () => {
            const planned = plan('groups.subtags', mapOf(z.object({
                groups: z.array(z.object({ subtags: z.array(z.string()) })),
            })));
            expect(planned).toMatchObject({ kind: 'traverseArray', leafSegments: ['subtags'] });
            expect((planned as { intermediates: { name: string }[] }).intermediates.map(n => n.name)).toEqual(['groups']);
        });

        test('keys between the spread array and the leaf array travel with the leaf, not with the spread', () => {
            const planned = plan('contact.children.family.grandchildren', mapOf(z.object({
                contact: z.object({
                    children: z.array(z.object({
                        family: z.object({ grandchildren: z.array(z.object({ name: z.string() })) }),
                    })),
                }),
            })));
            // `contact` precedes the spread array, so it belongs to the spread; `family` sits below it.
            expect((planned as { intermediates: { name: string }[] }).intermediates.map(n => n.name)).toEqual(['contact', 'children']);
            expect(planned).toMatchObject({ leafSegments: ['family', 'grandchildren'] });
        });

        test('a key holding a literal dot stays one segment, never two', () => {
            const planned = plan('rows.a\\.b', mapOf(z.object({
                rows: z.array(z.object({ 'a.b': z.array(z.string()) })),
            })));
            expect(planned).toMatchObject({ leafSegments: ['a.b'] });
        });

        test('the leaf array node travels with the plan, so element conditions can be typed from its schema', () => {
            const planned = plan('groups.subtags', mapOf(z.object({
                groups: z.array(z.object({ subtags: z.array(z.string()) })),
            })));
            expect((planned as { leafArrayNode: { name: string, kind: string } }).leafArrayNode).toMatchObject({ name: 'subtags', kind: 'array' });
        });
    });

    test('a conjunction is bound whole, so its operators cannot be satisfied by different leaf arrays', () => {
        const conjunction: Predicate = { kind: 'and', children: [SIZE_TWO, { kind: 'all', elements: ['a'] }] };
        const planned = plan('groups.subtags', mapOf(z.object({
            groups: z.array(z.object({ subtags: z.array(z.string()) })),
        })), conjunction);

        expect(planned).toMatchObject({ kind: 'traverseArray', child: conjunction });
    });
});
