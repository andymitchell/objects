import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { prepareObjectTableQuery } from './prepareObjectTableQuery.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import type { ObjectTableInfo, SortAndSlice } from '../types.ts';

const EmailSchema = z.object({
    id: z.string(),
    date: z.string(),
    sender: z.string(),
    priority: z.number().optional(),
});
type Email = z.infer<typeof EmailSchema>;

const table: ObjectTableInfo<Email> = {
    tableName: 'emails',
    objectColumnName: 'data',
    ddl: { primary_key: 'id' },
    schema: EmailSchema,
};

describe('prepareObjectTableQuery', () => {
    describe('sort only', () => {
        it('generates ORDER BY for Postgres with PK tiebreaker', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'date', direction: -1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.order_by_statement).toContain('DESC NULLS LAST');
            expect(result.order_by_statement).toContain('ASC NULLS LAST'); // PK tiebreaker
            expect(result.where_statement).toBeNull();
            expect(result.limit_statement).toBeNull();
        });

        it('generates ORDER BY for SQLite with NULLS LAST simulation', () => {
            const result = prepareObjectTableQuery('sqlite', table, undefined, {
                sort: [{ key: 'date', direction: -1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.order_by_statement).toContain('IS NULL ASC');
            expect(result.order_by_statement).toContain('DESC');
        });

        it('does not add PK tiebreaker when PK is already the last sort key', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            // Should only have two ORDER BY entries, not three
            const parts = result.order_by_statement!.split(',');
            expect(parts.length).toBe(2);
        });
    });

    describe('limit and offset', () => {
        it('generates LIMIT clause with Postgres placeholders', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, { limit: 20 });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.limit_statement).toEqual({
                where_clause_statement: '$1',
                statement_arguments: [20],
            });
        });

        it('generates OFFSET clause with SQLite placeholders', () => {
            const result = prepareObjectTableQuery('sqlite', table, undefined, { offset: 40 } as SortAndSlice<Email>);
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.offset_statement).toEqual({
                where_clause_statement: '?',
                statement_arguments: [40],
            });
        });
    });

    describe('WhereFilterDefinition filter', () => {
        it('builds WHERE from a filter definition for Postgres', () => {
            const result = prepareObjectTableQuery('pg', table, { sender: 'Andy' });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement).not.toBeNull();
            expect(result.where_statement!.where_clause_statement).toContain('$');
            expect(result.where_statement!.statement_arguments).toContain('Andy');
        });

        it('builds WHERE from a filter definition for SQLite', () => {
            const result = prepareObjectTableQuery('sqlite', table, { sender: 'Andy' });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement).not.toBeNull();
            expect(result.where_statement!.where_clause_statement).toContain('?');
            expect(result.where_statement!.statement_arguments).toContain('Andy');
        });
    });

    describe('pre-built WHERE clause', () => {
        it('passes through a pre-built PreparedWhereClauseStatement', () => {
            const prebuilt = { where_clause_statement: 'active = $1', statement_arguments: [true] as any[] };
            const result = prepareObjectTableQuery('pg', table, prebuilt);
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement!.where_clause_statement).toContain('active');
        });
    });

    describe('cursor pagination (after_pk)', () => {
        it('generates cursor WHERE clause for Postgres', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'date', direction: -1 }],
                after_pk: 'email_abc',
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement).not.toBeNull();
            expect(result.where_statement!.statement_arguments).toContain('email_abc');
            expect(result.where_statement!.where_clause_statement).toContain('SELECT');
        });

        it('generates cursor WHERE clause for SQLite', () => {
            const result = prepareObjectTableQuery('sqlite', table, undefined, {
                sort: [{ key: 'date', direction: -1 }],
                after_pk: 'email_abc',
            });
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement).not.toBeNull();
            expect(result.where_statement!.where_clause_statement).toContain('?');
        });
    });

    describe('composing filter + cursor + additional WHERE clauses', () => {
        it('combines all WHERE sources with AND for Postgres', () => {
            const additional = [
                { where_clause_statement: 'archived = $1', statement_arguments: [false] as any[] },
            ];
            const result = prepareObjectTableQuery('pg', table,
                { sender: 'Andy' },
                { sort: [{ key: 'date', direction: -1 }], after_pk: 'x', limit: 10 },
                additional
            );
            expect(result.success).toBe(true);
            if (!result.success) return;

            // WHERE should combine filter + cursor + additional
            expect(result.where_statement).not.toBeNull();
            const sql = result.where_statement!.where_clause_statement;
            expect(sql).toContain('AND');
            // All parameters should be collected
            expect(result.where_statement!.statement_arguments.length).toBeGreaterThan(1);
        });
    });

    describe('validation errors', () => {
        it('returns error for mutually exclusive offset and after_pk', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'date', direction: -1 }],
                offset: 10,
                after_pk: 'x',
            } as any);
            expect(result.success).toBe(false);
            if (result.success) return;

            expect(result.errors[0]!.message).toContain('mutually exclusive');
        });

        it('returns error for after_pk without sort', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                after_pk: 'x',
            } as any);
            expect(result.success).toBe(false);
        });
    });

    describe('no sortAndSlice', () => {
        it('returns all null clauses when no sortAndSlice provided', () => {
            const result = prepareObjectTableQuery('pg', table);
            expect(result.success).toBe(true);
            if (!result.success) return;

            expect(result.where_statement).toBeNull();
            expect(result.order_by_statement).toBeNull();
            expect(result.limit_statement).toBeNull();
            expect(result.offset_statement).toBeNull();
        });
    });

    describe('flattenQueryClausesToSql integration', () => {
        it('produces a complete SQL fragment for Postgres', () => {
            const result = prepareObjectTableQuery('pg', table,
                { sender: 'Andy' },
                { sort: [{ key: 'date', direction: -1 }], limit: 20 }
            );
            expect(result.success).toBe(true);
            if (!result.success) return;

            const flat = flattenQueryClausesToSql(result, 'pg');
            expect(flat.sql).toContain('WHERE');
            expect(flat.sql).toContain('ORDER BY');
            expect(flat.sql).toContain('LIMIT');
            expect(flat.parameters.length).toBeGreaterThan(0);
        });

        it('produces a complete SQL fragment for SQLite', () => {
            const result = prepareObjectTableQuery('sqlite', table,
                { sender: 'Andy' },
                { sort: [{ key: 'date', direction: -1 }], limit: 20, offset: 0 }
            );
            expect(result.success).toBe(true);
            if (!result.success) return;

            const flat = flattenQueryClausesToSql(result, 'sqlite');
            expect(flat.sql).toContain('WHERE');
            expect(flat.sql).toContain('ORDER BY');
            expect(flat.sql).toContain('LIMIT');
            expect(flat.sql).toContain('OFFSET');
        });

        it('rebases Postgres parameter numbers correctly across clauses', () => {
            const result = prepareObjectTableQuery('pg', table,
                { sender: 'Andy' },
                { sort: [{ key: 'date', direction: -1 }], limit: 20 }
            );
            expect(result.success).toBe(true);
            if (!result.success) return;

            const flat = flattenQueryClausesToSql(result, 'pg');
            // The LIMIT parameter should be rebased above the WHERE parameters
            const limitMatch = flat.sql.match(/LIMIT \$(\d+)/);
            expect(limitMatch).not.toBeNull();
            const limitParamIndex = parseInt(limitMatch![1]!, 10);
            expect(limitParamIndex).toBeGreaterThan(1); // Must be rebased above WHERE params
            expect(flat.parameters[limitParamIndex - 1]).toBe(20);
        });
    });
});
