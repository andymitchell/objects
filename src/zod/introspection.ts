/**
 * Zod 4 structural introspection utilities.
 *
 * This module is the package's adapter from Zod schemas to structural data: schema kind,
 * tagged child edges, literal payloads, and object unknown-key policy. It exists so features
 * that need to walk schemas - dot-prop path discovery, SQL JSON-path casting, where-filter
 * validation, JSON-safety checks, and documentation tooling - can share one traversal model
 * instead of each depending on Zod internals.
 *
 * Zod does not expose one public child-traversal API for every schema kind. This file
 * centralizes the private `_zod.def` reads needed to normalize objects, arrays, records,
 * unions, intersections, tuples, wrappers, and lazy schemas into one consistent API. Pinned
 * tests catch Zod internal-shape changes in one place.
 *
 * Prefer `getSchemaChildren()` for recursive analysis. Use the granular helpers only when a
 * caller needs kind-specific behavior that the generic child relation cannot express.
 *
 * @example
 * const User = z.object({
 *   id: z.string(),
 *   tags: z.array(z.string().optional()),
 * }).strict();
 *
 * getZodKind(User); // "object"
 *
 * getSchemaChildren(User).map((child) => ({
 *   relation: child.relation,
 *   key: child.key,
 *   kind: getZodKind(child.schema),
 * }));
 * // [
 * //   { relation: "field", key: "id", kind: "string" },
 * //   { relation: "field", key: "tags", kind: "array" },
 * //   { relation: "catchall", key: undefined, kind: "never" },
 * // ]
 */
import { z } from "zod";

/**
 * Lowercase Zod 4 schema kind stored on `schema._zod.def.type`.
 *
 * Examples include `"object"`, `"array"`, `"optional"`, `"literal"`, and `"union"`.
 * The type is derived from the installed Zod package so compile-time coverage tracks the
 * dependency instead of a hand-maintained enum.
 */
export type ZodKind = z.core.$ZodTypeDef["type"];

/**
 * A schema whose parse input/output type is intentionally irrelevant.
 *
 * Introspection code walks user-provided schemas without caring what they parse to. `z.ZodType<any>`
 * preserves the old `ZodTypeAny` assignability that callers need when returning child schemas from
 * arbitrary positions in a tree.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see JSDoc: walker handles schemas of unknown shape; <any> preserves v3 ZodTypeAny assignability for callers.
export type AnyZodSchema = z.ZodType<any>;

/**
 * Return a schema's canonical Zod kind.
 *
 * Use this instead of `instanceof` or constructor names when branching on schema structure. The kind
 * string survives duplicate Zod copies in a bundle; class identity does not.
 *
 * @example
 * getZodKind(z.string()); // "string"
 * getZodKind(z.array(z.number())); // "array"
 */
export function getZodKind(schema: AnyZodSchema): ZodKind {
    return schema._zod.def.type;
}

/**
 * Return the inner schema stored by one transparent wrapper.
 *
 * Optional, nullable, default, catch, and readonly wrappers change presence, fallback, or mutability,
 * but not the value's structural shape. They all store the wrapped schema on `def.innerType`, so
 * walkers can step through them uniformly.
 *
 * @example
 * getZodKind(unwrap(z.string().optional())); // "string"
 * getZodKind(unwrap(z.string().default("x"))); // "string"
 */
export function unwrap(schema: AnyZodSchema): AnyZodSchema {
    return (schema._zod.def as z.core.$ZodTypeDef & { innerType: AnyZodSchema }).innerType;
}

/** Wrapper kinds that store their structural schema on `def.innerType`. */
const TRANSPARENT_WRAPPER_KINDS: readonly ZodKind[] = ["optional", "nullable", "default", "catch", "readonly"];

/**
 * Return whether a kind should be stepped through with {@link unwrap}.
 *
 * `optional` and `nullable` may also matter to the caller's policy. `default`, `catch`, and `readonly`
 * still wrap structure, but they do not by themselves mean the parsed value is absent.
 *
 * @example
 * isTransparentWrapper("default"); // true
 * isTransparentWrapper("object"); // false
 */
export function isTransparentWrapper(kind: ZodKind): boolean {
    return TRANSPARENT_WRAPPER_KINDS.includes(kind);
}

/**
 * Return the element schema of an array.
 *
 * Walkers use this to move from `T[]` to `T`, for example when validating paths inside JSON arrays
 * or deciding how an array element should be cast in SQL.
 *
 * @example
 * getZodKind(getArrayElement(z.array(z.string()))); // "string"
 */
export function getArrayElement(schema: AnyZodSchema): AnyZodSchema {
    return (schema as z.ZodArray).element as AnyZodSchema;
}

/**
 * Return the declared field map of an object schema.
 *
 * Refined Zod 4 objects still expose `.shape`, so callers can descend into `.refine()`d object fields
 * instead of treating the refined object as an opaque leaf.
 *
 * @example
 * const shape = getObjectShape(z.object({ a: z.string() }));
 * getZodKind(shape.a); // "string"
 */
export function getObjectShape(schema: AnyZodSchema): Record<string, AnyZodSchema> {
    return (schema as z.ZodObject).shape as Record<string, AnyZodSchema>;
}

/**
 * Return whether an object schema rejects unknown keys during parsing.
 *
 * This is true for `.strict()` and `z.strictObject()`, including when wrapped in transparent wrappers
 * such as `.optional()` or `.default()`. It is false for default strip objects, passthrough/loose
 * objects, `.catchall(...)`, and non-objects.
 *
 * Consumers should treat `true` as the only safe signal that an undeclared field cannot be present.
 * `false` is deliberately fail-open because a filter/path validator must not reject keys that a schema
 * may tolerate dynamically.
 *
 * Reads Zod's private `_zod.def.catchall`, where strict objects store a `never` catchall. A pinned unit
 * test guards this against the installed Zod version.
 *
 * @example
 * objectRejectsUnknownKeys(z.object({ id: z.string() }).strict()); // true
 * objectRejectsUnknownKeys(z.object({ id: z.string() })); // false
 * objectRejectsUnknownKeys(z.object({ id: z.string() }).catchall(z.number())); // false
 */
export function objectRejectsUnknownKeys(schema: AnyZodSchema): boolean {
    let s: AnyZodSchema | undefined = schema;
    while (s && isTransparentWrapper(getZodKind(s))) s = unwrap(s);
    if (!s || getZodKind(s) !== "object") return false;
    const catchall = (s._zod.def as z.core.$ZodTypeDef & { catchall?: AnyZodSchema }).catchall;
    return !!catchall && getZodKind(catchall) === "never";
}

/**
 * Return the option schemas of a union.
 *
 * Walkers use these as separate `variant` edges so polymorphic shapes can stay distinct instead of
 * being flattened into one object shape.
 *
 * @example
 * getUnionOptions(z.union([z.string(), z.number()])).map(getZodKind); // ["string", "number"]
 */
export function getUnionOptions(schema: AnyZodSchema): readonly AnyZodSchema[] {
    return (schema as z.ZodUnion).options as readonly AnyZodSchema[];
}

/**
 * Return whether a schema is a discriminated union.
 *
 * Some consumers keep discriminated unions opaque even though Zod 4 also exposes them as union-like
 * schemas. This guard lets those consumers choose that policy explicitly.
 */
export function isDiscriminatedUnion(schema: AnyZodSchema): boolean {
    return schema instanceof z.ZodDiscriminatedUnion;
}

/**
 * Return an object's catchall schema, if Zod stores one.
 *
 * `.catchall(x)` returns `x`, passthrough/loose objects return `unknown`, strict objects return `never`,
 * and default strip objects/non-objects return `undefined`. This lets walkers reason about undeclared
 * object keys, including whether their values are JSON-safe.
 *
 * Reads private `_zod.def.catchall`; pinned tests guard the installed Zod shape.
 *
 * @example
 * getZodKind(getCatchall(z.object({ a: z.string() }).catchall(z.bigint()))!); // "bigint"
 */
export function getCatchall(schema: AnyZodSchema): AnyZodSchema | undefined {
    return (schema._zod.def as z.core.$ZodTypeDef & { catchall?: AnyZodSchema }).catchall;
}

/**
 * Return the value schema of a record.
 *
 * Record keys are strings at runtime, so recursive analysis usually needs only the value type:
 * `Record<string, X>` contributes a child edge to `X`.
 *
 * Reads private `_zod.def.valueType`; pinned tests guard the installed Zod shape.
 *
 * @example
 * getZodKind(getRecordValueType(z.record(z.string(), z.bigint()))); // "bigint"
 */
export function getRecordValueType(schema: AnyZodSchema): AnyZodSchema {
    return (schema._zod.def as z.core.$ZodTypeDef & { valueType: AnyZodSchema }).valueType;
}

/**
 * Return the schema produced by a `z.lazy` thunk.
 *
 * This invokes private `_zod.def.getter()`. A self-referential lazy schema can return itself, so any
 * recursive caller must keep its own visited set or depth guard.
 *
 * @example
 * getZodKind(getLazyInner(z.lazy(() => z.string()))); // "string"
 */
export function getLazyInner(schema: AnyZodSchema): AnyZodSchema {
    return (schema._zod.def as z.core.$ZodTypeDef & { getter: () => AnyZodSchema }).getter();
}

/**
 * Return the left and right schemas of an intersection.
 *
 * Walkers use both arms as `intersection` child edges so each side can contribute its own reachable
 * fields or unsupported value kinds.
 *
 * Reads private `_zod.def.left` and `_zod.def.right`; pinned tests guard the installed Zod shape.
 *
 * @example
 * const { left, right } = getIntersectionParts(
 *   z.object({ a: z.string() }).and(z.object({ b: z.number() }))
 * );
 * getObjectShape(left).a; // z.string()
 * getObjectShape(right).b; // z.number()
 */
export function getIntersectionParts(schema: AnyZodSchema): { left: AnyZodSchema; right: AnyZodSchema } {
    const def = schema._zod.def as z.core.$ZodTypeDef & { left: AnyZodSchema; right: AnyZodSchema };
    return { left: def.left, right: def.right };
}

/**
 * Return the raw values accepted by a literal schema.
 *
 * Literal kind alone is not enough for JSON-safety checks: `z.literal(5n)` and `z.literal("ok")`
 * are both kind `"literal"`, but only one can round-trip through JSON. Use this helper when the
 * literal payload matters.
 *
 * Reads private `_zod.def.values`; pinned tests guard the installed Zod shape.
 *
 * @example
 * getLiteralValues(z.literal("ok")); // ["ok"]
 * getLiteralValues(z.literal(5n)); // [5n]
 */
export function getLiteralValues(schema: AnyZodSchema): readonly unknown[] {
    return (schema._zod.def as z.core.$ZodTypeDef & { values: readonly unknown[] }).values;
}

/**
 * Return the values a Zod enum accepts, by their runtime type.
 *
 * Enum kind alone is not enough to know a member's scalar type: a native (TS) numeric enum stores a reverse mapping
 * on `_zod.def.entries` (`{ 0: 'A', A: 0 }`), so reading the entry values directly would surface the member-name
 * strings as well as the numbers. This filters the candidate entry values by what the schema actually parses, so a
 * numeric enum returns its numbers, a string enum its strings, and a mixed enum both. Use when an enum member's
 * runtime TYPE matters (e.g. deciding a column's scalar kind), not just that the field is an enum.
 *
 * Reads private `_zod.def.entries`; pinned tests guard the installed Zod shape.
 *
 * @example
 * getEnumValues(z.enum(["a", "b"])); // ["a", "b"]
 * // enum NumE { A = 0, B = 1 }
 * getEnumValues(z.enum(NumE)); // [0, 1]
 */
export function getEnumValues(schema: AnyZodSchema): readonly unknown[] {
    const entries = (schema._zod.def as z.core.$ZodTypeDef & { entries?: Record<string, unknown> }).entries ?? {};
    const candidates = [...new Set(Object.values(entries))];
    return candidates.filter((v) => schema.safeParse(v).success);
}

/**
 * Return the fixed item schemas and optional rest schema of a tuple.
 *
 * Fixed tuple positions become keyed `item` edges; the rest schema becomes an `element` edge.
 * Reads private `_zod.def.items` and `_zod.def.rest`; pinned tests guard the installed Zod shape.
 */
function getTupleParts(schema: AnyZodSchema): { items: readonly AnyZodSchema[]; rest: AnyZodSchema | undefined } {
    const def = schema._zod.def as z.core.$ZodTypeDef & { items?: readonly AnyZodSchema[]; rest?: AnyZodSchema | null };
    return { items: def.items ?? [], rest: def.rest ?? undefined };
}

/**
 * How a child schema attaches to its parent.
 *
 * Relations are edge types for schema walkers: `field` is an object property, `element` is an
 * array element or tuple rest, `value` is a record value, `variant` is a union option,
 * `intersection` is one intersection arm, `catchall` is an object's unknown-key schema,
 * `wrapped` is an inner schema behind a transparent wrapper or lazy schema, and `item` is a
 * fixed tuple slot.
 */
export type SchemaRelation = "field" | "element" | "value" | "variant" | "intersection" | "catchall" | "wrapped" | "item";

/**
 * One tagged edge from a parent schema to a direct child schema.
 *
 * `key` is present only when the relation has a stable local key: object fields use their property
 * name and tuple items use their numeric index. All other relation kinds attach namelessly to their
 * parent.
 */
export interface SchemaChild {
    relation: SchemaRelation;
    /** Object field name (`field`) or tuple index (`item`). */
    key?: string | number;
    schema: AnyZodSchema;
}

/**
 * Expand one schema node into the structural schemas directly below it.
 *
 * This is the primitive that makes recursive schema analysis practical. Zod stores child schemas
 * differently for each kind: object fields live on `.shape`, arrays on `.element`, unions on
 * `.options`, records on `valueType`, intersections on `left`/`right`, wrappers on `innerType`,
 * and lazy schemas behind a getter. A walker that duplicated that branching would be brittle and
 * easy to make inconsistent with other walkers.
 *
 * `getSchemaChildren` normalizes those per-kind shapes into a list of tagged edges. The caller can
 * then write one traversal loop and keep only its own policy: path rendering, SQL casting,
 * JSON-safety checks, strict-object validation, union handling, recursion limits, or documentation
 * generation.
 *
 * The returned `relation` explains how the child attaches to its parent. For example, `field`
 * appends an object key to a path, `element` crosses into an array or tuple rest element, `variant`
 * enters one union option, `catchall` describes undeclared object keys, and `wrapped` steps through
 * transparent wrappers or lazy schemas.
 *
 * This function is intentionally one level deep. Callers that recurse through `lazy` schemas must
 * keep their own visited set because a self-referential lazy schema can return itself.
 *
 * Leaves and opaque/value-transforming schemas such as strings, numbers, literals, transforms,
 * pipes, and custom schemas return `[]`.
 *
 * @example
 * function walk(schema: AnyZodSchema): void {
 *   visit(schema);
 *   for (const child of getSchemaChildren(schema)) walk(child.schema);
 * }
 *
 * @example
 * getSchemaChildren(z.object({ name: z.string() }));
 * // [{ relation: "field", key: "name", schema: z.string() }]
 *
 * @example
 * getSchemaChildren(z.tuple([z.string()]).rest(z.number()));
 * // [
 * //   { relation: "item", key: 0, schema: z.string() },
 * //   { relation: "element", schema: z.number() },
 * // ]
 */
export function getSchemaChildren(schema: AnyZodSchema): SchemaChild[] {
    const kind = getZodKind(schema);
    switch (kind) {
        case "object": {
            const out: SchemaChild[] = [];
            const shape = getObjectShape(schema);
            for (const key of Object.keys(shape)) out.push({ relation: "field", key, schema: shape[key]! });
            const catchall = getCatchall(schema);
            if (catchall) out.push({ relation: "catchall", schema: catchall });
            return out;
        }
        case "array":
            return [{ relation: "element", schema: getArrayElement(schema) }];
        case "record":
            return [{ relation: "value", schema: getRecordValueType(schema) }];
        case "union": // a discriminated union is also kind 'union' and exposes the same `.options`
            return getUnionOptions(schema).map((s) => ({ relation: "variant", schema: s }));
        case "intersection": {
            const { left, right } = getIntersectionParts(schema);
            return [{ relation: "intersection", schema: left }, { relation: "intersection", schema: right }];
        }
        case "tuple": {
            const { items, rest } = getTupleParts(schema);
            const out: SchemaChild[] = items.map((s, i) => ({ relation: "item", key: i, schema: s }));
            if (rest) out.push({ relation: "element", schema: rest });
            return out;
        }
        case "lazy":
            return [{ relation: "wrapped", schema: getLazyInner(schema) }];
        default:
            // optional/nullable/default/catch/readonly pass through to their inner; everything else is a leaf.
            return isTransparentWrapper(kind) ? [{ relation: "wrapped", schema: unwrap(schema) }] : [];
    }
}
