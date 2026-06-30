
import type { TreeNode } from "../../../dot-prop-paths/schema-tree.ts";

type SpreadedJsonbArrays = {sql: string, output_column: string, output_identifier: string};
/**
 * Builds a FROM clause that spreads nested JSONB arrays using `jsonb_array_elements`, joined via CROSS JOIN.
 * Each array layer in the TreeNode path produces a new aliased column. Used by generateSql to wrap
 * array-path filters in `EXISTS (SELECT 1 FROM <this output> WHERE ...)`.
 *
 * Each spread source is type-guarded: a non-array value (e.g. a JSON null under a nullable-array field) coerces to
 * an empty array and spreads to zero rows instead of erroring, keeping the emitter faithful to the value-driven JS
 * matcher, which finds no elements in a non-array.
 *
 * @example
 * // For path children.grandchildren.name (two arrays); each source is type-guarded:
 * // → "jsonb_array_elements(CASE WHEN jsonb_typeof(col->'children') = 'array' THEN col->'children' ELSE '[]'::jsonb END) AS col1
 * //    CROSS JOIN jsonb_array_elements(CASE WHEN jsonb_typeof(col1->'grandchildren') = 'array' THEN col1->'grandchildren' ELSE '[]'::jsonb END) AS col2"
 */
export function spreadJsonbArrays(column: string, nodesDesc: TreeNode[]): SpreadedJsonbArrays | undefined {
    const jsonbbArrayElementsParts: {sql: string, output_column: string}[] = [];

    let arrayDepth = 1;
    let jsonbParts: string[] = [column];
    for (let i = 0; i < nodesDesc.length; i++) {
        const node = nodesDesc[i];
        if (!node) throw new Error("node was empty in spreadJsonbArrays");
        if (node.name) {
            jsonbParts.push(`'${node.name}'`);
            if (node.kind === 'array') {

                const newColumn = column + arrayDepth;
                const outputColumn = `${newColumn}`;

                // Guard the spread source: a `null | array` field (or any optional/nullable array) can hold a JSON
                // null — or a non-array — at runtime, and `jsonb_array_elements` errors ("cannot extract elements
                // from a scalar") on a non-array. Coerce a non-array source to an empty array so it spreads to zero
                // rows, reproducing the value-driven JS matcher, which finds no elements (hence no match) in a
                // non-array value.
                const source = jsonbParts.join('->');
                const guardedSource = `CASE WHEN jsonb_typeof(${source}) = 'array' THEN ${source} ELSE '[]'::jsonb END`;

                jsonbbArrayElementsParts.push({
                    sql: `jsonb_array_elements(${guardedSource}) AS ${newColumn}`,
                    output_column: outputColumn
                })

                arrayDepth++;
                jsonbParts = [outputColumn];

            }
        }
    }

    if (jsonbbArrayElementsParts.length === 0) return undefined;

    const output_column = jsonbbArrayElementsParts[jsonbbArrayElementsParts.length - 1]!.output_column;
    return {
        sql: jsonbbArrayElementsParts.map(x => x.sql).join(` CROSS JOIN `),
        output_column,
        output_identifier: `${output_column} #>> '{}'`
    }
}
