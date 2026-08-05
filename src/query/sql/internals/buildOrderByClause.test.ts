import { describe, expect, it } from 'vitest';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import { _buildOrderByClause } from './buildOrderByClause.ts';

const identity = (k: string): DotPropPathConversionResult => ({ success: true, expression: k });
const jsonExpr = (k: string): DotPropPathConversionResult => ({ success: true, expression: `data->>'${k}'` });

describe('buildOrderByClause', () => {

    describe('Postgres', () => {
        it('generates ASC/DESC with NULLS LAST', () => {
            const ascResult = _buildOrderByClause([{ key: 'name', direction: 1 }], identity, 'pg');
            expect(ascResult.success).toBe(true);
            if (!ascResult.success) return;
            expect(ascResult.orderBy).toBe('name ASC NULLS LAST');

            const descResult = _buildOrderByClause([{ key: 'date', direction: -1 }], identity, 'pg');
            expect(descResult.success).toBe(true);
            if (!descResult.success) return;
            expect(descResult.orderBy).toBe('date DESC NULLS LAST');
        });

        it('joins multiple keys with commas', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }, { key: 'name', direction: 1 }],
                identity, 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('date DESC NULLS LAST, name ASC NULLS LAST');
        });

        it('uses pathToSqlExpression for JSON column access', () => {
            const result = _buildOrderByClause(
                [{ key: 'sender.name', direction: 1 }],
                jsonExpr, 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe("data->>'sender.name' ASC NULLS LAST");
        });
    });

    describe('SQLite', () => {
        it('generates ASC/DESC with NULLS LAST', () => {
            const result = _buildOrderByClause([{ key: 'name', direction: 1 }], identity, 'sqlite');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('name ASC NULLS LAST');
        });

        it('joins multiple keys with commas', () => {
            const result = _buildOrderByClause(
                [{ key: 'date', direction: -1 }, { key: 'name', direction: 1 }],
                identity, 'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe('date DESC NULLS LAST, name ASC NULLS LAST');
        });

        it('uses pathToSqlExpression for JSON column access', () => {
            const result = _buildOrderByClause(
                [{ key: 'sender.name', direction: 1 }],
                jsonExpr, 'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.orderBy).toBe("data->>'sender.name' ASC NULLS LAST");
        });
    });

    describe('Error Propagation', () => {
        it('returns errors when pathToSqlExpression fails', () => {
            const failing = (_k: string): DotPropPathConversionResult => ({ success: false, error: { type: 'unknown_path', dotPropPath: 'bad_key', message: 'Unknown path' } });
            const result = _buildOrderByClause(
                [{ key: 'bad_key', direction: 1 }], failing, 'pg'
            );
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]!.message).toBe('Unknown path');
        });
    });
});
