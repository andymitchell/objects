import { setProperty } from "dot-prop";
import {  getProperty as getPropertySimpleDot, getPropertySpreadingArrays } from "./getPropertySimpleDot";

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
        setProperty(src, result[1].path, [{name: 'Too'}]);
        expect(src.log[1].affected_people[0].name).toBe('Too');
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


export const DISALLOWED_GET_PROPERTY_PATHS_ARE_UNDEFINED = ['', '.', '.id', '*', '__proto__', '__proto__.polluted', 'prototype', 'constructor'];
describe('attacks', () => {

    function expectUndefined(path:string):boolean {
        const obj = {
            id: '1'
        }

        const result1 = getPropertySimpleDot(obj, path);
        //const result2 = getPropertyFast(obj, path);
        const result2 = getPropertySpreadingArrays(obj, path);
        if( result1===undefined && result2.length===1 && result2[0].value===undefined ) {
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