import { z } from "zod";
import { getZodSchemaAtSchemaDotPropPath } from "../dot-prop-paths/schema-tree.ts";
import type { AnyZodSchema } from "../zod/introspection.ts";

/**
 * Why a scope cannot be written through:
 * - `disallowed_segment`: a dot-segment is `__proto__`, `prototype` or `constructor`.
 * - `unknown_path`: the schema declares no field at the path.
 * - `not_an_object_array`: the path resolves, but not to an array of objects.
 */
export type ArrayScopeRejectionReason = 'disallowed_segment' | 'unknown_path' | 'not_an_object_array';

/**
 * Outcome of {@link resolveArrayScope}: either the schema for one element of the scoped array,
 * or the reason the scope can never be a valid write target.
 */
export type ArrayScopeResolution =
    | { ok: true; elementSchema: AnyZodSchema }
    | { ok: false; reason: ArrayScopeRejectionReason };

const DISALLOWED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Decides whether an `array_scope` write can target `scope`, returning the element schema if so
 * and a rejection reason if not.
 *
 * An `array_scope` payload redirects a write into an array of objects nested inside each matched
 * item (e.g. `scope: 'children'`). That only works when the path names a declared field whose value
 * is an array of objects — anything else can never be written through, so it must be rejected as a
 * value rather than discovered by a crash mid-write. This is the single source of truth for that
 * predicate: the payload-schema gate and the write engine both call it, so they accept and reject
 * identical scopes.
 *
 * @param schema The schema of one top-level item the write action runs against.
 * @param scope Dot-prop path from the item's root to the array being written into (e.g. `'children.items'`).
 * @returns `{ ok: true, elementSchema }` where `elementSchema` validates ONE element of the scoped
 * array; otherwise `{ ok: false, reason }` — see {@link ArrayScopeRejectionReason}.
 *
 * @example
 * resolveArrayScope(schema, 'children');        // { ok: true, elementSchema: <child schema> }
 * resolveArrayScope(schema, 'constructor');     // { ok: false, reason: 'disallowed_segment' }
 * resolveArrayScope(schema, 'profile');         // { ok: false, reason: 'not_an_object_array' }
 *
 * @remarks
 * `__proto__`, `prototype` and `constructor` are rejected even when the schema genuinely declares
 * such a field: the runtime property reader refuses to traverse those three segments (guarding
 * object graphs against prototype-chain walks), so a write through them could never reach the data.
 * Other inherited names carry no such restriction — a declared `toString` field is a perfectly
 * writable scope, while an undeclared one is simply an `unknown_path`.
 *
 * A trailing optional wrapper is transparent (`z.array(...).optional()` is accepted), but a trailing
 * nullable/default/catch wrapper is not: the schema walker keeps those wrappers on the leaf, so the
 * engine's scoped element schema would be the wrapper itself and could never validate an element.
 */
export function resolveArrayScope(schema: AnyZodSchema, scope: string): ArrayScopeResolution {
    if (scope.split('.').some(segment => DISALLOWED_SEGMENTS.has(segment))) {
        return { ok: false, reason: 'disallowed_segment' };
    }

    const wholeAtPath = getZodSchemaAtSchemaDotPropPath(schema, scope, { unwrapTrailingArray: false });
    if (!wholeAtPath) {
        return { ok: false, reason: 'unknown_path' };
    }
    if (!(wholeAtPath instanceof z.ZodArray)) {
        return { ok: false, reason: 'not_an_object_array' };
    }

    const elementSchema = getZodSchemaAtSchemaDotPropPath(schema, scope);
    if (!(elementSchema instanceof z.ZodObject)) {
        return { ok: false, reason: 'not_an_object_array' };
    }

    return { ok: true, elementSchema };
}
