import { describe, expect, it } from 'vitest';
import { quoteIdentifier } from './quoteIdentifier.ts';

describe('quoteIdentifier', () => {
    it('wraps a simple identifier in double quotes', () => {
        expect(quoteIdentifier('name')).toBe('"name"');
    });

    it('handles reserved words', () => {
        expect(quoteIdentifier('order')).toBe('"order"');
    });

    it('handles special characters', () => {
        expect(quoteIdentifier('user-name')).toBe('"user-name"');
    });

    it('escapes embedded double quotes by doubling them', () => {
        expect(quoteIdentifier('col"name')).toBe('"col""name"');
        expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"');
    });

    it('handles empty string', () => {
        expect(quoteIdentifier('')).toBe('""');
    });
});
