import { z } from "zod";
import { type TreeNodeMap, type ZodKind, convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/zod.ts";
import { isZodSchema } from "../../isZodSchema.ts";
import type { DotPropPathConversionResult } from "../types.ts";

export const UNSAFE_WARNING = "It's unsafe to generate a SQL identifier for this.";

/**
 * Converts a dot-prop path into a type-cast Postgres JSONB accessor expression.
 * Uses the TreeNodeMap (or Zod schema) to determine the correct `->` / `->>` operators and Pg type cast.
 * Rejects unknown paths to prevent SQL injection.
 *
 * @example
 * convertDotPropPathToPostgresJsonPath('data', 'contact.name', nodeMap)
 * // → { success: true, expression: "(data->'contact'->>'name')::text" }
 *
 * @example
 * convertDotPropPathToPostgresJsonPath('data', 'unknown.path', nodeMap)
 * // → { success: false, error: { type: 'unknown_path', dotPropPath: 'unknown.path', message: "Unknown dotPropPath. ..." } }
 */
export function convertDotPropPathToPostgresJsonPath<T extends Record<string, any> = Record<string, any>>(columnName:string, dotPropPath:string, nodeMap: TreeNodeMap, errorIfNotAsExpected?:ZodKind[], noCasting?:boolean):DotPropPathConversionResult;
export function convertDotPropPathToPostgresJsonPath<T extends Record<string, any> = Record<string, any>>(columnName:string, dotPropPath:string, schema:z.ZodSchema<T>, errorIfNotAsExpected?:ZodKind[], noCasting?:boolean):DotPropPathConversionResult;
export function convertDotPropPathToPostgresJsonPath<T extends Record<string, any> = Record<string, any>>(columnName:string, dotPropPath:string, nodeMapOrSchema: TreeNodeMap | z.ZodSchema<T>, errorIfNotAsExpected?:ZodKind[], noCasting?:boolean):DotPropPathConversionResult {
    let nodeMap: TreeNodeMap | undefined;
    let schema: z.ZodSchema<T> | undefined;
    if( isZodSchema(nodeMapOrSchema) ) {
        schema = nodeMapOrSchema;
    } else {
        nodeMap = nodeMapOrSchema;
    }
    if( !nodeMap ) {
        if( !schema ) return { success: false, error: { type: 'missing_schema', dotPropPath, message: "Must supply TreeNodeMap or Schema" } };
        const result = convertSchemaToDotPropPathTree(schema);
        nodeMap = result.map;
    }

    if( !nodeMap[dotPropPath] ) {
        return { success: false, error: { type: 'unknown_path', dotPropPath, message: `Unknown dotPropPath. ${UNSAFE_WARNING}` } };
    }

    const jsonbParts = dotPropPath.split(".");
    const castingMap:Partial<Record<ZodKind, string>> = {
        'ZodString': '::text',
        'ZodNumber': '::numeric',
        'ZodBoolean': '::boolean',
        'ZodBigInt': '::bigint',
        'ZodObject': '::jsonb',
        'ZodArray': '::jsonb',
        'ZodNull': '',
    }

    const nodeMapForPath = nodeMap[dotPropPath];
    if( !nodeMapForPath ) return { success: false, error: { type: 'unknown_path', dotPropPath, message: `No details at nodeMap[dotPropPath] for ${dotPropPath}` } };
    const zodKind = nodeMapForPath.kind;

    let jsonbPath:string = '';
    while(jsonbParts.length) {
        const part = jsonbParts.shift();
        if( !part ) {
            return { success: false, error: { type: 'invalid_path', dotPropPath, message: `Unknown part in dotPropPath. ${UNSAFE_WARNING}` } };
        }
        jsonbPath += `${jsonbParts.length>0 || (jsonbParts.length===0 && ['ZodArray', 'ZodObject'].includes(zodKind))? '->' : '->>'}'${part}'`;
    }


    if( !castingMap[zodKind] ) return { success: false, error: { type: 'unsupported_kind', dotPropPath, message: `Unknown ZodKind Postgres cast: ${zodKind}. ${UNSAFE_WARNING}` } };
    if( errorIfNotAsExpected && !errorIfNotAsExpected.includes(zodKind) ) return { success: false, error: { type: 'unexpected_kind', dotPropPath, message: `ZodKind Postgres cast was not as expected: ${zodKind}. Expected: ${errorIfNotAsExpected}. ${UNSAFE_WARNING}` } };

    const cast = noCasting? '' : (castingMap[zodKind] ?? '');
    return { success: true, expression: `(${columnName}${jsonbPath})${cast}` };
}
