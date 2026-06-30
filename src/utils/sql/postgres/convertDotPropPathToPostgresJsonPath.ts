import { z } from "zod";
import { type TreeNodeMap, type ZodKind, convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import { getEnumValues, type AnyZodSchema } from "../../../zod/introspection.ts";
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
        'string': '::text',
        'number': '::numeric',
        'boolean': '::boolean',
        'bigint': '::bigint',
        'object': '::jsonb',
        'array': '::jsonb',
        'null': '',
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
        jsonbPath += `${jsonbParts.length>0 || (jsonbParts.length===0 && ['array', 'object'].includes(zodKind))? '->' : '->>'}'${part}'`;
    }


    // An enum has no fixed cast entry — its column type is the scalar kind its members share — so resolve it from
    // the schema (single-kind enums only: a mixed-scalar enum is routed to the raw-JSONB comparison path upstream
    // by findMultiScalarUnionPaths and never reaches here). Every other kind keeps its direct map entry, including
    // the existing treatment of an empty/unmapped cast as an unsupported kind.
    const mappedCast = zodKind === 'enum' ? enumScalarCast(nodeMapForPath.schema) : castingMap[zodKind];

    if( !mappedCast ) return { success: false, error: { type: 'unsupported_kind', dotPropPath, message: `Unknown ZodKind Postgres cast: ${zodKind}. ${UNSAFE_WARNING}` } };
    if( errorIfNotAsExpected && !errorIfNotAsExpected.includes(zodKind) ) return { success: false, error: { type: 'unexpected_kind', dotPropPath, message: `ZodKind Postgres cast was not as expected: ${zodKind}. Expected: ${errorIfNotAsExpected}. ${UNSAFE_WARNING}` } };

    const cast = noCasting? '' : mappedCast;
    return { success: true, expression: `(${columnName}${jsonbPath})${cast}` };
}

/**
 * Postgres cast for an enum column, derived from the scalar type its members share.
 *
 * An enum has no fixed entry in the kind→cast map because its column type depends on its members: a string enum is
 * a text column, a native numeric enum a numeric column. Members are read with {@link getEnumValues} (which drops a
 * numeric enum's reverse-mapping), so this classification matches how `findMultiScalarUnionPaths` decides a field's
 * shape — a single-scalar-kind enum reaches the cast and is resolved here; a mixed-scalar enum is diverted to the
 * raw-JSONB comparison path upstream and never does.
 *
 * @param schema the enum's Zod schema, taken from the path's TreeNode (`undefined` when the tree was built without
 * schema references).
 * @returns the cast — `::text` (string), `::numeric` (number), or `::boolean` (boolean) — or `undefined` for an
 * empty, mixed-scalar, non-scalar, or schema-less enum, so the caller raises a clean `unsupported_kind` error
 * instead of emitting a cast that would fail at query time.
 */
function enumScalarCast(schema: AnyZodSchema | undefined): string | undefined {
    if( !schema ) return undefined;
    const memberKinds = new Set(getEnumValues(schema).map((member) => typeof member));
    if( memberKinds.size !== 1 ) return undefined; // empty or mixed-scalar enum — no single column type
    if( memberKinds.has('string') ) return '::text';
    if( memberKinds.has('number') ) return '::numeric';
    if( memberKinds.has('boolean') ) return '::boolean';
    return undefined; // bigint / symbol / object member — not a representable scalar cast
}
