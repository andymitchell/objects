import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { prepareObjectTableQuery } from './prepareObjectTableQuery.ts';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import type { ObjectTableInfo, SortAndSlice } from '../types.ts';
import { pgJsonbAccessor } from '../../utils/sql/postgres/pgJsonbAccessor.ts';

const EmailSchema = z.object({
    id: z.string(),
    date: z.string(),
    sender: z.string(),
    priority: z.number().optional(),
    address: z.object({
        city: z.string(),
    }).optional(),
    tags: z.array(z.string()).optional(),
});
type Email = z.infer<typeof EmailSchema>;

const table: ObjectTableInfo<Email> = {
    tableName: 'emails',
    objectColumnName: 'data',
    ddl: { primary_key: 'id' },
    schema: EmailSchema,
};

describe('prepareObjectTableQuery', () => {

    // standardTests run in the per-dialect adapter files (prepareObjectTableQuery.pg.test.ts /
    // prepareObjectTableQuery.sqlite.test.ts), which execute the prepared clauses against real
    // engines. This file inspects the emitted SQL strings themselves.

    // --- Per-file only (SQL output inspection) ---

    describe('Input Validation', () => {
        it('returns error for invalid SortAndSlice', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, { limit: -1 } as any);
            expect(result.success).toBe(false);
        });

        it('returns error for sort key path not in schema', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'nonexistent.path' as any, direction: 1 }],
            });
            expect(result.success).toBe(false);
        });

        describe('Structural Sort Keys Refused', () => {
            // Object- and array-typed sort keys have no cross-backend ordering: Postgres would
            // order jsonb by its btree rules, SQLite by raw JSON text, and the runtime comparator
            // by string form — three different orders. The builders refuse them outright.

            for (const dialect of ['pg', 'sqlite'] as const) {
                it(`returns error when the sort key addresses an object-typed field (${dialect})`, () => {
                    const result = prepareObjectTableQuery(dialect, table, undefined, {
                        sort: [{ key: 'address' as any, direction: 1 }],
                    });
                    expect(result.success).toBe(false);
                    if (result.success) return;
                    expect(result.errors[0]!.type).toBe('unexpected_kind');
                    expect(result.errors[0]!.message).toContain('address');
                });

                it(`returns error when the sort key addresses an array-typed field (${dialect})`, () => {
                    const result = prepareObjectTableQuery(dialect, table, undefined, {
                        sort: [{ key: 'tags' as any, direction: 1 }],
                    });
                    expect(result.success).toBe(false);
                    if (result.success) return;
                    expect(result.errors[0]!.type).toBe('unexpected_kind');
                    expect(result.errors[0]!.message).toContain('tags');
                });

                it(`refuses a structural sort key when cursor pagination is requested (${dialect})`, () => {
                    const result = prepareObjectTableQuery(dialect, table, undefined, {
                        sort: [{ key: 'address' as any, direction: 1 }],
                        after_pk: 'email_1',
                    });
                    expect(result.success).toBe(false);
                    if (result.success) return;
                    expect(result.errors[0]!.type).toBe('unexpected_kind');
                    expect(result.errors[0]!.message).toContain('address');
                });
            }

            it('still allows scalar leaves beneath a structural parent', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'address.city' as any, direction: 1 }],
                });
                expect(result.success).toBe(true);
            });
        });

        it('succeeds when no filter and no sortAndSlice provided', () => {
            const result = prepareObjectTableQuery('pg', table);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.where_statement).toBeNull();
            expect(result.order_by_statement).toBeNull();
            expect(result.limit_statement).toBeNull();
            expect(result.offset_statement).toBeNull();
        });
    });

    describe('ORDER BY Generation', () => {

        describe('JSON Path Extraction', () => {
            it('converts dot-prop sort key to JSON path expression', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain(pgJsonbAccessor('data', ['date'], { asText: true }));
            });

            it('handles nested dot-prop paths', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'address.city' as any, direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('address');
                expect(result.order_by_statement).toContain('city');
            });
        });

        describe('NULLS LAST', () => {
            it('Postgres ORDER BY includes NULLS LAST', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('DESC NULLS LAST');
            });

            it('SQLite ORDER BY simulates NULLS LAST with IS NULL trick', () => {
                const result = prepareObjectTableQuery('sqlite', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('IS NULL ASC');
                expect(result.order_by_statement).toContain('DESC');
            });
        });

        describe('PK Tiebreaker', () => {
            it('appends PK as last sort key when not already present', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                // Last part of ORDER BY should be PK ASC
                expect(result.order_by_statement).toContain('ASC NULLS LAST');
                const parts = result.order_by_statement!.split(',');
                expect(parts.length).toBe(2);
            });

            it('does not duplicate PK when it is already the last sort key', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }, { key: 'id', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                const parts = result.order_by_statement!.split(',');
                expect(parts.length).toBe(2);
            });
        });
    });

    describe('WHERE Composition', () => {

        describe('WhereFilterDefinition Input', () => {
            it('converts WhereFilterDefinition to parameterised WHERE clause', () => {
                const result = prepareObjectTableQuery('pg', table, { sender: 'Andy' });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement).not.toBeNull();
                expect(result.where_statement!.statement_arguments).toContain('Andy');
            });
        });

        describe('PreparedWhereClauseStatement Input', () => {
            it('passes pre-built WHERE clause through unchanged', () => {
                const prebuilt = { where_clause_statement: 'active = $1', statement_arguments: [true] as any[] };
                const result = prepareObjectTableQuery('pg', table, prebuilt);
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement!.where_clause_statement).toContain('active');
            });
        });

        describe('Additional WHERE Clauses', () => {
            it('merges additional WHERE clauses with AND', () => {
                const additional = [
                    { where_clause_statement: 'archived = $1', statement_arguments: [false] as any[] },
                    { where_clause_statement: 'org_id = $1', statement_arguments: ['org1'] as any[] },
                ];
                const result = prepareObjectTableQuery('pg', table, { sender: 'Andy' }, undefined, additional);
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement!.where_clause_statement).toContain('AND');
            });
        });

        describe('Cursor + Filter + Additional Combined', () => {
            it('composes filter WHERE, cursor WHERE, and additional clauses into single AND', () => {
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
                expect(result.where_statement!.where_clause_statement).toContain('AND');
                expect(result.where_statement!.statement_arguments.length).toBeGreaterThan(1);
            });
        });
    });

    describe('Cursor Pagination (after_pk)', () => {

        describe('Single Sort Key', () => {
            it('generates correct comparison for ASC sort', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: 1 }],
                    after_pk: 'email_abc',
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement).not.toBeNull();
                expect(result.where_statement!.where_clause_statement).toContain('>');
                expect(result.where_statement!.statement_arguments).toContain('email_abc');
            });

            it('generates correct comparison for DESC sort', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }],
                    after_pk: 'email_abc',
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement).not.toBeNull();
                expect(result.where_statement!.where_clause_statement).toContain('<');
            });
        });

        describe('Multi-Key Lexicographic Comparison', () => {
            it('generates OR chain for multi-key sort', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }, { key: 'sender', direction: 1 }],
                    after_pk: 'x',
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement!.where_clause_statement).toContain('OR');
            });
        });

        describe('NULL-Safe Equality', () => {
            it('uses IS NOT DISTINCT FROM for Postgres', () => {
                const result = prepareObjectTableQuery('pg', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }, { key: 'sender', direction: 1 }],
                    after_pk: 'x',
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement!.where_clause_statement).toContain('IS NOT DISTINCT FROM');
            });

            it('uses IS for SQLite', () => {
                const result = prepareObjectTableQuery('sqlite', table, undefined, {
                    sort: [{ key: 'date', direction: -1 }, { key: 'sender', direction: 1 }],
                    after_pk: 'x',
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                const sql = result.where_statement!.where_clause_statement;
                expect(sql).toContain('IS (SELECT');
                expect(sql).not.toContain('IS NOT DISTINCT FROM');
            });
        });
    });

    describe('LIMIT / OFFSET', () => {
        it('generates parameterised LIMIT clause', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, { limit: 20 });
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.limit_statement).toEqual({
                where_clause_statement: '$1',
                statement_arguments: [20],
            });
        });

        it('generates parameterised OFFSET clause', () => {
            const result = prepareObjectTableQuery('sqlite', table, undefined, { offset: 40 } as SortAndSlice<Email>);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.offset_statement).toEqual({
                where_clause_statement: '?',
                statement_arguments: [40],
            });
        });
    });

    describe('Parameterisation Safety', () => {
        it('never embeds raw user values in SQL strings', () => {
            const result = prepareObjectTableQuery('pg', table,
                { sender: "Robert'; DROP TABLE emails;--" },
                { sort: [{ key: 'date', direction: -1 }], after_pk: "'; DROP TABLE emails;--", limit: 10 }
            );
            expect(result.success).toBe(true);
            if (!result.success) return;
            const flat = flattenQueryClausesToSql(result, 'pg');
            // SQL should not contain the raw injection string
            expect(flat.sql).not.toContain('DROP TABLE');
            // Values should be in parameters
            expect(flat.parameters).toContain("Robert'; DROP TABLE emails;--");
        });

        it('rejects sort key paths not present in the Zod schema', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'injection.attempt' as any, direction: 1 }],
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Dialect Parity (Postgres / SQLite)', () => {
        it('produces structurally equivalent clauses for both dialects', () => {
            const sortAndSlice: SortAndSlice<Email> = {
                sort: [{ key: 'date', direction: -1 }], limit: 20
            };
            const pgResult = prepareObjectTableQuery('pg', table, { sender: 'Andy' }, sortAndSlice);
            const sqliteResult = prepareObjectTableQuery('sqlite', table, { sender: 'Andy' }, sortAndSlice);
            expect(pgResult.success).toBe(true);
            expect(sqliteResult.success).toBe(true);
            if (!pgResult.success || !sqliteResult.success) return;
            // Both should have the same non-null clause slots
            expect(pgResult.where_statement !== null).toBe(sqliteResult.where_statement !== null);
            expect(pgResult.order_by_statement !== null).toBe(sqliteResult.order_by_statement !== null);
            expect(pgResult.limit_statement !== null).toBe(sqliteResult.limit_statement !== null);
        });

        it('Postgres uses $N placeholders and SQLite uses ? placeholders', () => {
            const sortAndSlice: SortAndSlice<Email> = {
                sort: [{ key: 'date', direction: -1 }], limit: 20
            };
            const pgFlat = flattenQueryClausesToSql(
                prepareObjectTableQuery('pg', table, { sender: 'Andy' }, sortAndSlice) as any,
                'pg'
            );
            const sqliteFlat = flattenQueryClausesToSql(
                prepareObjectTableQuery('sqlite', table, { sender: 'Andy' }, sortAndSlice) as any,
                'sqlite'
            );
            expect(pgFlat.sql).toContain('$1');
            expect(sqliteFlat.sql).toContain('?');
            // SQLite uses ? placeholders (not $N), but json_extract paths contain '$.' — only check no $N
            expect(sqliteFlat.sql).not.toMatch(/\$\d/);
        });
    });

    describe('Invariants', () => {
        it('ORDER BY always ends with PK expression', () => {
            const result = prepareObjectTableQuery('pg', table, undefined, {
                sort: [{ key: 'date', direction: -1 }],
            });
            expect(result.success).toBe(true);
            if (!result.success) return;
            const parts = result.order_by_statement!.split(',').map(s => s.trim());
            const lastPart = parts[parts.length - 1]!;
            expect(lastPart).toContain('id');
        });

        it('same input produces identical output', () => {
            const r1 = prepareObjectTableQuery('pg', table, { sender: 'A' }, {
                sort: [{ key: 'date', direction: -1 }], limit: 10
            });
            const r2 = prepareObjectTableQuery('pg', table, { sender: 'A' }, {
                sort: [{ key: 'date', direction: -1 }], limit: 10
            });
            expect(r1).toEqual(r2);
        });
    });
});
