import { getProperty, setProperty } from "dot-prop";
import type { DotPropPathsUnion, PathValue } from "./types.js";

export function setTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object:T, path:P, value: unknown):T {
    return setProperty(object, path, value);
}

export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object: T, path: P): PathValue<T, P> | undefined;
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object: T,path: P,defaultValue: PathValue<T, P>): PathValue<T, P>;
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object:T, path:P, defaultValue?: PathValue<T, P>):PathValue<T, P> | undefined {
    return getProperty(object, path, defaultValue) as PathValue<T, P> | undefined;
}
