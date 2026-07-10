import type { AnyZodSchema, ZodKind } from "../zod/introspection.ts";

/**
 * How a path's leaf was found in the schema.
 *
 * `enumerated` — every segment is a declared key, so the path has a node in the schema's path map.
 * `record_value` — one or more segments are dynamic keys of a `z.record`, which no path map can list;
 *   the leaf was found by descending the record's value schema.
 * `unknown` — the schema does not describe this path.
 */
export type PathOrigin = 'enumerated' | 'record_value' | 'unknown';

type ResolvedPathCommon = {
    /** The path as the schema's flat path map keys it: the decoded segments rejoined with `.`. */
    readonly lookupPath: string;
    /** The decoded key segments. An escaped dot (`a\.b`) yields ONE segment holding a literal dot. */
    readonly segments: readonly string[];
    /** How many arrays the path crosses, counting a leaf that is itself an array. `0` for an unknown path. */
    readonly arrayDepth: number;
};

/**
 * Everything an engine needs to know about one dot-prop path against one schema.
 *
 * `known` discriminates: a known path has a leaf type, an unknown one does not. Read `known` rather than
 * testing the path against a schema's path map — a record's dynamic keys are absent from that map yet
 * resolve perfectly well, and treating them as absent silently reclassifies a present field as a missing one.
 */
export type ResolvedPath =
    | (ResolvedPathCommon & {
        readonly known: true;
        readonly origin: 'enumerated' | 'record_value';
        /** The leaf's Zod kind, with transparent wrappers (optional/nullable/default/catch/readonly) stepped through. */
        readonly leafKind: ZodKind;
        /** The leaf's Zod schema, absent when the path map was built without schema references. */
        readonly leafSchema: AnyZodSchema | undefined;
    })
    | (ResolvedPathCommon & {
        readonly known: false;
        readonly origin: 'unknown';
        readonly leafKind: undefined;
        readonly leafSchema: undefined;
    });

/** A path that cannot be resolved against any schema, because it is not a well-formed dot-prop path. */
export type ResolvePathError = {
    readonly type: 'invalid_path';
    readonly dotPropPath: string;
    readonly message: string;
};

/** Resolving a path either describes its leaf (including "no such leaf") or refuses the path itself. */
export type ResolvePathResult =
    | { readonly success: true; readonly resolved: ResolvedPath }
    | { readonly success: false; readonly error: ResolvePathError };
