import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSortKeyExpression } from './buildSortKeyExpression.ts';
import { prepareObjectTableQuery } from './prepareObjectTableQuery.ts';
import type { ObjectTableInfo } from '../types.ts';

const Schema = z.object({
    id: z.string(),
    rank: z.number(),
    active: z.boolean(),
    huge: z.bigint(),
    sender: z.object({ name: z.string() }),
});
type Row = z.infer<typeof Schema>;

const DIALECTS = ['pg', 'sqlite'] as const;

describe('the one expression a JSON sort key resolves to', () => {

    describe('what it renders', () => {
        it('reads a Postgres text leaf as text, pinned to code-point collation', () => {
            const result = buildSortKeyExpression('pg', 'data', 'id', Schema);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.expression).toBe(`(data->>E'id')::text COLLATE "C"`);
            expect(result.kind).toBe('text');
        });

        it('reads a Postgres numeric leaf as numeric, which orders the same under any collation', () => {
            const result = buildSortKeyExpression('pg', 'data', 'rank', Schema);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.expression).toBe(`(data->>E'rank')::numeric`);
            expect(result.kind).toBe('numeric');
        });

        it('walks a nested Postgres path one member at a time, reading only the last as text', () => {
            const result = buildSortKeyExpression('pg', 'data', 'sender.name', Schema);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.expression).toBe(`(data->E'sender'->>E'name')::text COLLATE "C"`);
        });

        it('reads a SQLite leaf through json_extract, whose text comparisons are code-point ordered already', () => {
            const result = buildSortKeyExpression('sqlite', 'data', 'id', Schema);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.expression).toBe(`json_extract(data, '$."id"')`);
            expect(result.expression).not.toContain('COLLATE');
            expect(result.kind).toBe('text');
        });

        it('quotes every SQLite path segment, so a key carrying a dot stays one segment', () => {
            const result = buildSortKeyExpression('sqlite', 'data', 'sender.name', Schema);
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.expression).toBe(`json_extract(data, '$."sender"."name"')`);
        });
    });

    describe('the keys it refuses, always naming the offending one', () => {
        it.each(DIALECTS)('%s: a bigint leaf, which JSON cannot carry in the first place', (dialect) => {
            const result = buildSortKeyExpression(dialect, 'data', 'huge', Schema);
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.type).toBe('unsupported_kind');
            expect(result.error.message).toContain(`Sort key 'huge':`);
        });

        it.each(DIALECTS)('%s: a structural leaf, which no two engines order alike', (dialect) => {
            const result = buildSortKeyExpression(dialect, 'data', 'sender', Schema);
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.type).toBe('unexpected_kind');
            expect(result.error.message).toContain(`Sort key 'sender':`);
        });

        it.each(DIALECTS)('%s: a path the schema does not describe', (dialect) => {
            const result = buildSortKeyExpression(dialect, 'data', 'nope', Schema);
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.message).toContain(`Sort key 'nope':`);
        });
    });

    // The value of a single expression builder is that everything reading a sort key reads the SAME text —
    // an ORDER BY, a keyset predicate, and any expression index built to serve them. If the ORDER BY were
    // assembled from anything else, an index built on this expression would silently stop serving it.
    describe('what the query builder orders by', () => {
        it.each(DIALECTS)('%s: every ORDER BY term is exactly this expression', (dialect) => {
            const table: ObjectTableInfo<Row> = { tableName: 't', objectColumnName: 'data', ddl: { primary_key: 'id' }, schema: Schema };
            const prepared = prepareObjectTableQuery(dialect, table, undefined, { sort: [{ key: 'rank', direction: -1 }] });
            expect(prepared.success).toBe(true);
            if (!prepared.success) return;

            const rank = buildSortKeyExpression(dialect, 'data', 'rank', Schema);
            const pk = buildSortKeyExpression(dialect, 'data', 'id', Schema);
            if (!rank.success || !pk.success) throw new Error('the builder refused a key the table declares');

            expect(prepared.order_by_statement).toBe(`${rank.expression} DESC NULLS LAST, ${pk.expression} ASC NULLS LAST`);
        });
    });
});
