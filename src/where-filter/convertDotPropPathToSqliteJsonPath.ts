import { z } from "zod";
import { type TreeNodeMap, type ZodKind, convertSchemaToDotPropPathTree } from "../dot-prop-paths/zod.js";
import { isZodSchema } from "../utils/isZodSchema.js";

export const SQLITE_UNSAFE_WARNING = "It's unsafe to generate a SQL identifier for this.";

/**
 * Converts a dot-prop path into a SQLite json_extract() expression.
 * Uses the TreeNodeMap (or Zod schema) to validate the path exists (preventing SQL injection).
 *
 * @example
 * convertDotPropPathToSqliteJsonPath('data', 'contact.name', nodeMap)
 * // → "json_extract(data, '$.contact.name')"
 *
 * @example
 * convertDotPropPathToSqliteJsonPath('data', 'contact.locations', nodeMap)
 * // → "json_extract(data, '$.contact.locations')"
 */
export function convertDotPropPathToSqliteJsonPath<T extends Record<string, any> = Record<string, any>>(columnName: string, dotPropPath: string, nodeMap: TreeNodeMap, errorIfNotAsExpected?: ZodKind[]): string;
export function convertDotPropPathToSqliteJsonPath<T extends Record<string, any> = Record<string, any>>(columnName: string, dotPropPath: string, schema: z.ZodSchema<T>, errorIfNotAsExpected?: ZodKind[]): string;
export function convertDotPropPathToSqliteJsonPath<T extends Record<string, any> = Record<string, any>>(columnName: string, dotPropPath: string, nodeMapOrSchema: TreeNodeMap | z.ZodSchema<T>, errorIfNotAsExpected?: ZodKind[]): string {
    let nodeMap: TreeNodeMap | undefined;
    let schema: z.ZodSchema<T> | undefined;
    if (isZodSchema(nodeMapOrSchema)) {
        schema = nodeMapOrSchema;
    } else {
        nodeMap = nodeMapOrSchema;
    }
    if (!nodeMap) {
        if (!schema) throw new Error("Must supply TreeNodeMap or Schema");
        const result = convertSchemaToDotPropPathTree(schema);
        nodeMap = result.map;
    }

    if (!dotPropPath || dotPropPath.split('.').some(s => !s)) {
        throw new Error(`Invalid dotPropPath. ${SQLITE_UNSAFE_WARNING}`);
    }

    if (!nodeMap[dotPropPath]) {
        throw new Error(`Unknown dotPropPath. ${SQLITE_UNSAFE_WARNING}`);
    }

    const nodeMapForPath = nodeMap[dotPropPath];
    if (!nodeMapForPath) throw new Error(`No details at nodeMap[dotPropPath] for ${dotPropPath}`);
    const zodKind = nodeMapForPath.kind;

    if (errorIfNotAsExpected && !errorIfNotAsExpected.includes(zodKind)) {
        throw new Error(`ZodKind was not as expected: ${zodKind}. Expected: ${errorIfNotAsExpected}. ${SQLITE_UNSAFE_WARNING}`);
    }

    const jsonPath = '$.' + dotPropPath.split('.').join('.');

    return `json_extract(${columnName}, '${jsonPath}')`;
}
