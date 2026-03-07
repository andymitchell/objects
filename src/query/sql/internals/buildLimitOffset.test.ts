import { describe, expect, it } from 'vitest';
import { _buildLimitClause, _buildOffsetClause } from './buildLimitOffset.ts';

describe('_buildLimitClause', () => {
    it('returns $1 placeholder for Postgres', () => {
        const result = _buildLimitClause(20, 'pg');
        expect(result).toEqual({ sql: '$1', parameters: [20] });
    });

    it('returns ? placeholder for SQLite', () => {
        const result = _buildLimitClause(20, 'sqlite');
        expect(result).toEqual({ sql: '?', parameters: [20] });
    });

    it('handles zero limit', () => {
        const result = _buildLimitClause(0, 'pg');
        expect(result).toEqual({ sql: '$1', parameters: [0] });
    });
});

describe('_buildOffsetClause', () => {
    it('returns $1 placeholder for Postgres', () => {
        const result = _buildOffsetClause(40, 'pg');
        expect(result).toEqual({ sql: '$1', parameters: [40] });
    });

    it('returns ? placeholder for SQLite', () => {
        const result = _buildOffsetClause(40, 'sqlite');
        expect(result).toEqual({ sql: '?', parameters: [40] });
    });

    it('handles zero offset', () => {
        const result = _buildOffsetClause(0, 'sqlite');
        expect(result).toEqual({ sql: '?', parameters: [0] });
    });
});
