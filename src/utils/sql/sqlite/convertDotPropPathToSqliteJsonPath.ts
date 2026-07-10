import { z } from "zod";
import { type TreeNodeMap, type ZodKind, convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import { isUnspreadableRecordPath, resolvePath } from "../../../dot-prop-paths/resolvePath.ts";
import { isZodSchema } from "../../isZodSchema.ts";
import type { DotPropPathConversionResult } from "../types.ts";
import { sqliteJsonPathSegments, sqliteSqlStringLiteral } from "./sqliteJsonPath.ts";

export const SQLITE_UNSAFE_WARNING = "It's unsafe to generate a SQL identifier for this.";

/**
 * Converts a dot-prop path into a SQLite json_extract() expression.
 *
 * The path is resolved against the schema first, so only a field the schema describes produces an
 * expression. Each key is then rendered as a quoted JSON-path segment, which makes a key that carries a
 * quote, a dot, or a comment marker inert data rather than syntax.
 *
 * @example
 * convertDotPropPathToSqliteJsonPath('data', 'contact.name', nodeMap)
 * // → { success: true, expression: `json_extract(data, '$."contact"."name"')` }
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

    const result = resolvePath(dotPropPath, nodeMap);
    if (!result.success) {
        return { success: false, error: { type: 'invalid_path', dotPropPath, message: `Invalid dotPropPath. ${SQLITE_UNSAFE_WARNING}` } };
    }
    const resolved = result.resolved;
    if (!resolved.known) {
        return { success: false, error: { type: 'unknown_path', dotPropPath, message: `Unknown dotPropPath. ${SQLITE_UNSAFE_WARNING}` } };
    }
    if (isUnspreadableRecordPath(resolved)) {
        return { success: false, error: { type: 'unsupported_kind', dotPropPath, message: `A dotPropPath that crosses an array beneath a record key cannot be addressed. ${SQLITE_UNSAFE_WARNING}` } };
    }

    if (errorIfNotAsExpected && !errorIfNotAsExpected.includes(resolved.leafKind)) {
        return { success: false, error: { type: 'unexpected_kind', dotPropPath, message: `ZodKind was not as expected: ${resolved.leafKind}. Expected: ${errorIfNotAsExpected}. ${SQLITE_UNSAFE_WARNING}` } };
    }

    const jsonPath = sqliteSqlStringLiteral(sqliteJsonPathSegments(resolved.segments));
    return { success: true, expression: `json_extract(${columnName}, ${jsonPath})` };
}
