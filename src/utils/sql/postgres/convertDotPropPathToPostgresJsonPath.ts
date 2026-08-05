import { z } from "zod";
import { type TreeNodeMap, type ZodKind, convertSchemaToDotPropPathTree } from "../../../dot-prop-paths/schema-tree.ts";
import { isUnspreadableRecordPath, resolvePath } from "../../../dot-prop-paths/resolvePath.ts";
import { getEnumValues, type AnyZodSchema } from "../../../zod/introspection.ts";
import { isZodSchema } from "../../isZodSchema.ts";
import type { DotPropPathConversionResult, SortValueKind } from "../types.ts";
import { pgJsonbAccessor } from "./pgJsonbAccessor.ts";
import { withCodePointCollation } from "./pgCodePointCollation.ts";

export const UNSAFE_WARNING = "It's unsafe to generate a SQL identifier for this.";

/** A structural leaf must stay jsonb to be compared; a scalar leaf is read as text so it can be cast. */
const STRUCTURAL_KINDS: readonly ZodKind[] = ['array', 'object'];

/**
 * Converts a dot-prop path into a type-cast Postgres JSONB accessor expression.
 *
 * The path is resolved against the schema first, so only a field the schema describes produces an
 * expression, and the leaf's kind decides both the final operator (`->` for jsonb, `->>` for text) and the
 * cast. Each key is quoted, which makes a key that carries a quote or a comment marker inert data.
 *
 * A text leaf is additionally pinned with `COLLATE "C"`, so it compares and orders by code point on any
 * database, whatever its default locale. This is the same guarantee `compareValues` gives in JS, and it
 * is applied here rather than at each call site so that a filter, a sort, and a keyset predicate on one
 * key all render the same text — which is also what lets a single expression index serve all three.
 *
 * @param columnName - The jsonb column the path is read out of.
 * @param dotPropPath - The path, e.g. `'contact.name'`.
 * @param nodeMapOrSchema - The schema describing the stored object, or a pre-built path tree.
 * @param errorIfNotAsExpected - When given, a leaf whose kind is outside this list is refused (`unexpected_kind`).
 * @param noCasting - Drops the type cast from the emitted expression, and with it the collation pin, which
 *   only a genuine text expression can carry. The reported `kind` still reflects the cast the leaf orders by.
 * @returns `{ success: true, expression, kind? }`, or `{ success: false, error }`. Never throws.
 *
 * @example
 * convertDotPropPathToPostgresJsonPath('data', 'contact.name', nodeMap)
 * // → { success: true, expression: `(data->E'contact'->>E'name')::text COLLATE "C"`, kind: 'text' }
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

    const result = resolvePath(dotPropPath, nodeMap);
    if( !result.success ) {
        return { success: false, error: { type: 'invalid_path', dotPropPath, message: `Invalid dotPropPath. ${UNSAFE_WARNING}` } };
    }
    const resolved = result.resolved;
    if( !resolved.known ) {
        return { success: false, error: { type: 'unknown_path', dotPropPath, message: `Unknown dotPropPath. ${UNSAFE_WARNING}` } };
    }
    if( isUnspreadableRecordPath(resolved) ) {
        return { success: false, error: { type: 'unsupported_kind', dotPropPath, message: `A dotPropPath that crosses an array beneath a record key cannot be addressed. ${UNSAFE_WARNING}` } };
    }

    const castingMap:Partial<Record<ZodKind, string>> = {
        'string': '::text',
        'number': '::numeric',
        'boolean': '::boolean',
        'bigint': '::bigint',
        'object': '::jsonb',
        'array': '::jsonb',
        'null': '',
    }

    const zodKind = resolved.leafKind;

    // An enum has no fixed cast entry — its column type is the scalar kind its members share — so resolve it from
    // the schema (single-kind enums only: a mixed-scalar enum is routed to the raw-JSONB comparison path upstream
    // by findMultiScalarUnionPaths and never reaches here). Every other kind keeps its direct map entry, including
    // the existing treatment of an empty/unmapped cast as an unsupported kind.
    const mappedCast = zodKind === 'enum' ? enumScalarCast(resolved.leafSchema) : castingMap[zodKind];

    if( !mappedCast ) return { success: false, error: { type: 'unsupported_kind', dotPropPath, message: `Unknown ZodKind Postgres cast: ${zodKind}. ${UNSAFE_WARNING}` } };
    if( errorIfNotAsExpected && !errorIfNotAsExpected.includes(zodKind) ) return { success: false, error: { type: 'unexpected_kind', dotPropPath, message: `ZodKind Postgres cast was not as expected: ${zodKind}. Expected: ${errorIfNotAsExpected}. ${UNSAFE_WARNING}` } };

    const accessor = pgJsonbAccessor(columnName, resolved.segments, { asText: !STRUCTURAL_KINDS.includes(zodKind) });
    const cast = noCasting? '' : mappedCast;
    // Surface the comparison family so the sort/cursor builders bind boundary values correctly.
    // Derived from the cast the leaf actually orders by (which stands even when `noCasting` drops
    // it from the emitted expression).
    const kind = sortValueKindFromPgCast(mappedCast);
    // Only a genuine text expression can carry the pin: without the cast the accessor's type is not
    // guaranteed collatable. Non-text kinds compare identically under any collation.
    const expression = kind === 'text' && !noCasting
        ? withCodePointCollation(`${accessor}${cast}`)
        : `${accessor}${cast}`;
    return kind === undefined ? { success: true, expression } : { success: true, expression, kind };
}

/**
 * Maps a Postgres cast to the {@link SortValueKind} it produces. Structural (`::jsonb`) and
 * cast-less leaves have no scalar family and yield `undefined`, so their boundary values bind raw.
 */
function sortValueKindFromPgCast(cast: string | undefined): SortValueKind | undefined {
    switch (cast) {
        case '::text': return 'text';
        case '::numeric': return 'numeric';
        case '::boolean': return 'boolean';
        case '::bigint': return 'bigint';
        default: return undefined;
    }
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
 * @param schema the enum's Zod schema, taken from the path's resolved leaf (`undefined` when the tree was built
 * without schema references).
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
