import { describe, expect, it } from 'vitest';
import { flattenQueryClausesToSql } from './flattenQueryClauses.ts';
import type { PreparedQueryClauses } from '../types.ts';

function makeClauses(overrides: Partial<PreparedQueryClauses> = {}): PreparedQueryClauses {
    return {
        where_statement: null,
        order_by_statement: null,
        limit_statement: null,
        offset_statement: null,
        ...overrides,
    };
}

describe('flattenQueryClausesToSql', () => {

    describe('Clause Assembly', () => {

        describe('Keyword Ordering (WHERE -> ORDER BY -> LIMIT -> OFFSET)', () => {
            it('assembles all clauses in correct SQL keyword order', () => {
                const clauses = makeClauses({
                    where_statement: { where_clause_statement: 'active = $1', statement_arguments: [true] },
                    order_by_statement: '"date" DESC NULLS LAST',
                    limit_statement: { where_clause_statement: '$1', statement_arguments: [20] },
                    offset_statement: { where_clause_statement: '$1', statement_arguments: [40] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                const whereIdx = flat.sql.indexOf('WHERE');
                const orderIdx = flat.sql.indexOf('ORDER BY');
                const limitIdx = flat.sql.indexOf('LIMIT');
                const offsetIdx = flat.sql.indexOf('OFFSET');
                expect(whereIdx).toBeLessThan(orderIdx);
                expect(orderIdx).toBeLessThan(limitIdx);
                expect(limitIdx).toBeLessThan(offsetIdx);
            });
        });

        describe('Selective Clauses (only non-null included)', () => {
            it('includes only WHERE when other clauses are null', () => {
                const clauses = makeClauses({
                    where_statement: { where_clause_statement: 'x = $1', statement_arguments: [1] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                expect(flat.sql).toContain('WHERE');
                expect(flat.sql).not.toContain('ORDER BY');
                expect(flat.sql).not.toContain('LIMIT');
            });

            it('includes only ORDER BY when other clauses are null', () => {
                const clauses = makeClauses({
                    order_by_statement: '"name" ASC',
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                expect(flat.sql).toBe('ORDER BY "name" ASC');
                expect(flat.parameters).toEqual([]);
            });

            it('includes only LIMIT when other clauses are null', () => {
                const clauses = makeClauses({
                    limit_statement: { where_clause_statement: '$1', statement_arguments: [10] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                expect(flat.sql).toContain('LIMIT');
                expect(flat.sql).not.toContain('WHERE');
            });

            it('includes ORDER BY and LIMIT without WHERE', () => {
                const clauses = makeClauses({
                    order_by_statement: '"name" ASC',
                    limit_statement: { where_clause_statement: '$1', statement_arguments: [10] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                expect(flat.sql).toContain('ORDER BY');
                expect(flat.sql).toContain('LIMIT');
                expect(flat.sql).not.toContain('WHERE');
            });
        });
    });

    describe('Parameter Renumbering', () => {

        describe('Postgres $N Rebasing', () => {
            it('renumbers parameters sequentially across clauses', () => {
                const clauses = makeClauses({
                    where_statement: { where_clause_statement: 'x = $1', statement_arguments: ['val'] },
                    limit_statement: { where_clause_statement: '$1', statement_arguments: [20] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                // WHERE keeps $1, LIMIT becomes $2
                expect(flat.sql).toContain('$1');
                const limitMatch = flat.sql.match(/LIMIT \$(\d+)/);
                expect(limitMatch).not.toBeNull();
                expect(parseInt(limitMatch![1]!, 10)).toBe(2);
                expect(flat.parameters).toEqual(['val', 20]);
            });

            it('handles WHERE with multiple params followed by LIMIT and OFFSET', () => {
                const clauses = makeClauses({
                    where_statement: { where_clause_statement: 'a = $1 AND b = $2', statement_arguments: ['x', 'y'] },
                    limit_statement: { where_clause_statement: '$1', statement_arguments: [10] },
                    offset_statement: { where_clause_statement: '$1', statement_arguments: [30] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'pg');
                expect(flat.parameters).toEqual(['x', 'y', 10, 30]);
                // LIMIT should be $3, OFFSET should be $4
                const limitMatch = flat.sql.match(/LIMIT \$(\d+)/);
                const offsetMatch = flat.sql.match(/OFFSET \$(\d+)/);
                expect(parseInt(limitMatch![1]!, 10)).toBe(3);
                expect(parseInt(offsetMatch![1]!, 10)).toBe(4);
            });
        });

        describe('SQLite ? Pass-Through', () => {
            it('preserves ? placeholders without renumbering', () => {
                const clauses = makeClauses({
                    where_statement: { where_clause_statement: 'x = ?', statement_arguments: ['val'] },
                    limit_statement: { where_clause_statement: '?', statement_arguments: [20] },
                });
                const flat = flattenQueryClausesToSql(clauses, 'sqlite');
                expect(flat.sql).toContain('?');
                expect(flat.sql).not.toContain('$');
                expect(flat.parameters).toEqual(['val', 20]);
            });
        });
    });

    describe('Empty Input', () => {
        it('returns empty sql and empty parameters when all clauses are null', () => {
            const flat = flattenQueryClausesToSql(makeClauses(), 'pg');
            expect(flat.sql).toBe('');
            expect(flat.parameters).toEqual([]);
        });
    });

    describe('Invariants', () => {
        it('parameter count matches total across all non-null clauses', () => {
            const clauses = makeClauses({
                where_statement: { where_clause_statement: 'a = $1 AND b = $2', statement_arguments: ['x', 'y'] },
                limit_statement: { where_clause_statement: '$1', statement_arguments: [10] },
            });
            const flat = flattenQueryClausesToSql(clauses, 'pg');
            expect(flat.parameters).toHaveLength(3); // 2 + 1
        });

        it('same input produces identical output', () => {
            const clauses = makeClauses({
                where_statement: { where_clause_statement: 'x = $1', statement_arguments: [1] },
                order_by_statement: '"name" ASC',
                limit_statement: { where_clause_statement: '$1', statement_arguments: [10] },
            });
            const r1 = flattenQueryClausesToSql(clauses, 'pg');
            const r2 = flattenQueryClausesToSql(clauses, 'pg');
            expect(r1).toEqual(r2);
        });
    });
});
