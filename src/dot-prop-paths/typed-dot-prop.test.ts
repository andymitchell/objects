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

describe('inherited members resolve as absent (own-property-only reads)', () => {
    // The path type admits `foo.toString` because the field is declared; the runtime read must agree
    // with the declaration, not with Object.prototype — an absent declared field is absent even when
    // an inherited member spells its name.
    type Row = { foo: { toString?: string, valueOf?: string, hasOwnProperty?: string } };

    // The rows come through JSON.parse — matching how data spelling inherited names really arrives —
    // because a literal can't claim this type: its apparent type carries the inherited
    // `toString(): string` method, which conflicts with the declared `toString?: string` field.

    it('an inherited name resolves undefined, and a caller default applies', () => {
        const row: Row = JSON.parse('{"foo":{}}');
        expect(getTypedProperty(row, 'foo.toString')).toBe(undefined);
        expect(getTypedProperty(row, 'foo.valueOf')).toBe(undefined);
        expect(getTypedProperty(row, 'foo.hasOwnProperty')).toBe(undefined);
        expect(getTypedProperty(row, 'foo.toString', 'fallback')).toBe('fallback');
    });

    it('an own key that spells an inherited name is still real data (the guard is own-property, not a denylist)', () => {
        const row: Row = JSON.parse('{"foo":{"toString":"v"}}');
        expect(getTypedProperty(row, 'foo.toString')).toBe('v');
    });
})