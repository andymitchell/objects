import { z } from "zod";
import { TreeNodeMap, ZodKind, convertSchemaToDotPropPathTree } from "../dot-prop-paths/zod";
import { isZodSchema } from "../utils/isZodSchema";

export const UNSAFE_WARNING = "It's unsafe to generate a SQL identifier for this.";

export function convertDotPropPathToPostgresJsonPath<T extends Record<string, any> = Record<string, any>>(columnName:string, dotPropPath:string, nodeMap: TreeNodeMap, errorIfNotAsExpected?:ZodKind[], noCasting?:boolean):string;
export function convertDotPropPathToPostgresJsonPath<T extends Record<string, any> = Record<string, any>>(columnName:string, dotPropPath:string, schema:z.ZodSchema<T>, errorIfNotAsExpected?:ZodKind[], noCasting?:boolean):string;
export function convertDotPropPathToPostgresJsonPath<T extends Record<string, any> = Record<string, any>>(columnName:string, dotPropPath:string, nodeMapOrSchema: TreeNodeMap | z.ZodSchema<T>, errorIfNotAsExpected?:ZodKind[], noCasting?:boolean):string {
    let nodeMap: TreeNodeMap | undefined;
    let schema: z.ZodSchema<T> | undefined;
    if( isZodSchema(nodeMapOrSchema) ) {
        schema = nodeMapOrSchema;
    } else {
        nodeMap = nodeMapOrSchema;
    }
    if( !nodeMap ) {
        if( !schema ) throw new Error("Must supply TreeNodeMap or Schema");
        const result = convertSchemaToDotPropPathTree(schema);
        nodeMap = result.map;
    }

    if( !nodeMap[dotPropPath] ) {
        throw new Error(`Unknown dotPropPath. ${UNSAFE_WARNING}`);
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
    
    const zodKind = nodeMap[dotPropPath].kind;

    let jsonbPath:string = '';
    while(jsonbParts.length) {
        const part = jsonbParts.shift();
        if( !part ) {
            throw new Error(`Unknown part in dotPropPath. ${UNSAFE_WARNING}`);
        }
        jsonbPath += `${jsonbParts.length>0 || (jsonbParts.length===0 && ['ZodArray', 'ZodObject'].includes(zodKind))? '->' : '->>'}'${part}'`;
    }

    
    if( !castingMap[zodKind] ) throw new Error(`Unknown ZodKind Postgres cast: ${zodKind}. ${UNSAFE_WARNING}`);
    if( errorIfNotAsExpected && !errorIfNotAsExpected.includes(zodKind) ) throw new Error(`ZodKind Postgres cast was not as expected: ${zodKind}. Expected: ${errorIfNotAsExpected}. ${UNSAFE_WARNING}`);

    const cast = noCasting? '' : (castingMap[zodKind] ?? '');
    return `(${columnName}${jsonbPath})${cast}`
}