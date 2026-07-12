import { setProperty } from "dot-prop";
import { getPropertyOwn } from "./getPropertyOwn.ts";
import type { DotPropPathsUnion, PathValue } from "./types.js";

/**
 * Set the value at a typed dot-prop path, returning the same (mutated) object.
 *
 * Writing always creates or overwrites an OWN key, and the path grammar denylists the
 * prototype-pollution segments (`__proto__`, `prototype`, `constructor`), so a write cannot touch the
 * prototype chain.
 *
 * @param object the object to write into.
 * @param path a path the type of `object` declares.
 * @param value the value to store at the path.
 * @returns `object`, for chaining.
 */
export function setTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object:T, path:P, value: unknown):T {
    return setProperty(object, path, value);
}

/**
 * Resolve a typed dot-prop path, reading only OWN properties at each step.
 *
 * The path type only admits paths `T` declares, and the runtime read matches the declaration: a
 * declared field that is absent from the object resolves `undefined` (or the caller's default) even
 * when an inherited `Object.prototype` member spells its name, while an own key that spells such a
 * name still resolves as the data it is.
 *
 * @param object the object to read from.
 * @param path a path the type of `object` declares.
 * @param defaultValue returned when the path does not resolve to an own value.
 * @returns the value at the path, or `defaultValue`/`undefined` when absent.
 */
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object: T, path: P): PathValue<T, P> | undefined;
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object: T,path: P,defaultValue: PathValue<T, P>): PathValue<T, P>;
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object:T, path:P, defaultValue?: PathValue<T, P>):PathValue<T, P> | undefined {
    const value = getPropertyOwn(object, path);
    // Cast: getPropertyOwn returns `unknown`, but P names a path T declares, so an own value found
    // there is a PathValue<T, P> by construction.
    return (value === undefined ? defaultValue : value) as PathValue<T, P> | undefined;
}
