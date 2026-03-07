import { describe, expect, it } from 'vitest';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import { _buildOrderByClause } from './buildOrderByClause.ts';

const identity = (k: string): DotPropPathConversionResult => ({ success: true, expression: k });
const jsonExpr = (k: string): DotPropPathConversionResult => ({ success: true, expression: `data->>'${k}'` });

describe('_buildOrderByClause', () => {
    describe('Postgres', () => {
        it('generates ASC with NULLS LAST for a single ascending key', () => {
            const result = _buildOrderByClause(
                [{ key: 'name', direction: 1 }],
                identity,
                'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('name ASC NULLS LAST');
        });

        it('generates DESC with NULLS LAST for a single descending key', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }],
                identity,
                'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('date DESC NULLS LAST');
        });

        it('joins multiple sort keys with commas', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }, { key: 'name', direction: 1 }],
                identity,
                'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('date DESC NULLS LAST, name ASC NULLS LAST');
        });

        it('uses pathToSqlExpression for JSON column access', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }],
                jsonExpr,
                'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe("data->>'date' DESC NULLS LAST");
        });
    });

    describe('SQLite', () => {
        it('simulates NULLS LAST via IS NULL prefix for ascending', () => {
            const result = _buildOrderByClause(
                [{ key: 'name', direction: 1 }],
                identity,
                'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('name IS NULL ASC, name ASC');
        });

        it('simulates NULLS LAST via IS NULL prefix for descending', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }],
                identity,
                'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('date IS NULL ASC, date DESC');
        });

        it('joins multiple sort keys with IS NULL pairs', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }, { key: 'name', direction: 1 }],
                identity,
                'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('date IS NULL ASC, date DESC, name IS NULL ASC, name ASC');
        });

        it('uses pathToSqlExpression for JSON column access', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }],
                jsonExpr,
                'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe("data->>'date' IS NULL ASC, data->>'date' DESC");
        });
    });

    describe('error propagation', () => {
        it('returns errors when pathToSqlExpression fails', () => {
            const failing = (_k: string): DotPropPathConversionResult => ({ success: false, error: 'Unknown path' });
            const result = _buildOrderByClause(
                [{ key: 'bad_key', direction: 1 }],
                failing,
                'pg'
            );
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]!.message).toBe('Unknown path');
        });
    });
});
