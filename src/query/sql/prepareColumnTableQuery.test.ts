import { describe, expect, it } from 'vitest';
import { prepareColumnTableQuery } from './prepareColumnTableQuery.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import type { ColumnTableInfo } from '../types.ts';

const table: ColumnTableInfo = {
    tableName: 'users',
    pkColumnName: 'id',
    allowedColumns: ['id', 'created_at', 'name', 'email'],
};

describe('prepareColumnTableQuery', () => {
    describe('sort only', () => {
        it('generates ORDER BY with PK tiebreaker for Postgres', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.order_by_statement).toContain('"created_at" DESC NULLS LAST');
            expect(result.order_by_statement).toContain('"id" ASC NULLS LAST');
        });

        it('generates ORDER BY for SQLite', () => {
            const result = prepareColumnTableQuery('sqlite', table, {
                sort: [{ key: 'name', direction: 1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.order_by_statement).toContain('"name" IS NULL ASC');
            expect(result.order_by_statement).toContain('"name" ASC');
        });
    });

    describe('allowedColumns validation', () => {
        it('returns error when sort key is not in allowedColumns', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'unknown_column', direction: 1 }],
            });
            expect(result.success).toBe(false);
            if (result.success) return;

            expect(result.errors[0]!.type).toBe('invalid_column');
            expect(result.errors[0]!.message).toContain('unknown_column');
        });

        it('validates PK tiebreaker against allowedColumns too', () => {
            const badTable: ColumnTableInfo = {
                tableName: 'bad',
                pkColumnName: 'pk_not_allowed',
                allowedColumns: ['name'],
            };
            const result = prepareColumnTableQuery('pg', badTable, {
                sort: [{ key: 'name', direction: 1 }],
            });
            expect(result.success).toBe(false);
            if (result.success) return;

            expect(result.errors[0]!.message).toContain('pk_not_allowed');
        });

        it('accepts all valid sort keys', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }, { key: 'name', direction: 1 }],
            });
            expect(result.success).toBe(true);
        });
    });

    describe('limit and offset', () => {
        it('generates LIMIT and OFFSET for Postgres', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
                limit: 50,
                offset: 100,
            } as any);
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.limit_statement).not.toBeNull();
            expect(result.offset_statement).not.toBeNull();
        });
    });

    describe('cursor pagination', () => {
        it('generates cursor WHERE clause for Postgres', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
                after_pk: 'user_123',
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement).not.toBeNull();
            expect(result.where_statement!.statement_arguments).toContain('user_123');
        });

        it('combines cursor with additional WHERE clauses', () => {
            const additional = [
                { where_clause_statement: 'active = $1', statement_arguments: [true] as any[] },
            ];
            const result = prepareColumnTableQuery('pg', table,
                { sort: [{ key: 'created_at', direction: -1 }], after_pk: 'user_123', limit: 20 },
                additional
            );
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement!.where_clause_statement).toContain('AND');
        });
    });

    describe('validation errors', () => {
        it('returns error for mutually exclusive offset and after_pk', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
                offset: 10,
                after_pk: 'x',
            } as any);
            expect(result.success).toBe(false);
        });

        it('returns error for negative limit', () => {
            const result = prepareColumnTableQuery('pg', table, { limit: -1 } as any);
            expect(result.success).toBe(false);
        });
    });

    describe('flattenQueryClausesToSql integration', () => {
        it('produces a complete SQL fragment', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
                limit: 50,
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            const flat = flattenQueryClausesToSql(result, 'pg');
            expect(flat.sql).toContain('ORDER BY');
            expect(flat.sql).toContain('LIMIT');
            expect(flat.parameters).toContain(50);
        });

        it('handles empty query (no sort, just limit)', () => {
            const result = prepareColumnTableQuery('pg', table, { limit: 10 });
            expect(result.success).toBe(true);
            if (!result.success) return;

            const flat = flattenQueryClausesToSql(result, 'pg');
            expect(flat.sql).toContain('LIMIT');
            expect(flat.sql).not.toContain('ORDER BY');
            expect(flat.sql).not.toContain('WHERE');
        });
    });
});
