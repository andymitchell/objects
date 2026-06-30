/**
 * Public Zod schema-introspection surface — the single home for reading a schema's structure (its kind and
 * its children) without touching `_zod` internals at the call site. All brittle, version-pinned access lives
 * behind `src/zod` so every consumer (and every ICollection backing store) introspects a schema identically.
 *
 * `getSchemaChildren` is the deep traversal primitive: it answers "what are this node's structural children?"
 * for any kind, letting a consumer walk a whole schema while holding only its own policy (e.g. which kinds are
 * JSON-safe). The granular per-kind accessors that back it stay package-internal (imported from
 * `./introspection.ts`); this barrel keeps the external surface minimal.
 */

export { getZodKind, getSchemaChildren, getLiteralValues, getEnumValues } from "./introspection.ts";
export type { ZodKind, AnyZodSchema, SchemaChild, SchemaRelation } from "./introspection.ts";
