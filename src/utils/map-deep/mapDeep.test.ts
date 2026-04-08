import { describe, test, expect } from 'vitest';
import { mapDeep } from './mapDeep.ts';
import type { MapDeepInputRule, MapDeepValueRule } from './types.ts';

describe('mapDeep', () => {

    describe('replace-value', () => {

        test('replaces a string leaf that exactly equals current', () => {
            const obj = { name: '<USEREMAIL>', other: 'keep' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: '<USEREMAIL>', replace: 'alice@example.com' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ name: 'alice@example.com', other: 'keep' });
        });

        test('replaces numeric, boolean, and null leaves', () => {
            const obj = { a: 42, b: true, c: null, d: 'untouched' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 42, replace: 0 },
                { action: 'replace-value', current: true, replace: false },
                { action: 'replace-value', current: null, replace: 'filled' },
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ a: 0, b: false, c: 'filled', d: 'untouched' });
        });

        test('does not replace when value does not match', () => {
            const obj = { a: 'keep', b: 123 };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'missing', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toBe(obj);
        });

        test('replaces deeply nested matching values', () => {
            const obj = { a: { b: { c: { d: '<TOKEN>' } } } };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: '<TOKEN>', replace: 'real-token' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ a: { b: { c: { d: 'real-token' } } } });
        });

        test('replaces matching values inside arrays', () => {
            const obj = { items: ['<X>', 'keep', '<X>'] };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: '<X>', replace: 'done' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ items: ['done', 'keep', 'done'] });
        });

    });

    describe('structural sharing and immutability', () => {

        test('returns same reference when no rule matches (identity invariant)', () => {
            const obj = { a: 1, nested: { b: 'hello' } };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'nonexistent', replace: 'x' }
            ];
            expect(mapDeep(obj, rules)).toBe(obj);
        });

        test('empty rules returns same reference (identity invariant)', () => {
            const obj = { a: 1, nested: { b: 'hello' } };
            expect(mapDeep(obj, [])).toBe(obj);
        });

        test('returns new root reference when a change occurs', () => {
            const obj = { a: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).not.toBe(obj);
            expect(result).toEqual({ a: 'new' });
        });

        test('original object is never mutated (frozen input)', () => {
            const obj = Object.freeze({
                a: Object.freeze({ b: Object.freeze({ c: 'old' }) }),
                d: Object.freeze(['old', 'keep'])
            });
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            // Should not throw — mapDeep never mutates
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ a: { b: { c: 'new' } }, d: ['new', 'keep'] });
        });

        test('only nodes along the dirty path are new references', () => {
            const clean = { x: 1, y: 2 };
            const dirty = { z: 'old' };
            const obj = { clean, dirty };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).not.toBe(obj);
            expect(result.clean).toBe(clean); // unchanged subtree — same ref
            expect(result.dirty).not.toBe(dirty); // changed subtree — new ref
        });

        test('unchanged sibling subtrees retain their reference', () => {
            const sibling1 = { deep: { value: 'untouched' } };
            const sibling2 = { deep: { value: 'old' } };
            const sibling3 = { deep: { value: 'also untouched' } };
            const obj = { sibling1, sibling2, sibling3 };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            expect(result.sibling1).toBe(sibling1);
            expect(result.sibling2).not.toBe(sibling2);
            expect(result.sibling3).toBe(sibling3);
        });

        test('unchanged array elements retain their reference', () => {
            const elem0 = { name: 'keep' };
            const elem1 = { name: 'old' };
            const elem2 = { name: 'also keep' };
            const obj = { items: [elem0, elem1, elem2] };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            expect(result.items[0]).toBe(elem0);
            expect(result.items[1]).not.toBe(elem1);
            expect(result.items[2]).toBe(elem2);
        });

        test('idempotent — applying rules twice produces same result as once', () => {
            const obj = { a: '<X>', b: { c: '<X>', d: 'keep' }, e: [1, '<X>'] };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: '<X>', replace: 'done' }
            ];
            const once = mapDeep(obj, rules);
            const twice = mapDeep(once, rules);
            expect(twice).toEqual(once);
            // Second application should be a no-op — same reference
            expect(twice).toBe(once);
        });

        test('reversible — replace A→B then B→A restores original structure', () => {
            const obj = { a: 'A', b: { c: 'A', d: 'other' } };
            const forward: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'A', replace: 'B' }
            ];
            const reverse: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'B', replace: 'A' }
            ];
            const result = mapDeep(mapDeep(obj, forward), reverse);
            expect(result).toEqual(obj);
        });

    });

    describe('target resolution', () => {

        test('target.key — only applies rule to value under the targeted key', () => {
            const obj = { name: 'old', label: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { key: 'name' } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ name: 'new', label: 'old' });
        });

        test('target.key — matches at any depth', () => {
            const obj = { a: { b: { name: 'old' } }, name: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { key: 'name' } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ a: { b: { name: 'new' } }, name: 'new' });
        });

        test('target.search_key string — matches keys containing substring', () => {
            const obj = { user_name: 'old', display_name: 'old', id: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { search_key: 'name' } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ user_name: 'new', display_name: 'new', id: 'old' });
        });

        test('target.search_key RegExp — matches keys by pattern', () => {
            const obj = { email_1: 'old', email_2: 'old', phone: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { search_key: { pattern: 'email_\\d+', flags: '' } } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ email_1: 'new', email_2: 'new', phone: 'old' });
        });

        test('target.dotprop_path — applies only at the exact path', () => {
            const obj = {
                config: { auth: { provider: 'old' } },
                auth: { provider: 'old' }
            };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { dotprop_path: 'config.auth.provider' } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({
                config: { auth: { provider: 'new' } },
                auth: { provider: 'old' }
            });
        });

        test('target.dotprop_path — handles array indices (items.0.name)', () => {
            const obj = { items: [{ name: 'old' }, { name: 'old' }] };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { dotprop_path: 'items.0.name' } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ items: [{ name: 'new' }, { name: 'old' }] });
        });

    });

    describe('replace-in-string-value', () => {

        test('replaces substring in a string leaf', () => {
            const obj = { url: 'http://localhost:3000/api' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-in-string-value', search: 'localhost:3000', replace: 'prod.example.com' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ url: 'http://prod.example.com/api' });
        });

        test('does not modify non-string leaves', () => {
            const obj = { count: 42, flag: true, empty: null };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-in-string-value', search: '42', replace: '0' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toBe(obj);
        });

        test('replaces only first occurrence with plain string search', () => {
            const obj = { text: 'aaa' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-in-string-value', search: 'a', replace: 'b' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ text: 'baa' });
        });

        test('replaces all occurrences when regex uses g flag', () => {
            const obj = { text: 'aaa' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-in-string-value', search: { pattern: 'a', flags: 'g' }, replace: 'b' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ text: 'bbb' });
        });

        test('supports regex capture groups in replacement', () => {
            const obj = { date: '2024-01-15' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-in-string-value', search: { pattern: '(\\d{4})-(\\d{2})', flags: '' }, replace: '$2/$1' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ date: '01/2024-15' });
        });

    });

    describe('rename-key', () => {

        test('renames an exact-match key at top level', () => {
            const obj = { old_name: 1, other: 2 };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { key: 'old_name' }, rename_to: 'new_name' }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ new_name: 1, other: 2 });
        });

        test('renames a nested key', () => {
            const obj = { config: { old_name: 'value' } };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { key: 'old_name' }, rename_to: 'new_name' }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ config: { new_name: 'value' } });
        });

        test('preserves subtree under renamed key', () => {
            const obj = { old_name: { deep: { nested: 'value' }, arr: [1, 2] } };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { key: 'old_name' }, rename_to: 'new_name' }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ new_name: { deep: { nested: 'value' }, arr: [1, 2] } });
        });

        test('first-match only — second matching key in same object untouched', () => {
            const obj = { name_a: 1, name_b: 2, other: 3 };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { search_key: 'name_' }, rename_to: 'renamed' }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            // First matching key (name_a) is renamed, name_b is untouched
            expect(result).toHaveProperty('renamed', 1);
            expect(result).toHaveProperty('name_b', 2);
            expect(result).not.toHaveProperty('name_a');
        });

        test('with dotprop_path — renames only at specified path', () => {
            const obj = { a: { name: 'value' }, b: { name: 'value' } };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { dotprop_path: 'a.name' }, rename_to: 'label' }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ a: { label: 'value' }, b: { name: 'value' } });
        });

    });

    describe('remove-key', () => {

        test('removes a key from top level', () => {
            const obj = { keep: 1, remove: 2 };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { key: 'remove' } }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ keep: 1 });
        });

        test('removes a nested key and its subtree', () => {
            const obj = { a: { keep: 1, debug: { verbose: true, data: [1, 2, 3] } } };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { key: 'debug' } }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ a: { keep: 1 } });
        });

        test('first-match only by default', () => {
            const obj = { meta_a: 1, meta_b: 2, other: 3 };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { search_key: 'meta_' } }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            // Only first matching key removed
            expect(result).not.toHaveProperty('meta_a');
            expect(result).toHaveProperty('meta_b', 2);
            expect(result).toHaveProperty('other', 3);
        });

        test('all: true removes every matching key', () => {
            const obj = { meta_a: 1, meta_b: 2, other: 3 };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { search_key: 'meta_' }, all: true }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ other: 3 });
        });

        test('with dotprop_path — removes only at specified path', () => {
            const obj = { a: { debug: 1 }, b: { debug: 2 } };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { dotprop_path: 'a.debug' } }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ a: {}, b: { debug: 2 } });
        });

    });

    describe('multi-rule sequential application', () => {

        test('earlier rule output feeds into later rules', () => {
            const obj = { x: 'a' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'a', replace: 'b' },
                { action: 'replace-value', current: 'b', replace: 'c' },
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ x: 'c' });
        });

        test('rename then replace-value on renamed key', () => {
            const obj = { old: 'value' };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { key: 'old' }, rename_to: 'new' },
                { action: 'replace-value', current: 'value', replace: 'updated', target: { key: 'new' } },
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ new: 'updated' });
        });

        test('remove then replace-value works on remaining tree', () => {
            const obj = { remove_me: 'x', keep: 'old' };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { key: 'remove_me' } },
                { action: 'replace-value', current: 'old', replace: 'new' },
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ keep: 'new' });
        });

        test('rule order matters — swapping two rules produces different output', () => {
            const obj = { x: 'a' };
            const rulesAB: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'a', replace: 'b' },
                { action: 'replace-value', current: 'b', replace: 'c' },
            ];
            const rulesBA: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'b', replace: 'c' },
                { action: 'replace-value', current: 'a', replace: 'b' },
            ];
            const resultAB = mapDeep(obj, rulesAB);
            const resultBA = mapDeep(obj, rulesBA);
            // AB: a→b→c, BA: a→b (first rule doesn't match, second does)
            expect(resultAB).toEqual({ x: 'c' });
            expect(resultBA).toEqual({ x: 'b' });
            expect(resultAB).not.toEqual(resultBA);
        });

    });

    describe('forbidden states', () => {

        test('key rules never fire on array elements', () => {
            const obj = { items: ['a', 'b', 'c'] };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { key: '0' } },
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            // Array should be unchanged — key rules don't apply to arrays
            expect(result.items).toEqual(['a', 'b', 'c']);
            expect(result).toBe(obj);
        });

        test('non-plain objects (Date, RegExp, class instances) pass through by reference', () => {
            const date = new Date('2024-01-01');
            const regex = /test/g;
            class Custom { value = 'hello'; }
            const custom = new Custom();
            const obj = { date, regex, custom, normal: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' },
            ];
            const result = mapDeep(obj, rules);
            expect(result.date).toBe(date);
            expect(result.regex).toBe(regex);
            expect(result.custom).toBe(custom);
            expect(result.normal).toBe('new');
        });

        test('rename to __proto__ / constructor / prototype is blocked', () => {
            for (const dangerous of ['__proto__', 'constructor', 'prototype']) {
                const obj = { safe_key: 'value' };
                const rules: MapDeepInputRule[] = [
                    { action: 'rename-key', target: { key: 'safe_key' }, rename_to: dangerous }
                ];
                const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
                // Rename should be blocked — original key preserved
                expect(result).toHaveProperty('safe_key', 'value');
                expect(result).toBe(obj);
            }
        });

        test('rename causing key collision overwrites existing key', () => {
            const obj = { a: 1, b: 2 };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { key: 'a' }, rename_to: 'b' }
            ];
            const result = mapDeep<typeof obj, Record<string, unknown>>(obj, rules);
            expect(result).toEqual({ b: 1 });
        });

    });

    describe('edge cases', () => {

        test('empty object returns same reference', () => {
            const obj = {};
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'x', replace: 'y' }
            ];
            expect(mapDeep(obj, rules)).toBe(obj);
        });

        test('primitive root input is transformed by value rules', () => {
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            expect(mapDeep('old', rules)).toBe('new');
            expect(mapDeep('keep', rules)).toBe('keep');
            expect(mapDeep(42, rules)).toBe(42);
        });

        test('deeply nested arrays are traversed', () => {
            const obj = [[['old']]];
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            expect(mapDeep(obj, rules)).toEqual([[['new']]]);
        });

        test('empty string key is handled correctly', () => {
            const obj = { '': 'old', normal: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new', target: { key: '' } }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ '': 'new', normal: 'old' });
        });

        test('key named "length" is handled correctly', () => {
            const obj = { length: 'old', other: 'old' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            expect(result).toEqual({ length: 'new', other: 'new' });
        });

        test('replace-value with same current/replace returns same ref (no-op)', () => {
            const obj = { a: 'same' };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'same', replace: 'same' }
            ];
            expect(mapDeep(obj, rules)).toBe(obj);
        });

    });

    describe('type narrowing', () => {

        test('value-only rules return T', () => {
            const obj = { name: 'old', count: 1 };
            const rules: MapDeepValueRule[] = [
                { action: 'replace-value', current: 'old', replace: 'new' }
            ];
            const result = mapDeep(obj, rules);
            // Compile-time: result should be typeof obj
            const _check: typeof obj = result;
            expect(_check).toBeDefined();
        });

        test('key-modifying rules return T by default', () => {
            const obj = { name: 'value' };
            const rules: MapDeepInputRule[] = [
                { action: 'remove-key', target: { key: 'name' } }
            ];
            const result = mapDeep(obj, rules);
            // R defaults to T — caller specifies R explicitly when shape changes
            const _check: typeof obj = result;
            expect(_check).toBeDefined();
        });

        test('caller can specify R for key-modifying rules', () => {
            type Input = { old_key: string; keep: number };
            type Output = { new_key: string; keep: number };
            const obj: Input = { old_key: 'value', keep: 1 };
            const rules: MapDeepInputRule[] = [
                { action: 'rename-key', target: { key: 'old_key' }, rename_to: 'new_key' }
            ];
            const result = mapDeep<Input, Output>(obj, rules);
            // Compile-time: result is Output
            const _check: Output = result;
            expect(_check.new_key).toBe('value');
        });

    });

});
