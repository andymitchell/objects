
import type { TreeNode } from "../../../dot-prop-paths/zod.ts";

type SpreadedJsonbArrays = {sql: string, output_column: string, output_identifier: string};
/**
 * Builds a FROM clause that spreads nested JSONB arrays using `jsonb_array_elements`, joined via CROSS JOIN.
 * Each array layer in the TreeNode path produces a new aliased column. Used by generateSql to wrap
 * array-path filters in `EXISTS (SELECT 1 FROM <this output> WHERE ...)`.
 *
 * @example
 * // For path children.grandchildren.name (two arrays):
 * // → "jsonb_array_elements(col->'children') AS col1 CROSS JOIN jsonb_array_elements(col1->'grandchildren') AS col2"
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
            if (node.kind === 'ZodArray') {

                const newColumn = column + arrayDepth;
                const outputColumn = `${newColumn}`;

                jsonbbArrayElementsParts.push({
                    sql: `jsonb_array_elements(${jsonbParts.join('->')}) AS ${newColumn}`,
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
