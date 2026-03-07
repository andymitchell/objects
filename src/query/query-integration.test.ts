import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { prepareObjectTableQuery } from './sql/prepareObjectTableQuery.ts';
import { flattenQueryClausesToSql } from './sql/flattenQueryClauses.ts';
import type { ObjectTableInfo } from './types.ts';

const EmailSchema = z.object({
    id: z.string(),
    date: z.string(),
    sender: z.string(),
    status: z.string(),
});
type Email = z.infer<typeof EmailSchema>;

const table: ObjectTableInfo<Email> = {
    tableName: 'emails',
    objectColumnName: 'data',
    ddl: { primary_key: 'id' },
    schema: EmailSchema,
};

describe('Query Module Integration', () => {

    describe('WHERE + Sort Composition', () => {

        describe('Filter Does Not Corrupt Pagination', () => {
            it('adding a WHERE filter preserves sort order of remaining items', () => {
                // Build query with filter + sort
                const result = prepareObjectTableQuery('pg', table,
                    { status: 'active' },
                    { sort: [{ key: 'date', direction: -1 }], limit: 10 }
                );
                expect(result.success).toBe(true);
                if (!result.success) return;
                // Verify both WHERE and ORDER BY are present
                expect(result.where_statement).not.toBeNull();
                expect(result.order_by_statement).not.toBeNull();
                const flat = flattenQueryClausesToSql(result, 'pg');
                const whereIdx = flat.sql.indexOf('WHERE');
                const orderIdx = flat.sql.indexOf('ORDER BY');
                expect(whereIdx).toBeLessThan(orderIdx);
            });

            it('cursor pagination through filtered results yields correct clause structure', () => {
                const result = prepareObjectTableQuery('pg', table,
                    { status: 'active' },
                    { sort: [{ key: 'date', direction: -1 }], after_pk: 'email_5', limit: 10 }
                );
                expect(result.success).toBe(true);
                if (!result.success) return;
                // WHERE should contain both filter and cursor
                expect(result.where_statement!.where_clause_statement).toContain('AND');
                expect(result.order_by_statement).not.toBeNull();
            });
        });

        describe('Filter Commutativity', () => {
            it('swapping order of additional WHERE clauses produces identical results', () => {
                const clauseA = { where_clause_statement: 'org_id = $1', statement_arguments: ['org1'] as any[] };
                const clauseB = { where_clause_statement: 'archived = $1', statement_arguments: [false] as any[] };
                const sortAndSlice = { sort: [{ key: 'date' as const, direction: -1 as const }], limit: 10 };

                const resultAB = prepareObjectTableQuery('pg', table, { sender: 'Andy' }, sortAndSlice, [clauseA, clauseB]);
                const resultBA = prepareObjectTableQuery('pg', table, { sender: 'Andy' }, sortAndSlice, [clauseB, clauseA]);
                expect(resultAB.success).toBe(true);
                expect(resultBA.success).toBe(true);
                if (!resultAB.success || !resultBA.success) return;

                const flatAB = flattenQueryClausesToSql(resultAB, 'pg');
                const flatBA = flattenQueryClausesToSql(resultBA, 'pg');
                // Both should have the same parameters (possibly in different order)
                expect(flatAB.parameters.sort()).toEqual(flatBA.parameters.sort());
            });

            it('commutativity holds when combined with cursor pagination', () => {
                const clauseA = { where_clause_statement: 'org_id = $1', statement_arguments: ['org1'] as any[] };
                const clauseB = { where_clause_statement: 'archived = $1', statement_arguments: [false] as any[] };
                const sortAndSlice = {
                    sort: [{ key: 'date' as const, direction: -1 as const }],
                    after_pk: 'email_cursor',
                    limit: 10,
                };

                const resultAB = prepareObjectTableQuery('pg', table, undefined, sortAndSlice, [clauseA, clauseB]);
                const resultBA = prepareObjectTableQuery('pg', table, undefined, sortAndSlice, [clauseB, clauseA]);
                expect(resultAB.success).toBe(true);
                expect(resultBA.success).toBe(true);
                if (!resultAB.success || !resultBA.success) return;

                const flatAB = flattenQueryClausesToSql(resultAB, 'pg');
                const flatBA = flattenQueryClausesToSql(resultBA, 'pg');
                expect(flatAB.parameters.sort()).toEqual(flatBA.parameters.sort());
            });
        });
    });
});
