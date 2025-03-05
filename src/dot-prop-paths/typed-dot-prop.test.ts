import { getTypedProperty } from "./typed-dot-prop.ts";

it('no test just type errors', () => {

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
    
    

})