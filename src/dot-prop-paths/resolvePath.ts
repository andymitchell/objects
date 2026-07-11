import {
    getArrayElement,
    getLazyInner,
    getObjectShape,
    getRecordValueType,
    getZodKind,
    isTransparentWrapper,
    unwrap,
    type AnyZodSchema,
} from "../zod/introspection.ts";
import { parseDotPropPathSegments } from "./dotPropPathSegments.ts";
import type { TreeNode, TreeNodeMap } from "./schema-tree.ts";
import type { ResolvedPath, ResolvePathResult } from "./resolvePath-types.ts";

/** Guards against a self-referential `z.lazy` schema returning itself forever. */
const MAX_WRAPPER_STEPS = 100;

/**
 * Resolve a dot-prop path against a schema, reporting what lives at its leaf.
 *
 * A dot-prop path names a field by joining keys with `.`, and escapes a literal dot in a key as `\.`, so
 * `a\.b` is one key and `a.b` is two. This is the single place that decides what a path means: it decodes
 * the path once, then descends the schema on the decoded segments — through objects, arrays, transparent
 * wrappers, and the dynamic keys of a `z.record` — and never re-splits a joined string along the way.
 *
 * A record is the reason this cannot be a map lookup. `Record<string, X>` makes every key an `X`, so
 * `data.<anything>.value` is a real field, yet no schema-derived path map can list it. A resolver that
 * stops at the first dynamic key reports the path as unknown, and an unknown path is not merely unmatched:
 * engines feed it to their missing-field rules, where `$ne` reports "an absent field differs from any
 * value" and matches every row. Reporting a resolvable path as unknown is a wrong match, not a near miss.
 *
 * @param dotPropPath the path to resolve, e.g. `contact.name`, `data.foo.value`, `a\.b`.
 * @param nodeMap the schema's flat path map, from `convertSchemaToDotPropPathTree`. Build it with parent
 *   references (the default) so `arrayDepth` can see the path's ancestry.
 * @returns `success: false` only when the path is malformed (an empty segment, as in `''`, `.`, or `a..b`).
 *   Otherwise `success: true` with a {@link ResolvedPath} whose `known` says whether the schema describes it.
 *
 * @example
 * resolvePath('contact.name', nodeMap);
 * // { success: true, resolved: { known: true, origin: 'enumerated', leafKind: 'string', arrayDepth: 0, … } }
 *
 * @example
 * // `data` is a `z.record(z.string(), z.object({ value: z.string() }))`
 * resolvePath('data.anything.value', nodeMap);
 * // { success: true, resolved: { known: true, origin: 'record_value', leafKind: 'string', … } }
 *
 * @remarks
 * A record key may itself contain a dot, reached as `data.a\.b.value`. Segments are never re-joined to
 * continue the descent, so such a key resolves to the record's value type rather than being mistaken for
 * two nested keys.
 *
 * `segments` are decoded keys and are safe to resolve against data, but they are NOT safe to interpolate
 * into a query — a record key is arbitrary runtime text. Quoting belongs to whichever emitter consumes them.
 *
 * A path whose leaf sits behind a union is reported unknown: two variants may disagree on the leaf's type,
 * and guessing one would be worse than declining.
 *
 * `lookupPath` rejoins the decoded segments, so a literal-dot key (`a\.b`) and a nested path (`a.b`) collide
 * on one map entry. The entry found there is accepted only when the node's own ancestry spells the decoded
 * segments, so each reading resolves independently: the one the schema declares is found, and the other
 * reports unknown.
 */
export function resolvePath(dotPropPath: string, nodeMap: TreeNodeMap): ResolvePathResult {
    const segments = parseDotPropPathSegments(dotPropPath);
    if (!dotPropPath || segments.some(segment => !segment)) {
        return { success: false, error: { type: 'invalid_path', dotPropPath, message: `A dot-prop path segment is empty: '${dotPropPath}'` } };
    }

    const lookupPath = segments.join('.');
    const unknown: ResolvedPath = { lookupPath, segments, arrayDepth: 0, known: false, origin: 'unknown', leafKind: undefined, leafSchema: undefined, node: undefined };

    // Own-property only: a plain object inherits `__proto__`, `constructor`, `toString`, … from
    // `Object.prototype`, and reading one as a declared node would report a path no schema holds as known.
    // Identity-checked: `lookupPath` rejoins the segments lossily, so a literal-dot key and a nested path can
    // collide on one entry; the node counts only when its own ancestry spells the decoded segments.
    const candidate = Object.hasOwn(nodeMap, lookupPath) ? nodeMap[lookupPath] : undefined;
    const enumerated = candidate && nodeMatchesSegments(candidate, segments) ? candidate : undefined;
    if (enumerated) {
        return {
            success: true,
            resolved: {
                lookupPath,
                segments,
                arrayDepth: countArraysInAncestry(enumerated),
                known: true,
                origin: 'enumerated',
                leafKind: enumerated.kind,
                leafSchema: enumerated.schema,
                node: enumerated,
            },
        };
    }

    const record = findRecordAncestor(segments, nodeMap);
    if (!record) return { success: true, resolved: unknown };

    // The first segment below the record is its dynamic key, which selects the value schema; the rest
    // describe a path within that value.
    const leaf = walkValueSchema(getRecordValueType(record.schema), segments.slice(record.depth + 1));
    if (!leaf) return { success: true, resolved: unknown };

    return {
        success: true,
        resolved: {
            lookupPath,
            segments,
            arrayDepth: countArraysInAncestry(record.node) + leaf.arrayDepth,
            known: true,
            origin: 'record_value',
            leafKind: getZodKind(leaf.schema),
            leafSchema: leaf.schema,
            node: undefined,
        },
    };
}

/**
 * Whether a resolved path descends through a record and also crosses an array, which no plain accessor can
 * address.
 *
 * Reading a field beneath an array means visiting every element, and an engine plans that visit from the
 * schema's path map — which has no node for a record's dynamic key, and so no array to visit. Such a path
 * resolves to a real leaf yet cannot be reached; an engine must say so rather than answer as though the leaf
 * held nothing.
 *
 * @param resolved a path resolved by {@link resolvePath}.
 * @returns `true` when the path is real but unreachable by a schema-planned traversal.
 *
 * @example
 * // `data` is a record and `tags` an array within its value type
 * isUnspreadableRecordPath(resolve('data.foo.tags')); // true
 * isUnspreadableRecordPath(resolve('data.foo.value')); // false
 */
export function isUnspreadableRecordPath(resolved: ResolvedPath): boolean {
    return resolved.origin === 'record_value' && resolved.arrayDepth > 0;
}

/**
 * Whether a path-map node's own ancestry spells exactly these decoded segments.
 *
 * Map keys rejoin segments with `.`, so a literal-dot key (`a\.b`) and a nested path (`a.b`) collide on one
 * key. The node stored there belongs to only one of those readings; this is the test for which — a node's
 * named ancestors, root-first, must equal the segments one-for-one.
 */
function nodeMatchesSegments(node: TreeNode, segments: readonly string[]): boolean {
    const names: string[] = [];
    let target: TreeNode | undefined = node;
    while (target) {
        if (target.name) names.unshift(target.name);
        target = target.parent;
    }
    return names.length === segments.length && names.every((name, index) => name === segments[index]);
}

/** Counts the arrays a node's path crosses, including the node itself when it is an array. */
function countArraysInAncestry(node: TreeNode): number {
    let count = 0;
    let target: TreeNode | undefined = node;
    while (target) {
        if (target.kind === 'array') count++;
        target = target.parent;
    }
    return count;
}

/**
 * Find the record whose dynamic key the path descends through, by walking up to the nearest declared
 * ancestor. Any other declared ancestor — a plain object, an array — means the path is genuinely unknown,
 * because that ancestor enumerates its keys and the path is not among them.
 */
function findRecordAncestor(segments: readonly string[], nodeMap: TreeNodeMap): { node: TreeNode, schema: AnyZodSchema, depth: number } | undefined {
    for (let depth = segments.length - 1; depth >= 0; depth--) {
        const ancestorPath = segments.slice(0, depth).join('.');
        const ancestor = Object.hasOwn(nodeMap, ancestorPath) ? nodeMap[ancestorPath] : undefined;
        if (!ancestor) continue;
        // A wrong-reading node (a literal-dot key colliding with this prefix) is not this path's ancestor;
        // a shorter prefix may still hold the record the segments really descend through, so keep looking.
        if (!nodeMatchesSegments(ancestor, segments.slice(0, depth))) continue;
        if (ancestor.kind === 'record' && ancestor.schema) return { node: ancestor, schema: ancestor.schema, depth };
        return undefined;
    }
    return undefined;
}

/** Descend a schema by decoded key segments, counting the arrays crossed. `undefined` when a segment has no field. */
function walkValueSchema(valueSchema: AnyZodSchema, segments: readonly string[]): { schema: AnyZodSchema, arrayDepth: number } | undefined {
    let current = valueSchema;
    let arrayDepth = 0;

    for (const segment of segments) {
        const container = stepToContainer(current, arrayDepth);
        arrayDepth = container.arrayDepth;
        const kind = getZodKind(container.schema);

        if (kind === 'object') {
            const shape = getObjectShape(container.schema);
            // Own-property only: the shape inherits `constructor`, `toString`, … from Object.prototype, and an
            // inherited member is not a declared field — nor even a Zod schema, so reading it as one would throw.
            const field = Object.hasOwn(shape, segment) ? shape[segment] : undefined;
            if (!field) return undefined;
            current = field;
        } else if (kind === 'record') {
            current = getRecordValueType(container.schema); // this segment is another dynamic key
        } else {
            return undefined; // a scalar, a union, or an opaque leaf owns no keys
        }
    }

    // The leaf keeps its own shape: a trailing array counts towards the depth but is not descended into,
    // so `leafKind` stays 'array' exactly as a declared array field's node would.
    const leaf = stepThroughWrappers(current);
    return { schema: leaf, arrayDepth: getZodKind(leaf) === 'array' ? arrayDepth + 1 : arrayDepth };
}

/** Step through wrappers and into array elements until a schema that owns keys is reached. */
function stepToContainer(schema: AnyZodSchema, arrayDepth: number): { schema: AnyZodSchema, arrayDepth: number } {
    let current = schema;
    for (let step = 0; step < MAX_WRAPPER_STEPS; step++) {
        const kind = getZodKind(current);
        if (kind === 'array') {
            current = getArrayElement(current);
            arrayDepth++;
        } else if (kind === 'lazy') {
            current = getLazyInner(current);
        } else if (isTransparentWrapper(kind)) {
            current = unwrap(current);
        } else {
            break;
        }
    }
    return { schema: current, arrayDepth };
}

/** Step through transparent wrappers only, leaving an array as an array. */
function stepThroughWrappers(schema: AnyZodSchema): AnyZodSchema {
    let current = schema;
    for (let step = 0; step < MAX_WRAPPER_STEPS; step++) {
        const kind = getZodKind(current);
        if (kind === 'lazy') current = getLazyInner(current);
        else if (isTransparentWrapper(kind)) current = unwrap(current);
        else break;
    }
    return current;
}
