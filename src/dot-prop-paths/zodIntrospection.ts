import { z } from "zod";

/**
 * Every Zod kind — the lowercase discriminator zod stores on `def.type` (e.g. 'string', 'object', 'array').
 *
 * Derived from zod's own core type so it tracks the installed zod version exactly and can never drift;
 * it is the single source of truth that replaces v3's removed `ZodFirstPartyTypeKind`. Drives the
 * dot-prop walker's type-aware SQL casting and path validation.
 */
export type ZodKind = z.core.$ZodTypeDef["type"];

/**
 * A Zod schema of statically-unknown shape, as the walker sees it.
 *
 * The walker introspects arbitrary user schemas, so it cannot know their output type; `<any>` keeps the
 * schemas it returns assignable for callers without a cast at every site (v4's bare `z.ZodType` is
 * `<unknown>`, which would reject those assignments — `<any>` restores the permissiveness zod 3's
 * `ZodTypeAny` gave).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see JSDoc: walker handles schemas of unknown shape; <any> preserves v3 ZodTypeAny assignability for callers.
export type AnyZodSchema = z.ZodType<any>;

/**
 * Reads a schema's kind from zod's canonical `_zod.def.type`.
 *
 * The walker's single source of truth for "what is this schema?". Reading the def (rather than
 * `instanceof`) stays correct even when a bundle contains two copies of zod — distinct classes, but
 * identical `def.type` strings.
 *
 * @example getZodKind(z.string()) // 'string'
 */
export function getZodKind(schema: AnyZodSchema): ZodKind {
    return schema._zod.def.type;
}

/**
 * Steps through one transparent wrapper — optional/nullable/default/catch/readonly — to the schema
 * it wraps.
 *
 * These change a value's presence/default/mutability but not its structural shape, so the value's
 * real shape lives one level in. Every such wrapper stores it on `def.innerType`, so one read covers
 * them all (matching zod 3, which passed through any `_def.innerType` wrapper).
 *
 * @example unwrap(z.string().optional()) // z.string();  unwrap(z.string().default('x')) // z.string()
 */
export function unwrap(schema: AnyZodSchema): AnyZodSchema {
    return (schema._zod.def as z.core.$ZodTypeDef & { innerType: AnyZodSchema }).innerType;
}

/** The wrapper kinds {@link unwrap} steps through (each stores its inner schema on `def.innerType`). */
const TRANSPARENT_WRAPPER_KINDS: readonly ZodKind[] = ["optional", "nullable", "default", "catch", "readonly"];

/**
 * True for a wrapper kind the walker descends through to its inner schema (see {@link unwrap}).
 *
 * `optional`/`nullable` additionally mark a node optional; `default`/`catch`/`readonly` always yield
 * a present value, so callers must not treat them as optional.
 *
 * @example isTransparentWrapper("default") // true;  isTransparentWrapper("object") // false
 */
export function isTransparentWrapper(kind: ZodKind): boolean {
    return TRANSPARENT_WRAPPER_KINDS.includes(kind);
}

/**
 * The element schema of an array (`.element`).
 *
 * Lets the walker descend into `T[]` to type the element for jsonb/json array spreading.
 *
 * @example getArrayElement(z.array(z.string())) // z.string()
 */
export function getArrayElement(schema: AnyZodSchema): AnyZodSchema {
    return (schema as z.ZodArray).element as AnyZodSchema;
}

/**
 * The field map of an object (`.shape`).
 *
 * Refined objects expose it too (v4 dropped the `ZodEffects` wrapper), so the walker descends into a
 * `.refine()`d object's fields rather than treating it as an opaque leaf.
 *
 * @example getObjectShape(z.object({ a: z.string() })) // { a: z.string() }
 */
export function getObjectShape(schema: AnyZodSchema): Record<string, AnyZodSchema> {
    return (schema as z.ZodObject).shape as Record<string, AnyZodSchema>;
}

/**
 * The variant schemas of a union (`.options`).
 *
 * The walker emits one child subtree per variant (in `union_aware` mode) so polymorphic shapes stay distinct.
 *
 * @example getUnionOptions(z.union([z.string(), z.number()])) // [z.string(), z.number()]
 */
export function getUnionOptions(schema: AnyZodSchema): readonly AnyZodSchema[] {
    return (schema as z.ZodUnion).options as readonly AnyZodSchema[];
}

/**
 * True for a discriminated union.
 *
 * The walker keeps a DU as an opaque leaf; this guard is essential because in v4 a DU also passes
 * `instanceof z.ZodUnion`, so without it a DU would be wrongly descended as a plain union.
 */
export function isDiscriminatedUnion(schema: AnyZodSchema): boolean {
    return schema instanceof z.ZodDiscriminatedUnion;
}
