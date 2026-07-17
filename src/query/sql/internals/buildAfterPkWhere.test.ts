import { describe, expect, it } from 'vitest';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import { _buildAfterPkWhereClause } from './buildAfterPkWhere.ts';

const identity = (k: string): DotPropPathConversionResult => ({ success: true, expression: k });
const jsonExpr = (k: string): DotPropPathConversionResult => ({ success: true, expression: `data->>'${k}'` });

describe('buildAfterPkWhere', () => {

    describe('Defense in Depth', () => {
        it('returns error when sort is empty', () => {
            const result = _buildAfterPkWhereClause('abc', [], identity, 'id', 'emails', 'pg');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain('non-empty sort');
            }
        });
    });

    describe('Postgres', () => {
        it('generates correct comparison for single key DESC', () => {
            const result = _buildAfterPkWhereClause(
                'abc',
                [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
                identity, 'id', 'emails', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('date < (SELECT date FROM "emails" WHERE id = $1)');
            expect(result.statement.parameters).toEqual(['abc']);
        });

        it('generates correct comparison for single key ASC', () => {
            const result = _buildAfterPkWhereClause(
                42,
                [{ key: 'name', direction: 1 }, { key: 'id', direction: 1 }],
                identity, 'id', 'users', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('name > (SELECT name FROM "users" WHERE id = $1)');
            expect(result.statement.parameters).toEqual([42]);
        });

        it('uses IS NOT DISTINCT FROM for NULL-safe equality', () => {
            const result = _buildAfterPkWhereClause(
                'abc',
                [{ key: 'a', direction: -1 }, { key: 'b', direction: 1 }, { key: 'id', direction: 1 }],
                identity, 'id', 't', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('IS NOT DISTINCT FROM');
            const orCount = (result.statement.sql.match(/\) OR \(/g) || []).length;
            expect(orCount).toBe(2);
        });

        it('wraps NULL-aware comparison around direction operator', () => {
            const result = _buildAfterPkWhereClause(
                'x',
                [{ key: 'score', direction: -1 }],
                identity, 'id', 't', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('IS NOT NULL');
            expect(result.statement.sql).toContain('IS NULL');
        });
    });

    describe('SQLite', () => {
        it('uses IS for NULL-safe equality', () => {
            const result = _buildAfterPkWhereClause(
                'abc',
                [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
                identity, 'id', 'emails', 'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('IS (SELECT');
            expect(result.statement.sql).not.toContain('IS NOT DISTINCT FROM');
        });

        it('uses ? placeholders', () => {
            const result = _buildAfterPkWhereClause(
                'abc',
                [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
                identity, 'id', 'emails', 'sqlite'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('WHERE id = ?');
            expect(result.statement.sql).not.toContain('$1');
        });
    });

    describe('JSON Column Expressions', () => {
        it('uses pathToSqlExpression for JSON column access', () => {
            const result = _buildAfterPkWhereClause(
                'abc',
                [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
                jsonExpr, "data->>'id'", 'emails', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain("data->>'date'");
            expect(result.statement.sql).toContain("data->>'id'");
        });
    });

    describe('Table Name Quoting', () => {
        it('quotes table names with special characters', () => {
            const result = _buildAfterPkWhereClause(
                'x',
                [{ key: 'id', direction: 1 }],
                identity, 'id', 'user-data', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toContain('"user-data"');
        });
    });

    describe('Error Propagation', () => {
        it('returns errors when pathToSqlExpression fails', () => {
            const failing = (_k: string): DotPropPathConversionResult => ({ success: false, error: { type: 'invalid_path', dotPropPath: 'bad_key', message: 'Bad path' } });
            const result = _buildAfterPkWhereClause(
                'abc',
                [{ key: 'bad_key', direction: 1 }],
                failing, 'id', 'emails', 'pg'
            );
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]!.message).toBe('Bad path');
        });
    });

    describe('Multi-Key Sort', () => {
        it('generates OR chain for mixed ASC/DESC directions', () => {
            const result = _buildAfterPkWhereClause(
                'cursor_pk',
                [
                    { key: 'priority', direction: -1 },
                    { key: 'name', direction: 1 },
                    { key: 'id', direction: 1 },
                ],
                identity, 'id', 'tasks', 'pg'
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            const sql = result.statement.sql;
            expect(sql).toContain('priority < (SELECT priority');
            expect(sql).toContain('name > (SELECT name');
            expect(sql).toContain('id > (SELECT id');
        });
    });
});
