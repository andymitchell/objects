import { describe, it, expect } from 'vitest';
import { orderList } from './orderList.ts';
import type { ListOrdering } from '@andyrmitchell/objects/write-actions';

// Mock Data Type
type User = {
    id: number;
    name: string;
    age: number;
    score?: number | null; // Optional to test undefined/null
};

describe('orderList', () => {
    const users: User[] = [
        { id: 1, name: 'Alice', age: 30, score: 100 },
        { id: 2, name: 'Bob', age: 25, score: 80 },
        { id: 3, name: 'Charlie', age: 35, score: 95 },
        { id: 4, name: 'David', age: 30, score: null }, // Same age as Alice for stability check
    ];

    it('should sort by number ascending (default)', () => {
        const order: ListOrdering<User> = { key: 'age' };
        const result = orderList(users, order);

        expect(result.map(u => u.age)).toEqual([25, 30, 30, 35]);
        expect(result[0]!.name).toBe('Bob');
    });

    it('should sort by number descending', () => {
        const order: ListOrdering<User> = { key: 'age', direction: 'desc' };
        const result = orderList(users, order);

        expect(result.map(u => u.age)).toEqual([35, 30, 30, 25]);
        expect(result[0]!.name).toBe('Charlie');
    });

    it('should sort by string ascending', () => {
        const order: ListOrdering<User> = { key: 'name', direction: 'asc' };
        const result = orderList(users, order);

        expect(result.map(u => u.name)).toEqual(['Alice', 'Bob', 'Charlie', 'David']);
    });

    it('should sort by string descending', () => {
        const order: ListOrdering<User> = { key: 'name', direction: 'desc' };
        const result = orderList(users, order);

        expect(result.map(u => u.name)).toEqual(['David', 'Charlie', 'Bob', 'Alice']);
    });

    it('should maintain stability for equal keys (Ascending)', () => {
        // Alice (id:1) and David (id:4) both have age 30.
        // Alice comes before David in original list.
        const order: ListOrdering<User> = { key: 'age', direction: 'asc' };
        const result = orderList(users, order);

        // Filter to just the 30s
        const thirties = result.filter(u => u.age === 30);
        expect(thirties[0]!.name).toBe('Alice');
        expect(thirties[1]!.name).toBe('David');
    });

    it('should maintain stability for equal keys (Descending)', () => {
        const order: ListOrdering<User> = { key: 'age', direction: 'desc' };
        const result = orderList(users, order);

        const thirties = result.filter(u => u.age === 30);
        // Even in descending, if values are equal, original relative order preserves
        expect(thirties[0]!.name).toBe('Alice');
        expect(thirties[1]!.name).toBe('David');
    });

    it('should not mutate the original array', () => {
        const order: ListOrdering<User> = { key: 'age' };
        const originalClone = JSON.parse(JSON.stringify(users));
        
        orderList(users, order);

        expect(users).toEqual(originalClone);
    });

    it('should return an empty array if input is empty', () => {
        const result = orderList<{age:string}>([], { key: 'age' });
        expect(result).toEqual([]);
    });

    describe('Edge Cases & Null Handling', () => {
        const mixedData = [
            { id: 1, val: 10 },
            { id: 2, val: null },
            { id: 3, val: 5 },
            { id: 4, val: undefined },
            { id: 5, val: 20 }
        ];

        // DEFAULT / STANDARD MODE
        
        it('should treat nulls as lowest value in Standard mode (ASC -> Nulls First)', () => {
            // Default is 'standard'
            const result = orderList(mixedData, { key: 'val' as any, direction: 'asc' });
            
            const values = result.map(i => i.val);
            console.log(values);
            // Expect [null, undefined, 5, 10, 20] (order of null/undefined relative to each other doesn't matter, but they must be first)
            expect(values.slice(0, 2)).toContain(null);
            expect(values.slice(0, 2)).toContain(undefined);
            expect(values.slice(2)).toEqual([5, 10, 20]);
        });

        it('should treat nulls as lowest value in Standard mode (DESC -> Nulls Last)', () => {
            const result = orderList(mixedData, { key: 'val' as any, direction: 'desc' });
            
            const values = result.map(i => i.val);
            // Expect [20, 10, 5, null, undefined]
            expect(values.slice(0, 3)).toEqual([20, 10, 5]);
            expect(values.slice(3)).toContain(null);
            expect(values.slice(3)).toContain(undefined);
        });

        // ALWAYS-LAST MODE

        it('should keep nulls at the bottom in "always-last" mode (ASC)', () => {
            const result = orderList(mixedData, { 
                key: 'val' as any, 
                direction: 'asc',
                
            }, {
                nulls: 'always-last'
            });
            
            const values = result.map(i => i.val);
            // Expect [5, 10, 20, null, undefined]
            expect(values.slice(0, 3)).toEqual([5, 10, 20]);
            expect(values.slice(3)).toContain(null);
        });

        it('should keep nulls at the bottom in "always-last" mode (DESC)', () => {
            const result = orderList(mixedData, { 
                key: 'val' as any, 
                direction: 'desc',
                
            }, {
                nulls: 'always-last'
            });
            
            const values = result.map(i => i.val);
            // Expect [20, 10, 5, null, undefined]
            expect(values.slice(0, 3)).toEqual([20, 10, 5]);
            expect(values.slice(3)).toContain(null);
        });

        it('should handle missing keys as undefined', () => {
            const brokenData: any[] = [
                { id: 1, name: 'A' },
                { id: 2 }, // Missing name
                { id: 3, name: 'B' }
            ];
            
            // Standard Asc: Undefined is lowest -> First
            const result = orderList(brokenData, { key: 'name', direction: 'asc'}, {nulls: 'standard'});
            
            expect(result[0].id).toBe(2); // Undefined
            expect(result[1].id).toBe(1); // A
            expect(result[2].id).toBe(3); // B
        });
    });

    describe('Type Safety Tests (Compile check logic)', () => {
        it('should work with valid PrimaryKey types', () => {
            const data = [{ a: 1 }, { a: 2 }];
            // This should compile
            const res = orderList(data, { key: 'a' });
            expect(res).toHaveLength(2);
        });

        // Note: Failure to compile invalid keys is tested by the TS compiler,
        // but at runtime, we ensure it doesn't crash.
        it('should gracefully handle runtime type mismatch', () => {
            const data = [{ a: '10' }, { a: 2 }]; // Mixed string/number
            
            // In JS, "10" > 2 is false (string comparison) if both strings, 
            // but here types are mixed.
            // "10" (string) vs 2 (number).
            // > operator in JS: '10' > 2 is true (converts string to number).
            
            const result = orderList(data as any, { key: 'a', direction: 'asc' });
            // 2 < 10. 
            expect(result[0]!.a).toBe(2);
            expect(result[1]!.a).toBe('10');
        });
    });
});