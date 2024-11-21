import cloneDeepAndSafe from "./cloneDeepAndSafe";

describe('cloneDeepAndSafe', () => {

    
    describe('circular', () => {
        test('basic', () => {
            const obj = {hello: "world", child: {goodbye: "to you"}};
            expect(cloneDeepAndSafe(obj, {strip_circular: true})).toEqual(obj);
    
        })
    
        test('verify it is cloned', () => {
            const obj = {hello: "world", child: {goodbye: "to you"}};
            expect(cloneDeepAndSafe(obj, {strip_circular: true})===obj).toBe(false);
            expect(cloneDeepAndSafe(obj.child, {strip_circular: true})===obj.child).toBe(false);
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
            
            const result = cloneDeepAndSafe(obj, {strip_circular: true});
            
            expect(cloneDeepAndSafe(obj, {strip_circular: true})).toEqual(obj);
            
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
            
            const result = cloneDeepAndSafe(obj, {strip_circular: true});
            
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
            
            const result = JSON.stringify(cloneDeepAndSafe(obj, {strip_circular: true}));
            
            expect(result).toBe("{\"a\":1,\"b\":{\"c\":2,\"e\":\"[Circular *]\"}}")
            
        })
    })

    describe('strip keys', () => {
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
            
            const result = cloneDeepAndSafe(obj, {strip_keys_exact: ['b.c']});
            
            expect(result).toEqual({
                ...obj,
                b: {
                    ...obj.b,
                    c: undefined
                }
            });
            
        })
    })
    

})