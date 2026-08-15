import { parseDotPropPathSegments } from "../../../../dot-prop-paths/dotPropPathSegments.ts";
import isPlainObject from "../../../../utils/isPlainObject.ts";

/** Segments that name inherited machinery rather than data, and are never traversed or written. */
const DISALLOWED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** The object holding the targeted property, and the key it is held under. */
type PropertyLocation = { parent: Record<string, unknown>; key: string };

/**
 * Find the object that directly holds the property `path` names, without creating anything on the way.
 *
 * A path of one segment locates a property of `item` itself; a longer path hops through the objects each
 * leading segment names. Any hop that is missing, inherited, or not a plain object stops the walk, because
 * a property-targeting write alters what is already there rather than building the structure around it.
 *
 * @param item The object the path is resolved from.
 * @param path Dot-prop path to the property, in the escaped grammar where `\.` is a literal dot inside one key.
 * @returns The holder and key, or `undefined` when the path reaches no such property.
 */
function resolveParentForWrite(item: Record<string, unknown>, path: string): PropertyLocation | undefined {
    const segments = parseDotPropPathSegments(path);
    // An empty segment (from a leading, trailing or doubled dot) would otherwise land on a key named `''`,
    // which the caller never asked to write; the machinery segments are refused for the usual prototype
    // reasons. Both are already refused before an action runs, so this repeats the refusal only so the
    // helper is safe to call with any path.
    if (segments.some(segment => segment === '' || DISALLOWED_SEGMENTS.has(segment))) return undefined;

    let parent: Record<string, unknown> = item;
    for (let i = 0; i < segments.length - 1; i++) {
        const next = Object.prototype.hasOwnProperty.call(parent, segments[i]!) ? parent[segments[i]!] : undefined;
        if (!isPlainObject(next)) return undefined;
        parent = next;
    }
    return { parent, key: segments[segments.length - 1]! };
}

/**
 * Whether clearing the property at `path` would alter `item`.
 *
 * Clearing gives an existing property the value `undefined` while leaving its key in place, so there is
 * nothing to do when the key is absent — the verb alters a property rather than introducing one — nor when
 * its value is already `undefined`.
 *
 * @param item The object to inspect; it is not modified.
 * @param path Dot-prop path to the property, in the escaped grammar where `\.` is a literal dot inside one key.
 * @returns `{ changed }` — `false` means the write is a no-op, so the caller can leave the item alone entirely.
 *
 * @example
 * probeSetPropertyUndefined({ id: '1', text: 'hi' }, 'text');  // { changed: true }
 * probeSetPropertyUndefined({ id: '1' }, 'text');              // { changed: false }
 */
export function probeSetPropertyUndefined(item: Record<string, unknown>, path: string): { changed: boolean } {
    const location = resolveParentForWrite(item, path);
    if (!location) return { changed: false };
    const present = Object.prototype.hasOwnProperty.call(location.parent, location.key);
    return { changed: present && location.parent[location.key] !== undefined };
}

/**
 * Give the property at `path` the value `undefined`, keeping its key.
 *
 * @param target The object to modify — the one the caller intends to change, never the object a probe read.
 * @param path Dot-prop path to the property, in the escaped grammar where `\.` is a literal dot inside one key.
 *
 * @remarks
 * The holder is resolved afresh from `target`, so the write lands in the object being changed even when the
 * decision to write was taken by probing a different copy of it. A path that reaches nothing leaves `target`
 * untouched.
 */
export function commitSetPropertyUndefined(target: Record<string, unknown>, path: string): void {
    const location = resolveParentForWrite(target, path);
    if (!location) return;
    location.parent[location.key] = undefined;
}

/**
 * Whether removing the property at `path` would alter `item`.
 *
 * Removal takes the key away entirely, so it changes the item whenever the key is its own — including when
 * the value held there is already `undefined`, which is the one case where clearing and removing differ.
 *
 * @param item The object to inspect; it is not modified.
 * @param path Dot-prop path to the property, in the escaped grammar where `\.` is a literal dot inside one key.
 * @returns `{ changed }` — `false` means the write is a no-op, so the caller can leave the item alone entirely.
 *
 * @example
 * probeDeleteProperty({ id: '1', text: undefined }, 'text');  // { changed: true }
 * probeDeleteProperty({ id: '1' }, 'text');                   // { changed: false }
 */
export function probeDeleteProperty(item: Record<string, unknown>, path: string): { changed: boolean } {
    const location = resolveParentForWrite(item, path);
    if (!location) return { changed: false };
    return { changed: Object.prototype.hasOwnProperty.call(location.parent, location.key) };
}

/**
 * Remove the property at `path`, key and all.
 *
 * @param target The object to modify — the one the caller intends to change, never the object a probe read.
 * @param path Dot-prop path to the property, in the escaped grammar where `\.` is a literal dot inside one key.
 *
 * @remarks
 * The holder is resolved afresh from `target`, so the write lands in the object being changed even when the
 * decision to write was taken by probing a different copy of it. A path that reaches nothing leaves `target`
 * untouched.
 */
export function commitDeleteProperty(target: Record<string, unknown>, path: string): void {
    const location = resolveParentForWrite(target, path);
    if (!location) return;
    delete location.parent[location.key];
}
