import { ZodTypeAny, z } from "zod";


export type ZodKind = keyof typeof z.ZodFirstPartyTypeKind;
type DotPropPath = string;
type DotPropPathsZodKind = Record<DotPropPath, ZodKind>; // e.g. {'person.age': 'ZodNumber'}


type WhitelistTypes<T extends ZodKind[] = ZodKind[]> = T[number];

/**
 * 
 * @param schema The source schema 
 * @param whitelistTypes Optional shortlist of allowed types (dot prop paths not of this type are excluded)
 * @returns A record of every dot prop path permutation in the schema, where the value is its kind. {'person.age': 'ZodNumber'}
 */
export function convertSchemaToDotPropPathKind<T extends ZodKind[] = ZodKind[]>(
    schema: ZodTypeAny,
    whitelistTypes: T = Object.keys(z.ZodFirstPartyTypeKind) as T// ZodKind[] = Object.keys(z.ZodFirstPartyTypeKind) as ZodKind[],
): Record<DotPropPath, WhitelistTypes<T>> {
    return _convertSchemaToDotPropPathKind(schema, whitelistTypes);
}
function _convertSchemaToDotPropPathKind(
    schema: ZodTypeAny,
    whitelistTypes: ZodKind[] = Object.keys(z.ZodFirstPartyTypeKind) as ZodKind[],
    basePath = ''
) {
    const paths: Record<string, ZodKind> = {};

    if (schema._def.typeName === 'ZodObject') {
        // @ts-ignore
        for (const key in schema.shape) {
            // @ts-ignore
            const subSchema: ZodTypeAny = schema.shape[key];
            const path = basePath ? `${basePath}.${key}` : key;

            if (subSchema._def.typeName === 'ZodObject') {

                Object.assign(paths, _convertSchemaToDotPropPathKind(subSchema, whitelistTypes, path));

            } else if (whitelistTypes.includes(subSchema._def.typeName as ZodKind)) {

                paths[path] = subSchema._def.typeName as ZodKind;
            }
        }
    }

    return paths;
}


export type TreeNode = {
    name: string,
    dotprop_path: string,
    kind: ZodKind,
    children: TreeNode[],
    schema?: z.ZodSchema,
    nameless_array_element?: boolean,
    parent?: TreeNode,
    descended_from_array?: boolean,
    optional_or_nullable?: boolean
}
export type TreeNodeMap = Record<DotPropPath, TreeNode>;
type ConvertSchemaToDotPropPathTreeOptions = {
    exclude_schema_reference?: boolean,
    exclude_parent_reference?: boolean
}
export function convertSchemaToDotPropPathTree(
    schema: ZodTypeAny,
    options?: ConvertSchemaToDotPropPathTreeOptions
): {root: TreeNode, map: TreeNodeMap} {
    const map = {};
    const root = _convertSchemaToDotPropPathTree('', schema, map, options);
    return {root, map};
}
function _convertSchemaToDotPropPathTree(
    key: string, 
    schema: ZodTypeAny,
    map: TreeNodeMap,
    options?: ConvertSchemaToDotPropPathTreeOptions,
    parent?: TreeNode,
    parentsIncludeArray?: boolean,
    optionalOrNullable?: boolean
):TreeNode {
   
    let node:TreeNode;
    const dotprop_path = (parent?.dotprop_path && key? `${parent?.dotprop_path}.${key}` : (key? key : parent?.dotprop_path)) ?? '';
    function addNode(newNode:TreeNode) {
        if( !options?.exclude_schema_reference ) newNode.schema = schema;
        if( !options?.exclude_parent_reference ) newNode.parent = parent;
        if( parentsIncludeArray) newNode.descended_from_array = true;
        if( optionalOrNullable ) newNode.optional_or_nullable = true;
        if( parent ) {
            parent.children.push(newNode);
        }
        if( map[newNode.dotprop_path] ) {
            // Already exists, so this must be an array element (which is nameless)
            if( parent?.kind!=='ZodArray' ) {
                throw new Error("Duplicate dotprop_path that is not in an array");
            }
            newNode.nameless_array_element = true;
        } else {
            map[node.dotprop_path] = newNode;
        }
    }

    if( schema instanceof z.ZodArray ) {
        node = {
            name: key, 
            dotprop_path,
            kind: schema._def.typeName, // ZodArray,
            children: []
        }

        addNode(node);

        // It'll be a nameless child on an array
        parentsIncludeArray = true;
        _convertSchemaToDotPropPathTree('', schema.element, map, options, node, parentsIncludeArray);
        
    } else if( schema instanceof z.ZodObject ) {
        node = {
            name: key, 
            dotprop_path,
            kind: schema._def.typeName, // ZodObject,
            children: []
        }
        addNode(node);

        for( const childKey in schema.shape ) {
            const childSchema = schema.shape[childKey];
            _convertSchemaToDotPropPathTree(childKey, childSchema, map, options, node, parentsIncludeArray);
        }
    } else if( schema instanceof z.ZodUnion ) {
        // Give the parent more children (pass through)
        const unionSchemas = schema._def.options as z.ZodSchema[];
        for( const unionSchema of unionSchemas ) {
            _convertSchemaToDotPropPathTree(key, unionSchema, map, options, parent, parentsIncludeArray);
        }
        node = parent!;

    } else if( schema._def.innerType ) {
        // Probably ZodOptional or ZodNullable - pass through it
        const optionalOrNullable = schema instanceof z.ZodOptional || schema instanceof z.ZodNullable;
        node = _convertSchemaToDotPropPathTree(key, schema._def.innerType, map, options, parent, parentsIncludeArray, optionalOrNullable);
    } else {
        // Presume leaf 
        node = {
            name: key, 
            dotprop_path,
            kind: schema._def.typeName,
            children: []
        }
        addNode(node);
    }

    return node;
    
}


export function getZodKindAtSchemaDotPropPath(schema: ZodTypeAny, path: DotPropPath): ZodKind | undefined {

    const schemaAtPath = getZodSchemaAtSchemaDotPropPath(schema, path);
    return schemaAtPath?._def.typeName;


}


export function getZodSchemaAtSchemaDotPropPath(schema: ZodTypeAny, path: DotPropPath): ZodTypeAny | undefined {
    const keys = path.split('.');
    let currentSchema: ZodTypeAny = schema;

    for (const key of keys) {
        while( currentSchema instanceof z.ZodArray || currentSchema._def.innerType ) {
            // Step into it
            if( currentSchema instanceof z.ZodArray ) {
                currentSchema = currentSchema.element;
            } else if( currentSchema._def.innerType ) {
                // Schemas like z.ZodOptional and z.Nullable wrap the type
                currentSchema = currentSchema._def.innerType;
            }
        }

        // @ts-ignore
        if (currentSchema.shape) {
            // @ts-ignore
            currentSchema = currentSchema.shape[key];
        } else {
            return undefined; // Path is not valid for the given schema
        }

        if (!currentSchema) {
            return undefined; // Path is not valid or schema does not define this path
        }
    }

    if( currentSchema instanceof z.ZodOptional ) currentSchema = currentSchema._def.innerType;
    if( currentSchema instanceof z.ZodArray ) currentSchema = currentSchema.element;

    return currentSchema;

}

