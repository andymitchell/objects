import { ZodTypeAny, z } from "zod";


type ZodKind = keyof typeof z.ZodFirstPartyTypeKind;
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



export function getZodKindAtSchemaDotPropPath(schema: ZodTypeAny, path: DotPropPath): ZodKind | undefined {
    const keys = path.split('.');
    let currentSchema: ZodTypeAny = schema;

    for (const key of keys) {
        // @ts-ignore
        if (currentSchema.shape) {
            // @ts-ignore
            currentSchema = currentSchema.shape[key];
        } else if (currentSchema._def.innerType) {
            // For schemas like arrays or nullable, where the type is wrapped.
            currentSchema = currentSchema._def.innerType;
        } else {
            return undefined; // Path is not valid for the given schema
        }

        if (!currentSchema) {
            return undefined; // Path is not valid or schema does not define this path
        }
    }

    return currentSchema._def.typeName;

}
