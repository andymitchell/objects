import { z } from "zod";
import {
    getZodKind,
    unwrap,
    getArrayElement,
    getObjectShape,
    getUnionOptions,
    isDiscriminatedUnion,
    type ZodKind,
} from "./zodIntrospection.ts";

// Re-exported so SQL builders can name expected kinds without reaching into the introspection layer.
export type { ZodKind };
type DotPropPath = string;


/**
 * A node in the schema tree produced by convertSchemaToDotPropPathTree.
 * Captures the Zod kind, parent/child links, and metadata (array ancestry, optionality)
 * needed by the SQL builder for type casting, array spreading, and null guards.
 */
export type TreeNode = {
    name: string,
    dotprop_path: string,
    kind: ZodKind,
    children: TreeNode[],
    schema?: z.ZodType,
    nameless_array_element?: boolean,
    parent?: TreeNode,
    descended_from_array?: boolean,
    optional_or_nullable?: boolean,
    /** True when this node is one variant of a union parent. */
    union_variant?: boolean
}
export const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    dotprop_path: z.string(),
    kind: z.any() as z.ZodType<ZodKind>,
    children: z.array(TreeNodeSchema),
    schema: z.any().optional(), // holds a Zod schema instance at runtime
    nameless_array_element: z.boolean().optional(),
    parent: TreeNodeSchema.optional(),
    descended_from_array: z.boolean().optional(),
    optional_or_nullable: z.boolean().optional(),
    union_variant: z.boolean().optional(),
  })
);

/** Flat lookup from dot-prop path string to its TreeNode. The primary interface used by the SQL builder. */
export type TreeNodeMap = Record<DotPropPath, TreeNode>;
type ConvertSchemaToDotPropPathTreeOptions = {
    exclude_schema_reference?: boolean,
    exclude_parent_reference?: boolean,
    /**
     * Represent each `z.union` as a dedicated union node whose children are one complete subtree per
     * variant. When absent, a union's variants are flattened into its parent, which collapses a
     * union of objects into indistinguishable same-named siblings and throws if two variants
     * register the same dot-prop path. Enable it for a faithful, serialisable tree of a
     * polymorphic schema.
     */
    union_aware?: boolean
}
/**
 * Recursively walks a Zod schema and produces a TreeNode tree plus a flat TreeNodeMap.
 * The map is the key input to the SQL builder: it provides the kind (for casting), array ancestry
 * (for jsonb_array_elements spreading), optionality (for IS NOT NULL guards), and sub-schemas
 * (for recursing into array element types).
 *
 * A `z.union` is flattened into its parent unless the `union_aware` option is set, which
 * represents the union as a dedicated union node with one child subtree per variant. A
 * discriminated union is always an opaque leaf — its variants are not expanded.
 *
 * @example
 * const { root, map } = convertSchemaToDotPropPathTree(ContactSchema);
 * map['contact.name'].kind // 'string'
 */
export function convertSchemaToDotPropPathTree(
    schema: z.ZodType,
    options?: ConvertSchemaToDotPropPathTreeOptions
): {root: TreeNode, map: TreeNodeMap} {
    const map = {};
    const root = _convertSchemaToDotPropPathTree('', schema, map, options);
    return {root, map};
}
function _convertSchemaToDotPropPathTree(
    key: string,
    schema: z.ZodType,
    map: TreeNodeMap,
    options?: ConvertSchemaToDotPropPathTreeOptions,
    parent?: TreeNode,
    parentsIncludeArray?: boolean,
    optionalOrNullable?: boolean,
    withinUnion?: boolean
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
            // Sibling nodes legitimately share a dot-prop path in two cases: array elements (one
            // per element type) and union variants (one subtree per variant, plus any fields the
            // variants have in common). The flat map keeps the first node at a shared path; the
            // tree retains every sibling. Any other collision throws.
            if( parent?.kind==='array' ) {
                newNode.nameless_array_element = true;
            } else if( parent?.kind==='union' ) {
                newNode.union_variant = true;
            } else if( !withinUnion ) {
                throw new Error("Duplicate dotprop_path that is not in an array");
            }
        } else {
            map[newNode.dotprop_path] = newNode;
        }
    }

    const kind = getZodKind(schema);

    if( kind==='array' ) {
        node = {
            name: key,
            dotprop_path,
            kind,
            children: []
        }

        addNode(node);

        // It'll be a nameless child on an array
        parentsIncludeArray = true;
        _convertSchemaToDotPropPathTree('', getArrayElement(schema), map, options, node, parentsIncludeArray, undefined, withinUnion);

    } else if( kind==='object' ) {
        // Refined objects reach here too (v4 has no ZodEffects wrapper) and descend into their fields.
        node = {
            name: key,
            dotprop_path,
            kind,
            children: []
        }
        addNode(node);

        const shape = getObjectShape(schema);
        for( const childKey in shape ) {
            const childSchema = shape[childKey]!;
            _convertSchemaToDotPropPathTree(childKey, childSchema, map, options, node, parentsIncludeArray, undefined, withinUnion);
        }
    } else if( kind==='union' && isDiscriminatedUnion(schema) ) {
        // A discriminated union stays an opaque leaf: its variants are not expanded. This guard runs
        // before the plain-union branch because in v4 a DU also satisfies `instanceof z.ZodUnion`.
        node = {
            name: key,
            dotprop_path,
            kind,
            children: []
        }
        addNode(node);
    } else if( kind==='union' ) {
        const unionSchemas = getUnionOptions(schema);
        if( options?.union_aware ) {
            // A union node holds one child subtree per variant. Variants are nameless and share
            // this node's dot-prop path, mirroring how element types attach to an array node.
            node = {
                name: key,
                dotprop_path,
                kind,
                children: []
            }
            addNode(node);
            for( const unionSchema of unionSchemas ) {
                _convertSchemaToDotPropPathTree('', unionSchema, map, options, node, parentsIncludeArray, undefined, true);
            }
        } else {
            // The variants pass through as direct children of the union's parent.
            for( const unionSchema of unionSchemas ) {
                _convertSchemaToDotPropPathTree(key, unionSchema, map, options, parent, parentsIncludeArray, undefined, withinUnion);
            }
            node = parent!;
        }

    } else if( kind==='optional' || kind==='nullable' ) {
        // Pass through the wrapper; the value's real shape is one level in.
        node = _convertSchemaToDotPropPathTree(key, unwrap(schema), map, options, parent, parentsIncludeArray, true, withinUnion);
    } else {
        // Presume leaf
        node = {
            name: key,
            dotprop_path,
            kind,
            children: []
        }
        addNode(node);
    }

    return node;

}


/** Returns the ZodKind at a dot-prop path within a schema, unwrapping arrays/optionals. */
export function getZodKindAtSchemaDotPropPath(schema: z.ZodType, path: DotPropPath): ZodKind | undefined {
    const schemaAtPath = getZodSchemaAtSchemaDotPropPath(schema, path);
    return schemaAtPath ? getZodKind(schemaAtPath) : undefined;
}


/** Navigates a Zod schema by dot-prop path and returns the leaf schema, unwrapping arrays/optionals/nullables along the way. */
export function getZodSchemaAtSchemaDotPropPath(schema: z.ZodType, path: DotPropPath): z.ZodType | undefined {
    const keys = path.split('.');
    let currentSchema: z.ZodType = schema;

    for (const key of keys) {
        // Step through array/optional/nullable wrappers to reach the object that owns the next key.
        while( true ) {
            const currentKind = getZodKind(currentSchema);
            if( currentKind==='array' ) {
                currentSchema = getArrayElement(currentSchema);
            } else if( currentKind==='optional' || currentKind==='nullable' ) {
                currentSchema = unwrap(currentSchema);
            } else {
                break;
            }
        }

        if (getZodKind(currentSchema)==='object') {
            currentSchema = getObjectShape(currentSchema)[key]!;
        } else {
            return undefined; // Path is not valid for the given schema
        }

        if (!currentSchema) {
            return undefined; // Path is not valid or schema does not define this path
        }
    }


    // A trailing optional unwraps to its inner type; a trailing array resolves to its element (so the
    // returned schema validates a single element). A trailing nullable is kept so it still accepts null.
    if( getZodKind(currentSchema)==='optional' ) currentSchema = unwrap(currentSchema);
    if( getZodKind(currentSchema)==='array' ) currentSchema = getArrayElement(currentSchema);

    return currentSchema;

}
