import { setProperty, getProperty as dotPropGetProperty, deepKeys } from "dot-prop";
import {  getProperty as getPropertySimpleDot, getPropertySpreadingArrays, DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED } from "./getPropertySimpleDot.js";

describe('getPropertySpreadingArrays test', () => {

    test('nested array property', () => {
        const src = {
            log: [
                {
                    ts: 1,
                    affected_people: [{name: 'Bob'}, {name: 'Alice'}]
                },
                {
                    ts: 2,
                    affected_people: [{name: 'Rita'}]
                },
                {
                    ts: 3,
                    affected_people: []
                }
            ]
        };
        const result = getPropertySpreadingArrays(
            src,
            'log.affected_people'
        );
        expect(
            result
        ).toEqual([{"path":"log[0].affected_people","value":[{"name":"Bob"},{"name":"Alice"}]},{"path":"log[1].affected_people","value":[{"name":"Rita"}]},{"path":"log[2].affected_people","value":[]}]);

        // Test the path resolves in popular packages like dot-prop
        setProperty(src, result[1]!.path, [{name: 'Too'}]);
        expect(src.log[1]!.affected_people[0]!.name).toBe('Too');
    });

    test('non-array items are indexed', () => {

        const result = getPropertySpreadingArrays(
            {log: [{id: 1}, {id: 2}]},
            'log.id'
        );
        expect(
            result
        ).toEqual([{"path":"log[0].id","value":1},{"path":"log[1].id","value":2}]);

    })

    test('a present-but-falsy member under an array is surfaced, distinct from an absent one', () => {
        // A leaf that exists but holds null / 0 / '' / false is a PRESENT value — it must be returned with that
        // value, not dropped. Dropping it (a truthiness test) would make it indistinguishable from an absent
        // member, so a downstream `$exists` on the array-descended path would wrongly answer false.
        expect(getPropertySpreadingArrays({ items: [{ value: null }] }, 'items.value')).toEqual([{ path: 'items[0].value', value: null }]);
        expect(getPropertySpreadingArrays({ items: [{ value: 0 }] }, 'items.value')).toEqual([{ path: 'items[0].value', value: 0 }]);
        expect(getPropertySpreadingArrays({ items: [{ value: '' }] }, 'items.value')).toEqual([{ path: 'items[0].value', value: '' }]);
        expect(getPropertySpreadingArrays({ items: [{ value: false }] }, 'items.value')).toEqual([{ path: 'items[0].value', value: false }]);

        // An absent member — and an empty outer array with no element to carry the member — find nothing, so
        // they yield the single not-found entry (`value: undefined`), matching `getProperty`.
        expect(getPropertySpreadingArrays({ items: [{}] }, 'items.value')).toEqual([{ path: '', value: undefined }]);
        expect(getPropertySpreadingArrays({ items: [] }, 'items.value')).toEqual([{ path: '', value: undefined }]);
    })

    test('large array spread resolves in linear time (no O(N^2) accumulator)', () => {
        const N = 50_000;
        const src = { items: Array.from({ length: N }, (_, i) => ({ id: `v${i}` })) };

        const startedAt = Date.now();
        const result = getPropertySpreadingArrays(src, 'items.id');
        const elapsedMs = Date.now() - startedAt;

        expect(result).toHaveLength(N);
        expect(result[0]).toEqual({ path: 'items[0].id', value: 'v0' });
        // The old `[...results, ...]`-in-a-loop accumulator was O(N^2) and took seconds at this N.
        expect(elapsedMs).toBeLessThan(1000);
    })

});

/*
describe('getPropertySpreadingArraysFlat test', () => {

    test('regular object (no arrays)', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                person: {
                    name: 'Bob'
                }
            },
            'person.name'
        );
        expect(
            result
        ).toEqual(['Bob']);
    });

    test('array under property ', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                people: [{name: 'Bob'}, {name: 'Alice'}]
            },
            'people'
        );
        expect(
            result
        ).toEqual([{name: 'Bob'}, {name: 'Alice'}]);
    });

    test('straight into array ', () => {
        const result = getPropertySpreadingArraysFlat(
            [{name: 'Bob'}, {name: 'Alice'}],
            'name'
        );
        expect(
            result
        ).toEqual(['Bob', 'Alice']);
    });

    test('array under property for name', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                people: [{name: 'Bob'}, {name: 'Alice'}]
            },
            'people.name'
        );
        expect(
            result
        ).toEqual(['Bob', 'Alice']);
    });


    test('nested array', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                log: [
                    {
                        ts: 1,
                        affected_people: [{name: 'Bob'}, {name: 'Alice'}]
                    },
                    {
                        ts: 2,
                        affected_people: [{name: 'Rita'}]
                    },
                    {
                        ts: 3,
                        affected_people: []
                    }
                ]
            },
            'log.affected_people'
        );
        expect(
            result
        ).toEqual([{name: 'Bob'}, {name: 'Alice'}, {name: 'Rita'}]);
    });


    test('nested array property', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                log: [
                    {
                        ts: 1,
                        affected_people: [{name: 'Bob'}, {name: 'Alice'}]
                    },
                    {
                        ts: 2,
                        affected_people: [{name: 'Rita'}]
                    },
                    {
                        ts: 3,
                        affected_people: []
                    }
                ]
            },
            'log.affected_people.name'
        );
        expect(
            result
        ).toEqual(["Bob","Alice","Rita"]);
    });


    test('wrong path', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                people: [{name: 'Bob'}, {name: 'Alice'}]
            },
            'animals'
        );
        expect(
            result
        ).toEqual([]);
    });

    test('overshot path in array', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                people: [{name: 'Bob'}, {name: 'Alice'}]
            },
            'people.age'
        );
        expect(
            result
        ).toEqual([]);
    });

    test('overshot path in object', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                person: {
                    name: 'Bob'
                }
            },
            'person.name.surname'
        );
        expect(
            result
        ).toEqual([]);
    });

    test('empty path', () => {
        const result = getPropertySpreadingArraysFlat(
            {
                people: [{name: 'Bob'}, {name: 'Alice'}]
            },
            ''
        );
        expect(
            result
        ).toEqual([{
            people: [{name: 'Bob'}, {name: 'Alice'}]
        }]);
    });


    test('empty path on array ', () => {
        const result = getPropertySpreadingArraysFlat(
            [{name: 'Bob'}, {name: 'Alice'}]
            ,
            ''
        );
        expect(
            result
        ).toEqual([{name: 'Bob'}, {name: 'Alice'}]);
    });


});
*/


describe('attacks', () => {

    function expectUndefined(path:string):boolean {
        const obj = {
            id: '1'
        }

        const result1 = getPropertySimpleDot(obj, path);
        //const result2 = getPropertyFast(obj, path);
        const result2 = getPropertySpreadingArrays(obj, path);
        if( result1===undefined && result2.length===1 && result2[0]!.value===undefined ) {
            return true;
        } else {
            path;
            debugger;
            return false;
        }
    }

    for( const dotPath of DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED ) {
        test(`attack: ${dotPath}`, () => {
            expect(expectUndefined(dotPath)).toBe(true);
        })
    }

})

describe('inherited members resolve as absent (own-property-only reads)', () => {
    // A path segment must name a container's OWN property to resolve; an inherited member such as
    // `toString` or `valueOf` is not data, so it reads as a genuinely absent key. This is what keeps
    // the value-driven matcher in agreement with the schema-driven SQL engines, whose path resolution
    // is own-property-only.
    const row = { data: { foo: { value: 'v' } } };

    test('an inherited name at any depth resolves undefined, with the same spreading shape as a genuinely absent key', () => {
        for (const name of ['toString', 'valueOf', 'hasOwnProperty']) {
            expect(getPropertySimpleDot(row, name)).toBe(undefined);
            expect(getPropertySimpleDot(row, `data.foo.${name}`)).toBe(undefined);
            expect(getPropertySpreadingArrays(row, `data.foo.${name}`)).toEqual(getPropertySpreadingArrays(row, 'data.foo.nope'));
        }
    });

    test('an own key that spells an inherited name is still real data (the guard is own-property, not a denylist)', () => {
        const own = { data: { foo: { toString: 'v' } } };
        expect(getPropertySimpleDot(own, 'data.foo.toString')).toBe('v');
        expect(getPropertySpreadingArrays(own, 'data.foo.toString')).toEqual([{ path: 'data.foo.toString', value: 'v' }]);
    });

    test('own-reachable paths resolve identically to the dot-prop package (grammar parity: escapes, brackets, falsy leaves)', () => {
        // Metamorphic pin: `deepKeys` enumerates every OWN leaf path in dot-prop's own grammar (escaped
        // dots, bracket indices), so on those paths the own-only reader must agree with dot-prop exactly.
        const fixture = { a: { 'b.c': 1, list: [{ x: 'x0' }, { x: 'x1' }] }, top: null, z: 0, s: '', f: false };
        const paths = deepKeys(fixture);
        expect(paths.length).toBeGreaterThan(5);
        for (const path of paths) {
            expect(getPropertySimpleDot(fixture, path)).toBe(dotPropGetProperty(fixture, path));
        }
    });
})