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

    // --- DEPRECATED_OLD_TESTS ---
    // these should be safe to remove as replaced
    describe('DEPRECATED_OLD_TESTS', () => {
        describe('defense-in-depth: empty sort', () => {
            it('returns error when sort is empty', () => {
                const result = _buildAfterPkWhereClause('abc', [], identity, 'id', 'emails', 'pg');
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.errors[0]!.type).toBe('cursor');
                    expect(result.errors[0]!.message).toContain('non-empty sort');
                }
            });
        });

        describe('Postgres dialect', () => {
            it('generates correct SQL for a single sort key (DESC)', () => {
                const result = _buildAfterPkWhereClause(
                    'abc',
                    [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
                    identity, 'id', 'emails', 'pg'
                );
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.statement.parameters).toEqual(['abc']);
                expect(result.statement.sql).toContain('date < (SELECT date FROM "emails" WHERE id = $1)');
                expect(result.statement.sql).toContain('date IS NOT DISTINCT FROM');
                expect(result.statement.sql).toContain('id > (SELECT id FROM "emails" WHERE id = $1)');
            });

            it('generates correct SQL for a single ascending sort key', () => {
                const result = _buildAfterPkWhereClause(
                    42,
                    [{ key: 'name', direction: 1 }, { key: 'id', direction: 1 }],
                    identity, 'id', 'users', 'pg'
                );
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.statement.parameters).toEqual([42]);
                expect(result.statement.sql).toContain('name > (SELECT name FROM "users" WHERE id = $1)');
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

            it('wraps NULL-aware comparison around the direction operator', () => {
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

        describe('SQLite dialect', () => {
            it('uses IS for NULL-safe equality instead of IS NOT DISTINCT FROM', () => {
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

            it('uses ? placeholder for parameters', () => {
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

        describe('JSON column expressions', () => {
            it('uses pathToSqlExpression for sort key SQL generation', () => {
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

        describe('table name quoting', () => {
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

        describe('multi-key sort with mixed directions', () => {
            it('generates correct operators for mixed ASC/DESC sort', () => {
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

        describe('error propagation', () => {
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
    });
});
