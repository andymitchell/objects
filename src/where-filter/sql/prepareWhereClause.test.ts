import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';

import { prepareWhereClause } from './prepareWhereClause.ts';
import { prepareWhereClauseForPg } from './postgres/prepareWhereClauseForPg.ts';
import { prepareWhereClauseForSqlite } from './sqlite/prepareWhereClauseForSqlite.ts';
import { PropertyTranslatorPgJsonbSchema } from './postgres/PropertyTranslatorJsonb.ts';
import { PropertyTranslatorSqliteJsonSchema } from './sqlite/PropertyTranslatorSqliteJson.ts';
import type { IPropertyTranslator, PreparedWhereClauseResult, SqlDialect, WhereClauseError } from './types.ts';
import type { WhereFilterDefinition } from '../types.ts';


const ContactSchema = z.object({
    name: z.string(),
    age: z.number(),
});
type Contact = z.infer<typeof ContactSchema>;

const COLUMN = 'data';
const SAMPLE_FILTER: WhereFilterDefinition<Contact> = { name: 'Andy', age: { $gt: 18 } };


describe('prepareWhereClause', () => {

    describe('routes to the correct dialect implementation', () => {

        it('produces output identical to prepareWhereClauseForPg when dialect is pg', () => {
            const translator = new PropertyTranslatorPgJsonbSchema(ContactSchema, COLUMN);
            const direct = prepareWhereClauseForPg(SAMPLE_FILTER, translator);
            const viaUnified = prepareWhereClause('pg', SAMPLE_FILTER, translator);

            // Metamorphic: both code paths must produce the same statement and arguments.
            expect(viaUnified).toEqual(direct);
            // And it should actually have produced something — sanity that the metamorphic test isn't trivially comparing two failures.
            expect(viaUnified.success).toBe(true);
        });

        it('produces output identical to prepareWhereClauseForSqlite when dialect is sqlite', () => {
            const translator = new PropertyTranslatorSqliteJsonSchema(ContactSchema, COLUMN);
            const direct = prepareWhereClauseForSqlite(SAMPLE_FILTER, translator);
            const viaUnified = prepareWhereClause('sqlite', SAMPLE_FILTER, translator);

            expect(viaUnified).toEqual(direct);
            expect(viaUnified.success).toBe(true);
        });

        it('emits Postgres $N placeholders for pg', () => {
            const translator = new PropertyTranslatorPgJsonbSchema(ContactSchema, COLUMN);
            const r = prepareWhereClause('pg', SAMPLE_FILTER, translator);
            expect(r.success).toBe(true);
            if (r.success) {
                expect(r.where_clause_statement).toMatch(/\$\d/);
                expect(r.where_clause_statement).not.toMatch(/(^|[^?])\?($|[^?])/);
            }
        });

        it('emits SQLite ? placeholders for sqlite', () => {
            const translator = new PropertyTranslatorSqliteJsonSchema(ContactSchema, COLUMN);
            const r = prepareWhereClause('sqlite', SAMPLE_FILTER, translator);
            expect(r.success).toBe(true);
            if (r.success) {
                expect(r.where_clause_statement).toContain('?');
                expect(r.where_clause_statement).not.toMatch(/\$\d/);
            }
        });
    });

    describe('rejects mismatched translator/dialect pairings', () => {

        it('returns dialect_mismatch when pg is requested with a sqlite translator', () => {
            const sqliteTranslator = new PropertyTranslatorSqliteJsonSchema(ContactSchema, COLUMN);
            const r = prepareWhereClause('pg', SAMPLE_FILTER, sqliteTranslator);

            expect(r.success).toBe(false);
            if (!r.success) {
                expect(r.errors).toHaveLength(1);
                const err = r.errors[0]!;
                expect(err.kind).toBe('dialect_mismatch');
                if (err.kind === 'dialect_mismatch') {
                    expect(err.expected).toBe('pg');
                    expect(err.actual).toBe('sqlite');
                    expect(err.message).toContain('pg');
                    expect(err.message).toContain('sqlite');
                }
            }
        });

        it('returns dialect_mismatch when sqlite is requested with a pg translator', () => {
            const pgTranslator = new PropertyTranslatorPgJsonbSchema(ContactSchema, COLUMN);
            const r = prepareWhereClause('sqlite', SAMPLE_FILTER, pgTranslator);

            expect(r.success).toBe(false);
            if (!r.success) {
                expect(r.errors).toHaveLength(1);
                const err = r.errors[0]!;
                expect(err.kind).toBe('dialect_mismatch');
                if (err.kind === 'dialect_mismatch') {
                    expect(err.expected).toBe('sqlite');
                    expect(err.actual).toBe('pg');
                }
            }
        });

        it('does not invoke the underlying compile path on mismatch', () => {
            // If the underlying compile path ran, we'd see statement_arguments leak in.
            // The mismatch branch must short-circuit before any SQL generation occurs.
            const sqliteTranslator = new PropertyTranslatorSqliteJsonSchema(ContactSchema, COLUMN);
            const r = prepareWhereClause('pg', SAMPLE_FILTER, sqliteTranslator);

            expect(r).not.toHaveProperty('where_clause_statement');
            expect(r).not.toHaveProperty('statement_arguments');
        });
    });

    describe('passes through underlying compile failures unchanged', () => {

        it('preserves errors from the underlying compile path (non-mismatch)', () => {
            // A filter referencing a non-existent property — the underlying pg compile will fail with path errors.
            const translator = new PropertyTranslatorPgJsonbSchema(ContactSchema, COLUMN);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally building an invalid filter to drive the error path
            const badFilter = { nonexistent_property_xyz: 'value' } as any;

            const direct = prepareWhereClauseForPg(badFilter, translator);
            const viaUnified = prepareWhereClause('pg', badFilter, translator);

            // Whatever the direct path returns (success or failure), the unified path must mirror it exactly.
            expect(viaUnified).toEqual(direct);
        });
    });

    describe('schema-driven rejection of shape-ambiguous schemas', () => {

        const AmbiguousSchema = z.object({ id: z.string(), owner: z.union([z.string(), z.array(z.string())]) });

        it('rejects a scalar|array field with a schema_ambiguous error naming the path (pg)', () => {
            const result = prepareWhereClause('pg', { owner: 'a' }, new PropertyTranslatorPgJsonbSchema(AmbiguousSchema, COLUMN));
            expect(result.success).toBe(false);
            if (!result.success) {
                const ambiguous = result.errors.find((e) => e.kind === 'schema_ambiguous');
                expect(ambiguous?.kind).toBe('schema_ambiguous');
                if (ambiguous?.kind === 'schema_ambiguous') expect(ambiguous.dotprop_path).toBe('owner');
            }
        });

        it('rejects a scalar|array field with a schema_ambiguous error (sqlite)', () => {
            const result = prepareWhereClause('sqlite', { owner: 'a' }, new PropertyTranslatorSqliteJsonSchema(AmbiguousSchema, COLUMN));
            expect(result.success).toBe(false);
            if (!result.success) expect(result.errors.some((e) => e.kind === 'schema_ambiguous')).toBe(true);
        });

        it('does not reject a concrete array-only schema', () => {
            const ConcreteSchema = z.object({ id: z.string(), owners: z.array(z.string()) });
            const result = prepareWhereClause('pg', { owners: 'a' }, new PropertyTranslatorPgJsonbSchema(ConcreteSchema, COLUMN));
            expect(result.success).toBe(true);
        });
    });

    describe('schema-driven rejection of value-normalizing schemas', () => {

        const CoerceSchema = z.object({ id: z.string(), n: z.coerce.number() });

        it('rejects a z.coerce.* field with a schema_normalizes error naming the path (pg)', () => {
            const result = prepareWhereClause('pg', { n: 1 }, new PropertyTranslatorPgJsonbSchema(CoerceSchema, COLUMN));
            expect(result.success).toBe(false);
            if (!result.success) {
                const normalizes = result.errors.find((e) => e.kind === 'schema_normalizes');
                expect(normalizes?.kind).toBe('schema_normalizes');
                if (normalizes?.kind === 'schema_normalizes') expect(normalizes.dotprop_path).toBe('n');
            }
        });

        it('rejects a value-normalizing field with a schema_normalizes error (sqlite)', () => {
            const result = prepareWhereClause('sqlite', { n: 1 }, new PropertyTranslatorSqliteJsonSchema(CoerceSchema, COLUMN));
            expect(result.success).toBe(false);
            if (!result.success) expect(result.errors.some((e) => e.kind === 'schema_normalizes')).toBe(true);
        });

        it('does not reject a plain (non-normalizing) number field', () => {
            const PlainSchema = z.object({ id: z.string(), n: z.number() });
            const result = prepareWhereClause('pg', { n: 1 }, new PropertyTranslatorPgJsonbSchema(PlainSchema, COLUMN));
            expect(result.success).toBe(true);
        });
    });

    describe('caller contract (compile-time types)', () => {

        it('the dialect parameter is exactly the SqlDialect union', () => {
            type FirstParam = Parameters<typeof prepareWhereClause>[0];
            expectTypeOf<FirstParam>().toEqualTypeOf<SqlDialect>();
            expectTypeOf<SqlDialect>().toEqualTypeOf<'pg' | 'sqlite'>();
        });

        it('returns PreparedWhereClauseResult', () => {
            type Ret = ReturnType<typeof prepareWhereClause>;
            expectTypeOf<Ret>().toEqualTypeOf<PreparedWhereClauseResult>();
        });

        it('IPropertyTranslator carries a readonly dialect discriminant', () => {
            type Translator = IPropertyTranslator<Contact>;
            expectTypeOf<Translator['dialect']>().toEqualTypeOf<SqlDialect>();
        });

        it('WhereClauseError union includes dialect_mismatch, schema_ambiguous and schema_normalizes and is exhaustively narrowable', () => {
            // Exhaustiveness check: every kind must be handled or this fails to compile.
            const exhaustive = (e: WhereClauseError): string => {
                switch (e.kind) {
                    case 'filter': return e.message;
                    case 'path_conversion': return e.message;
                    case 'dialect_mismatch': return e.message;
                    case 'schema_ambiguous': return e.message;
                    case 'schema_normalizes': return e.message;
                    default: {
                        const _never: never = e;
                        return _never;
                    }
                }
            };
            expect(typeof exhaustive).toBe('function');
        });
    });
});
