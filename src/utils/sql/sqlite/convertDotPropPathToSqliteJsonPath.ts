import { z } from "zod";
import { type TreeNodeMap, type ZodKind, convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import { isZodSchema } from "../../isZodSchema.ts";
import type { DotPropPathConversionResult } from "../types.ts";

export const SQLITE_UNSAFE_WARNING = "It's unsafe to generate a SQL identifier for this.";

/**
 * Converts a dot-prop path into a SQLite json_extract() expression.
 * Uses the TreeNodeMap (or Zod schema) to validate the path exists (preventing SQL injection).
 *
 * @example
 * convertDotPropPathToSqliteJsonPath('data', 'contact.name', nodeMap)
 * // → { success: true, expression: "json_extract(data, '$.contact.name')" }
 *
 * @example
 * convertDotPropPathToSqliteJsonPath('data', 'unknown.path', nodeMap)
 * // → { success: false, error: { type: 'unknown_path', dotPropPath: 'unknown.path', message: "Unknown dotPropPath. ..." } }
 */
export function convertDotPropPathToSqliteJsonPath<T extends Record<string, any> = Record<string, any>>(columnName: string, dotPropPath: string, nodeMap: TreeNodeMap, errorIfNotAsExpected?: ZodKind[]): DotPropPathConversionResult;
export function convertDotPropPathToSqliteJsonPath<T extends Record<string, any> = Record<string, any>>(columnName: string, dotPropPath: string, schema: z.ZodSchema<T>, errorIfNotAsExpected?: ZodKind[]): DotPropPathConversionResult;
export function convertDotPropPathToSqliteJsonPath<T extends Record<string, any> = Record<string, any>>(columnName: string, dotPropPath: string, nodeMapOrSchema: TreeNodeMap | z.ZodSchema<T>, errorIfNotAsExpected?: ZodKind[]): DotPropPathConversionResult {
    let nodeMap: TreeNodeMap | undefined;
    let schema: z.ZodSchema<T> | undefined;
    if (isZodSchema(nodeMapOrSchema)) {
        schema = nodeMapOrSchema;
    } else {
        nodeMap = nodeMapOrSchema;
    }
    if (!nodeMap) {
        if (!schema) return { success: false, error: { type: 'missing_schema', dotPropPath, message: "Must supply TreeNodeMap or Schema" } };
        const result = convertSchemaToDotPropPathTree(schema);
        nodeMap = result.map;
    }

    if (!dotPropPath || dotPropPath.split('.').some(s => !s)) {
        return { success: false, error: { type: 'invalid_path', dotPropPath, message: `Invalid dotPropPath. ${SQLITE_UNSAFE_WARNING}` } };
    }

    if (!nodeMap[dotPropPath]) {
        return { success: false, error: { type: 'unknown_path', dotPropPath, message: `Unknown dotPropPath. ${SQLITE_UNSAFE_WARNING}` } };
    }

    const nodeMapForPath = nodeMap[dotPropPath];
    if (!nodeMapForPath) return { success: false, error: { type: 'unknown_path', dotPropPath, message: `No details at nodeMap[dotPropPath] for ${dotPropPath}` } };
    const zodKind = nodeMapForPath.kind;

    if (errorIfNotAsExpected && !errorIfNotAsExpected.includes(zodKind)) {
        return { success: false, error: { type: 'unexpected_kind', dotPropPath, message: `ZodKind was not as expected: ${zodKind}. Expected: ${errorIfNotAsExpected}. ${SQLITE_UNSAFE_WARNING}` } };
    }

    const jsonPath = '$.' + dotPropPath.split('.').join('.');

    return { success: true, expression: `json_extract(${columnName}, '${jsonPath}')` };
}
