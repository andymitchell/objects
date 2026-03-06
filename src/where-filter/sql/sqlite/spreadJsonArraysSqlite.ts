
import type { TreeNode } from "../../../dot-prop-paths/zod.ts";

type SpreadedJsonArrays = { sql: string, output_column: string, output_identifier: string };
/**
 * Builds a FROM clause that spreads nested JSON arrays using `json_each()`, joined via CROSS JOIN.
 * SQLite equivalent of spreadJsonbArrays. Each array layer produces a new aliased table.
 *
 * @example
 * // For path children.grandchildren.name (two arrays):
 * // → "json_each(col, '$.children') AS je1 CROSS JOIN json_each(je1.value, '$.grandchildren') AS je2"
 * // output_column: "je2.value", output_identifier: "je2.value"
 */
export function spreadJsonArraysSqlite(column: string, nodesDesc: TreeNode[]): SpreadedJsonArrays | undefined {
    const parts: { sql: string, output_value: string }[] = [];

    // Derive alias prefix from column to avoid conflicts in nested spreading.
    const aliasMatch = column.match(/^(je\S*)\./);
    const aliasBase = aliasMatch ? aliasMatch[1] + '_' : 'je';

    let arrayDepth = 1;
    let currentSource = column;
    let pathSegments: string[] = [];

    for (let i = 0; i < nodesDesc.length; i++) {
        const node = nodesDesc[i];
        if (!node) throw new Error("node was empty in spreadJsonArraysSqlite");
        if (node.name) {
            pathSegments = [...pathSegments, node.name];
            if (node.kind === 'ZodArray') {
                const alias = `${aliasBase}${arrayDepth}`;
                const jsonPath = '$.' + pathSegments.join('.');
                parts.push({
                    sql: `json_each(${currentSource}, '${jsonPath}') AS ${alias}`,
                    output_value: `${alias}.value`
                });

                arrayDepth++;
                currentSource = `${alias}.value`;
                pathSegments = [];
            }
        }
    }

    if (parts.length === 0) return undefined;

    const lastPart = parts[parts.length - 1]!;
    return {
        sql: parts.map(p => p.sql).join(' CROSS JOIN '),
        output_column: lastPart.output_value,
        output_identifier: lastPart.output_value
    };
}
