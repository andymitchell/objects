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

    // NOTE: standardTests are NOT called here — they belong in the per-dialect
    // adapter test files (prepareColumnTableQuery.sqlite.test.ts / .pg.test.ts)
    // which create an in-memory DB, insert items, execute clauses, and return objects.

    // --- Per-file only ---

    describe('Input Validation', () => {

        describe('Sort Key Allowlist', () => {
            it('returns error when sort key is not in allowedColumns', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'secret_col', direction: 1 }],
                });
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('invalid_column');
                expect(result.errors[0]!.message).toContain('secret_col');
            });

            it('succeeds when all sort keys are in allowedColumns', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'created_at', direction: -1 }, { key: 'name', direction: 1 }],
                });
                expect(result.success).toBe(true);
            });

            it('validates PK tiebreaker column is allowed', () => {
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
        });

        it('returns error for invalid SortAndSlice', () => {
            const result = prepareColumnTableQuery('pg', table, { limit: -1 } as any);
            expect(result.success).toBe(false);
        });

        it('returns error for negative limit', () => {
            const result = prepareColumnTableQuery('pg', table, { limit: -1 } as any);
            expect(result.success).toBe(false);
        });
    });

    describe('ORDER BY Generation', () => {

        describe('Column Names Direct', () => {
            it('uses column names directly without JSON path extraction', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'created_at', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"created_at"');
            });

            it('handles multiple sort columns', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'name', direction: 1 }, { key: 'created_at', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"name"');
                expect(result.order_by_statement).toContain('"created_at"');
            });
        });

        describe('NULLS LAST', () => {
            it('includes NULLS LAST for Postgres', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'created_at', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('NULLS LAST');
            });

            it('simulates NULLS LAST for SQLite', () => {
                const result = prepareColumnTableQuery('sqlite', table, {
                    sort: [{ key: 'name', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('IS NULL');
            });
        });

        describe('PK Tiebreaker', () => {
            it('appends PK column as last ORDER BY when not already present', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'name', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                const parts = result.order_by_statement!.split(',').map(s => s.trim());
                const lastPart = parts[parts.length - 1]!;
                expect(lastPart).toContain('"id"');
                expect(lastPart).toContain('ASC');
            });

            it('does not duplicate when PK is already last sort key', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'name', direction: 1 }, { key: 'id', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                const parts = result.order_by_statement!.split(',');
                expect(parts.length).toBe(2);
            });
        });

        describe('Reserved Word / Special Char Quoting', () => {
            it('quotes column names that are SQL reserved words', () => {
                const reservedTable: ColumnTableInfo = {
                    tableName: 'items',
                    pkColumnName: 'id',
                    allowedColumns: ['id', 'order'],
                };
                const result = prepareColumnTableQuery('pg', reservedTable, {
                    sort: [{ key: 'order', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"order"');
            });

            it('quotes column names with special characters', () => {
                const specialTable: ColumnTableInfo = {
                    tableName: 'items',
                    pkColumnName: 'id',
                    allowedColumns: ['id', 'user-name'],
                };
                const result = prepareColumnTableQuery('pg', specialTable, {
                    sort: [{ key: 'user-name', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"user-name"');
            });
        });
    });

    describe('WHERE Composition', () => {
        it('composes pre-built WHERE clauses with AND', () => {
            const clauses = [
                { where_clause_statement: 'active = $1', statement_arguments: [true] as any[] },
                { where_clause_statement: 'org_id = $1', statement_arguments: ['org1'] as any[] },
            ];
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
            }, clauses);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.where_statement!.where_clause_statement).toContain('AND');
        });

        it('returns null WHERE when no clauses provided', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.where_statement).toBeNull();
        });
    });

    describe('Cursor Pagination (after_pk)', () => {
        it('generates cursor WHERE for single sort key', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }],
                after_pk: 'user_123',
            });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.where_statement).not.toBeNull();
            expect(result.where_statement!.statement_arguments).toContain('user_123');
        });

        it('generates lexicographic cursor WHERE for multi-key sort', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'name', direction: 1 }, { key: 'created_at', direction: -1 }],
                after_pk: 'user_123',
            });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.where_statement!.where_clause_statement).toContain('OR');
        });
    });

    describe('LIMIT / OFFSET', () => {
        it('generates parameterised LIMIT', () => {
            const result = prepareColumnTableQuery('pg', table, { limit: 50 });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.limit_statement).not.toBeNull();
            expect(result.limit_statement!.statement_arguments).toContain(50);
        });

        it('generates parameterised OFFSET', () => {
            const result = prepareColumnTableQuery('pg', table, { offset: 100 } as any);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.offset_statement).not.toBeNull();
            expect(result.offset_statement!.statement_arguments).toContain(100);
        });
    });

    describe('Parameterisation Safety', () => {
        it('sort keys not in allowedColumns never reach generated SQL', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'injection_col', direction: 1 }],
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Dialect Parity (Postgres / SQLite)', () => {
        it('produces structurally equivalent output for both dialects', () => {
            const sortAndSlice = {
                sort: [{ key: 'created_at' as const, direction: -1 as const }],
                limit: 50,
            };
            const pgResult = prepareColumnTableQuery('pg', table, sortAndSlice);
            const sqliteResult = prepareColumnTableQuery('sqlite', table, sortAndSlice);
            expect(pgResult.success).toBe(true);
            expect(sqliteResult.success).toBe(true);
            if (!pgResult.success || !sqliteResult.success) return;
            expect(pgResult.order_by_statement !== null).toBe(sqliteResult.order_by_statement !== null);
            expect(pgResult.limit_statement !== null).toBe(sqliteResult.limit_statement !== null);
        });
    });

    describe('Invariants', () => {
        it('ORDER BY always ends with PK column', () => {
            const result = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'name', direction: 1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;
            const parts = result.order_by_statement!.split(',').map(s => s.trim());
            const lastPart = parts[parts.length - 1]!;
            expect(lastPart).toContain('"id"');
        });

        it('same input produces identical output', () => {
            const r1 = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }], limit: 10
            });
            const r2 = prepareColumnTableQuery('pg', table, {
                sort: [{ key: 'created_at', direction: -1 }], limit: 10
            });
            expect(r1).toEqual(r2);
        });
    });

    // --- DEPRECATED_OLD_TESTS ---
    // these should be safe to remove as replaced
    describe('DEPRECATED_OLD_TESTS', () => {
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
});
