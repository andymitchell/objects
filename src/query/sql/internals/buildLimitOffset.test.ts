import { describe, expect, it } from 'vitest';
import { _buildLimitClause, _buildOffsetClause } from './buildLimitOffset.ts';

describe('buildLimitOffset', () => {

    describe('_buildLimitClause', () => {
        it('Postgres uses $1 placeholder', () => {
            const result = _buildLimitClause(10, 'pg');
            expect(result.sql).toBe('$1');
            expect(result.parameters).toEqual([10]);
        });

        it('SQLite uses ? placeholder', () => {
            const result = _buildLimitClause(10, 'sqlite');
            expect(result.sql).toBe('?');
            expect(result.parameters).toEqual([10]);
        });

        it('handles zero limit', () => {
            const result = _buildLimitClause(0, 'pg');
            expect(result.sql).toBe('$1');
            expect(result.parameters).toEqual([0]);
        });
    });

    describe('_buildOffsetClause', () => {
        it('Postgres uses $1 placeholder', () => {
            const result = _buildOffsetClause(20, 'pg');
            expect(result.sql).toBe('$1');
            expect(result.parameters).toEqual([20]);
        });

        it('SQLite uses ? placeholder', () => {
            const result = _buildOffsetClause(20, 'sqlite');
            expect(result.sql).toBe('?');
            expect(result.parameters).toEqual([20]);
        });

        it('handles zero offset', () => {
            const result = _buildOffsetClause(0, 'sqlite');
            expect(result.sql).toBe('?');
            expect(result.parameters).toEqual([0]);
        });
    });
});
