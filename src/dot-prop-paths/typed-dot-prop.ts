import { getProperty, setProperty } from "dot-prop";
import { DotPropPathsUnion, PathValue } from "./types";

export function setTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object:T, path:P, value: unknown):T {
    return setProperty(object, path, value);
}

export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object: T, path: P): PathValue<T, P> | undefined;
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object: T,path: P,defaultValue: PathValue<T, P>): PathValue<T, P>;
export function getTypedProperty<T extends Record<string, any>, P extends DotPropPathsUnion<T>>(object:T, path:P, defaultValue?: PathValue<T, P>):PathValue<T, P> | undefined {
    return getProperty(object, path, defaultValue) as PathValue<T, P> | undefined;
}

function test() {

    type Expect<T extends true> = T;
    type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
    T
    >() => T extends Y ? 1 : 2
    ? true
    : false;
    
    
    const sampleObj = {
        a: {
            b: 1,
            c: 'a'
        }
    }

    const result1 = getTypedProperty(sampleObj, 'a.b');
    const result2 = getTypedProperty(sampleObj, 'a.c');
    type Test1 = Expect<Equal<typeof result1, number | undefined>>;
    type Test2 = Expect<Equal<typeof result2, string | undefined>>;
    
    

}