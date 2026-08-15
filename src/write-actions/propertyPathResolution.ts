import { z } from "zod";
import { parseDotPropPathSegments } from "../dot-prop-paths/dotPropPathSegments.ts";
import {
    getCatchall,
    getIntersectionParts,
    getLazyInner,
    getObjectShape,
    getRecordKeyType,
    getRecordValueType,
    getUnionOptions,
    getZodKind,
    isTransparentWrapper,
    unwrap,
    type AnyZodSchema,
} from "../zod/introspection.ts";

/** The two write verbs that target a single property rather than a value: clearing it, and removing it. */
export type PropertyWriteVerb = 'set_property_undefined' | 'delete_property';

/**
 * Why a property path cannot be written through.
 *
 * The first three say the path does not name a writable location at all:
 * - `disallowed_segment`: a decoded segment (`\.` is a literal dot inside one key) is empty, or is
 *   `__proto__`/`prototype`/`constructor`.
 * - `unknown_path`: the schema declares no property at the path.
 * - `traverses_array`: the path passes through an array; array contents are reached by scoping into the
 *   array instead.
 *
 * The rest say the path names a property this verb may not change:
 * - `object_array_property`: the leaf holds an array of objects, which neither verb discards wholesale.
 * - `not_undefinable`: the schema will not store `undefined` at the leaf as `undefined`.
 * - `not_optional`: the schema will not accept the item with the leaf's key absent.
 * - `primary_key`: the path targets the item's primary key, which the write engine refuses regardless of
 *   what the schema permits.
 */
export type PropertyPathRejectionReason =
    | 'disallowed_segment'
    | 'unknown_path'
    | 'traverses_array'
    | 'object_array_property'
    | 'not_undefinable'
    | 'not_optional'
    | 'primary_key';

/** Outcome of {@link resolvePropertyPathTarget}: the path is writable by this verb, or the reason it is not. */
export type PropertyPathResolution =
    | { ok: true }
    | { ok: false; reason: PropertyPathRejectionReason };

const DISALLOWED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Strip the wrappers that change a value's presence, fallback or mutability without changing the shape a
 * path segment is looked up in, and resolve a lazily-declared schema to the schema it produces.
 *
 * `prefault` is stripped alongside the shared transparent-wrapper set, which does not name it. A
 * self-referential lazy schema can return itself, so the walk stops as soon as it revisits a schema.
 */
function toCoreShape(schema: AnyZodSchema): AnyZodSchema {
    const seen = new Set<AnyZodSchema>();
    let current = schema;
    while (!seen.has(current)) {
        seen.add(current);
        const kind = getZodKind(current);
        if (kind === 'lazy') { current = getLazyInner(current); continue; }
        if (isTransparentWrapper(kind) || kind === 'prefault') { current = unwrap(current); continue; }
        return current;
    }
    return current;
}

/**
 * Whether the container itself settles the question of the key being absent, or leaves it to the key's own
 * declaration.
 *
 * Object fields are declared one at a time, so each key answers for itself (`ask_leaf`). A record's keys all
 * share one declaration, so the record answers for all of them at once, and an undeclared key accepted by an
 * object's catchall is by definition never required.
 */
type AbsenceAuthority = 'container_allows' | 'container_forbids' | 'ask_leaf';

/** One resolved hop: the schema found at a segment, plus who decides whether that key may be absent. */
type SegmentLookup =
    | { ok: true; schema: AnyZodSchema; absence: AbsenceAuthority }
    | { ok: false; reason: PropertyPathRejectionReason };

/** Run a parse without letting a throwing schema (a refinement, a cyclic lazy) escape as an exception. */
function parses(schema: AnyZodSchema, value: unknown): { success: boolean; data?: unknown } {
    try {
        const result = schema.safeParse(value);
        return result.success ? { success: true, data: result.data } : { success: false };
    } catch {
        return { success: false };
    }
}

/** Find the schema declared at one segment of a container, or the reason the container has nothing there. */
function lookupSegment(container: AnyZodSchema, segment: string): SegmentLookup {
    const core = toCoreShape(container);
    switch (getZodKind(core)) {
        case 'object': {
            const shape = getObjectShape(core);
            if (Object.prototype.hasOwnProperty.call(shape, segment)) {
                return { ok: true, schema: shape[segment]!, absence: 'ask_leaf' };
            }
            // `.catchall(x)` and loose objects declare a type for undeclared keys; a strict object stores a
            // `never` catchall, which declares the opposite.
            const catchall = getCatchall(core);
            if (catchall && getZodKind(catchall) !== 'never') {
                return { ok: true, schema: catchall, absence: 'container_allows' };
            }
            return { ok: false, reason: 'unknown_path' };
        }
        case 'record': {
            if (!parses(getRecordKeyType(core), segment).success) return { ok: false, reason: 'unknown_path' };
            // Whether a record requires its keys is a property of the whole record: an enumerated key schema
            // makes every name mandatory, while an open or partial record makes them all optional. Parsing an
            // empty object asks that question directly, without depending on how the record was declared.
            const absence = parses(core, {}).success ? 'container_allows' : 'container_forbids';
            return { ok: true, schema: getRecordValueType(core), absence };
        }
        case 'intersection': {
            // Callers graft fields onto a row shape with an intersection, so a segment may be declared by
            // either side. The side that declares it answers; a refusal is reported only when neither does.
            const { left, right } = getIntersectionParts(core);
            const results = [lookupSegment(left, segment), lookupSegment(right, segment)];
            const found = results.find(r => r.ok);
            if (found) return found;
            const specific = results.find(r => !r.ok && r.reason !== 'unknown_path');
            return specific ?? { ok: false, reason: 'unknown_path' };
        }
        case 'array':
            return { ok: false, reason: 'traverses_array' };
        default:
            // A union of shapes, or any non-container, declares no single property at this segment.
            return { ok: false, reason: 'unknown_path' };
    }
}

/** Whether a schema can carry objects, judged the way a whole-array write judges its element type. */
function carriesObjects(schema: AnyZodSchema): boolean {
    const core = toCoreShape(schema);
    const kind = getZodKind(core);
    if (kind === 'union') return getUnionOptions(core).some(carriesObjects);
    return kind === 'object' || kind === 'record' || kind === 'intersection'
        || kind === 'tuple' || kind === 'map' || kind === 'set';
}

/**
 * Whether the leaf stores `undefined` as `undefined`.
 *
 * Accepting `undefined` is not enough: a defaulted or caught schema also "accepts" it, by substituting its
 * fallback. Storing `undefined` behind one of those would leave the item disagreeing with its own schema
 * from then on, so the written value must survive the schema's parse unchanged.
 */
function storesUndefined(leaf: AnyZodSchema): boolean {
    const result = parses(leaf, undefined);
    return result.success && result.data === undefined;
}

/**
 * Whether the leaf's key may simply be absent.
 *
 * Asked of a sibling-free object holding just this leaf, so the answer depends on the leaf's own declaration
 * and nothing else. As with clearing, the parse must also LEAVE the key absent: a defaulted schema fills it
 * back in, which would undo the removal on the item's next parse.
 */
function toleratesAbsence(leaf: AnyZodSchema): boolean {
    const result = parses(z.object({ probe: leaf }), {});
    return result.success && !('probe' in (result.data as Record<string, unknown>));
}

/**
 * Decides whether a property-targeting write can touch `path`, and says why not when it cannot.
 *
 * `set_property_undefined` and `delete_property` name a single property to clear or remove. Both are refused
 * unless the schema still describes the item afterwards — otherwise the write would leave stored data that
 * its own schema rejects, or that the schema silently rewrites on the next parse. This is the single source
 * of truth for that decision: the payload-schema gate and the write engine both call it, so they accept and
 * reject identical paths.
 *
 * The two verbs ask different questions of the same leaf. Clearing asks whether the schema stores `undefined`
 * as `undefined`; removing asks whether the schema accepts the item with the key gone. `.optional()` answers
 * yes to both. `z.union([z.string(), z.undefined()])` permits only clearing, because its key is still
 * required. A key of `z.record(z.string(), z.string())` permits only removal, because its value has to be a
 * string whenever the key is there.
 *
 * @param schema The schema of one item the write action runs against.
 * @param path Dot-prop path from the item's root to the property (e.g. `'profile.nickname'`), in the escaped
 * grammar where `\.` is a literal dot inside one key.
 * @param verb Which write is being attempted.
 * @returns `{ ok: true }` when the write is permitted, otherwise `{ ok: false, reason }` — see
 * {@link PropertyPathRejectionReason}.
 *
 * @example
 * resolvePropertyPathTarget(schema, 'nickname', 'delete_property');        // { ok: true }
 * resolvePropertyPathTarget(schema, 'id', 'delete_property');              // { ok: false, reason: 'not_optional' }
 * resolvePropertyPathTarget(schema, 'rows.title', 'delete_property');      // { ok: false, reason: 'traverses_array' }
 *
 * @remarks
 * The path may cross nested objects, intersections and records, but never an array: an array's contents are
 * edited by scoping into it. A leaf holding an array of objects is refused outright, mirroring the same
 * prohibition on updating a whole object array.
 *
 * `__proto__`, `prototype` and `constructor` are refused even where the schema declares such a field, because
 * the runtime property reader will not traverse them. An empty segment — what a leading, trailing or doubled
 * dot produces — is refused for a related reason: a record would otherwise accept it and the write would land
 * on a key named `''`.
 *
 * Every permission question is settled by parsing rather than by inspecting wrapper types, which is what
 * makes composed declarations answer correctly: `.catch('x').optional()` is clearable while `.catch('x')`
 * alone is not, and `.optional().nullable()` is removable while `string | undefined` is not.
 */
export function resolvePropertyPathTarget(
    schema: AnyZodSchema,
    path: string,
    verb: PropertyWriteVerb,
): PropertyPathResolution {
    const segments = parseDotPropPathSegments(path);
    if (segments.some(segment => segment === '' || DISALLOWED_SEGMENTS.has(segment))) {
        return { ok: false, reason: 'disallowed_segment' };
    }

    let container: AnyZodSchema = schema;
    let leaf: SegmentLookup | undefined;
    for (const segment of segments) {
        leaf = lookupSegment(container, segment);
        if (!leaf.ok) return leaf;
        container = leaf.schema;
    }
    // `parseDotPropPathSegments` always returns at least one segment, so the loop always assigns.
    if (!leaf?.ok) return { ok: false, reason: 'unknown_path' };

    const core = toCoreShape(leaf.schema);
    if (getZodKind(core) === 'array' && carriesObjects((core as z.ZodArray).element as AnyZodSchema)) {
        return { ok: false, reason: 'object_array_property' };
    }

    if (verb === 'set_property_undefined') {
        return storesUndefined(leaf.schema) ? { ok: true } : { ok: false, reason: 'not_undefinable' };
    }

    if (leaf.absence === 'container_allows') return { ok: true };
    if (leaf.absence === 'container_forbids') return { ok: false, reason: 'not_optional' };
    return toleratesAbsence(leaf.schema) ? { ok: true } : { ok: false, reason: 'not_optional' };
}
