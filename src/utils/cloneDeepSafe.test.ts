import cloneDeepSafe from "./cloneDeepSafe";

describe('cloneDeepSafe', () => {

    
    describe('strip_circular', () => {
        test('basic', () => {
            const obj = {hello: "world", child: {goodbye: "to you"}};
            expect(cloneDeepSafe(obj, {strip_circular: true})).toEqual(obj);
    
        })
    
        test('verify it is cloned', () => {
            const obj = {hello: "world", child: {goodbye: "to you"}};
            expect(cloneDeepSafe(obj, {strip_circular: true})===obj).toBe(false);
            expect(cloneDeepSafe(obj.child, {strip_circular: true})===obj.child).toBe(false);
            expect(obj.child===obj.child).toBe(true);
    
        })
    
        test('the same item seen twice is fine', () => {
            const subObj = {hello: "world"};
    
            const obj: any = {
                a: subObj,
                b: {
                    c: subObj
                },
            };
            
            const result = cloneDeepSafe(obj, {strip_circular: true});
            
            expect(cloneDeepSafe(obj, {strip_circular: true})).toEqual(obj);
            
        })
    
        test('circular', () => {
            const obj: any = {
                a: 1,
                b: {
                    c: 2,
                    d: null,
                },
            };
            obj.b.e = obj;
            
            const result = cloneDeepSafe(obj, {strip_circular: true});
            
            expect(result).toEqual({
                ...obj,
                b: {
                    ...obj.b,
                    e: "[Circular *]"
                }
            });
            
        })
    
        test('can stringify a circular object, with a function', () => {
            const obj: any = {
                a: 1,
                b: {
                    c: 2,
                    d: () => true,
                },
            };
            obj.b.e = obj;
    
            let error = false;
            try {
                JSON.stringify(obj);
            } catch(e) {
                error = true;
            }
            expect(error).toBe(true);
            
            const result = JSON.stringify(cloneDeepSafe(obj, {strip_circular: true}));
            
            expect(result).toBe("{\"a\":1,\"b\":{\"c\":2,\"e\":\"[Circular *]\"}}")
            
        })
    })

    describe('strip_keys_exact', () => {
        test('strip exact', () => {
            const obj = {
                a: 1,
                b: {
                    c: 2,
                    d: null,
                },
                e: [
                    {f: true}
                ]
            };
            
            const result = cloneDeepSafe(obj, {strip_keys_exact: ['b.c']});
            
            expect(result).toEqual({
                ...obj,
                b: {
                    ...obj.b,
                    c: undefined
                }
            });
            
        })
    })


    describe('strip_keys_regexp', () => {
        test('strip regexp', () => {
            const obj = {
                a: 1,
                b: {
                    c: 2,
                    d: null,
                },
                e: [
                    {f: true}
                ]
            };
            
            const result = cloneDeepSafe(obj, {strip_keys_regexp: [new RegExp('b.(c|d)')]});
            
            expect(result).toEqual({
                ...obj,
                b: {
                    c: undefined,
                    d: undefined
                }
            });
            
        })
    })

    describe('strip_non_serializable_under_keys', () => {

        test('function', () => {
            const obj = {
                a: 1,
                b: {
                    c: 2,
                    d: () => true,
                },
            };
            
            
            const result = cloneDeepSafe(obj, {strip_non_serializable_under_keys: ['b']});
            
            expect(result).toEqual({
                ...obj,
                b: {
                    ...obj.b,
                    d: undefined
                }
            });
        })

        test('root function', () => {
            const obj = {
                a: 1,
                b: () => true
            };
            
            
            const result = cloneDeepSafe(obj, {strip_non_serializable_under_keys: ['']});
            
            expect(result).toEqual({
                ...obj,
                b: undefined
            });
        })


        test('only direct descendents', () => {
            const obj = {
                a: 1,
                b: {
                    c: 2,
                    d: () => true,
                },
            };
            
            
            const result = cloneDeepSafe(obj, {strip_non_serializable_under_keys: ['']});
            
            expect(result).toEqual(obj);
        })

        test('native', () => {
            const obj = {
                a: 1,
                b: globalThis
            };
            
            const result = cloneDeepSafe(obj, {strip_non_serializable_under_keys: ['']});
            
            expect(result).toEqual({
                ...obj,
                b: undefined
            });
        })

    })

})