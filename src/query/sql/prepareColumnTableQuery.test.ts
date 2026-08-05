import { describe, expect, it } from 'vitest';
import { prepareColumnTableQuery } from './prepareColumnTableQuery.ts';
import { encodeSortValue } from '../sortCompare.ts';
import type { ColumnTableInfo } from '../types.ts';

const table: ColumnTableInfo = {
    tableName: 'users',
    pkColumnName: 'id',
    allowedColumns: ['id', 'created_at', 'name', 'email'],
    columnKinds: {},
};

describe('prepareColumnTableQuery', () => {

    // standardTests run in the per-dialect adapter files (prepareColumnTableQuery.pg.test.ts /
    // prepareColumnTableQuery.sqlite.test.ts), which execute the prepared clauses against real
    // engines. This file inspects the emitted SQL strings themselves.

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
                    columnKinds: {},
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

            it('places nulls last for SQLite', () => {
                const result = prepareColumnTableQuery('sqlite', table, {
                    sort: [{ key: 'name', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"name" ASC NULLS LAST');
            });
        });

        describe('PK Tiebreaker', () => {
            it('keeps the PK tiebreaker ascending under a descending main sort', () => {
                const result = prepareColumnTableQuery('pg', table, {
                    sort: [{ key: 'created_at', direction: -1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"created_at" DESC NULLS LAST');
                expect(result.order_by_statement).toContain('"id" ASC NULLS LAST');
            });

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
                    columnKinds: {},
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
                    columnKinds: {},
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

        it('combines the cursor WHERE with additional WHERE clauses using AND', () => {
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

    describe('Column Kinds', () => {
        const kindTable: ColumnTableInfo = {
            tableName: 'users',
            pkColumnName: 'id',
            allowedColumns: ['id', 'name', 'age', 'flag'],
            columnKinds: { id: 'text', name: 'text', age: 'numeric', flag: 'boolean' },
        };

        describe('Text collation pinning (Postgres)', () => {
            // PGlite defaults to C collation, so the real-engine suites cannot observe the pin — these
            // string pins are the only guard that production Postgres orders text by code point.
            it('pins COLLATE "C" on a text-declared column ORDER BY', () => {
                const result = prepareColumnTableQuery('pg', kindTable, { sort: [{ key: 'name', direction: 1 }] });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"name" COLLATE "C"');
            });

            it('leaves a numeric-declared column unpinned while still pinning the text pk tiebreaker', () => {
                const result = prepareColumnTableQuery('pg', kindTable, { sort: [{ key: 'age', direction: 1 }] });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"age" ASC');
                expect(result.order_by_statement).not.toContain('"age" COLLATE');
                expect(result.order_by_statement).toContain('"id" COLLATE "C"');
            });

            it('leaves an undeclared column unpinned (empty columnKinds)', () => {
                // `table` declares columnKinds: {} — nothing is text, so nothing is pinned.
                const result = prepareColumnTableQuery('pg', table, { sort: [{ key: 'name', direction: 1 }] });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).not.toContain('COLLATE');
            });
        });

        describe('Boolean boundary translation', () => {
            it('binds a boolean-column boundary as a real boolean for Postgres', () => {
                const result = prepareColumnTableQuery('pg', kindTable, {
                    sort: [{ key: 'flag', direction: 1 }],
                    after_boundary: { values: [encodeSortValue(true)], pk: 'u1' },
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement).not.toBeNull();
                expect(result.where_statement!.statement_arguments).toContain(true);
            });

            it('binds a boolean-column boundary as 1/0 for SQLite', () => {
                const result = prepareColumnTableQuery('sqlite', kindTable, {
                    sort: [{ key: 'flag', direction: 1 }],
                    after_boundary: { values: [encodeSortValue(false)], pk: 'u1' },
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement).not.toBeNull();
                expect(result.where_statement!.statement_arguments).toContain(0);
            });
        });

        describe('After-boundary predicate', () => {
            it('binds the boundary values directly, with no correlated subquery', () => {
                const result = prepareColumnTableQuery('pg', kindTable, {
                    sort: [{ key: 'name', direction: 1 }],
                    after_boundary: { values: ['Bob'], pk: 'u1' },
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement).not.toBeNull();
                expect(result.where_statement!.where_clause_statement).not.toContain('SELECT');
                expect(result.where_statement!.statement_arguments).toContain('Bob');
            });
        });

        describe('Bigint columns [dec-bigint-boundary-strict-binding]', () => {
            const bigintTable: ColumnTableInfo = {
                tableName: 'ledgers',
                pkColumnName: 'id',
                allowedColumns: ['id', 'amount'],
                columnKinds: { id: 'text', amount: 'bigint' },
            };

            it('orders a bigint column bare: no COLLATE, no cast', () => {
                const result = prepareColumnTableQuery('pg', bigintTable, {
                    sort: [{ key: 'amount', direction: 1 }],
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.order_by_statement).toContain('"amount" ASC NULLS LAST');
                expect(result.order_by_statement).not.toContain('"amount" COLLATE');
                expect(result.order_by_statement).not.toContain('::');
            });

            it('passes the bigint kind through to the boundary binder: a tagged value binds as a decimal string for Postgres', () => {
                const result = prepareColumnTableQuery('pg', bigintTable, {
                    sort: [{ key: 'amount', direction: 1 }],
                    after_boundary: { values: [encodeSortValue(9007199254740993n)], pk: 'u1' },
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement!.statement_arguments).toContain('9007199254740993');
            });

            it('passes the bigint kind through to the boundary binder: a tagged value binds as a native BigInt for SQLite', () => {
                const result = prepareColumnTableQuery('sqlite', bigintTable, {
                    sort: [{ key: 'amount', direction: 1 }],
                    after_boundary: { values: [encodeSortValue(9007199254740993n)], pk: 'u1' },
                });
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.where_statement!.statement_arguments).toContain(9007199254740993n);
            });

            it('rejects a stale bare-string boundary on a bigint column with a cursor error', () => {
                const result = prepareColumnTableQuery('pg', bigintTable, {
                    sort: [{ key: 'amount', direction: 1 }],
                    after_boundary: { values: ['10'], pk: 'u1' },
                });
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
            });

            describe('Bigint-kind primary key [dec-bigint-boundary-strict-binding]', () => {
                // `SortBoundary.pk` is a PrimaryKeyValue (string | number), so the synthetic pk
                // tiebreaker can never carry the tagged form: keyset pagination over a bigint pk
                // column works only while pk values fit safe-integer precision, and fails loudly
                // — never silently mis-anchored — beyond it.
                const bigintPkTable: ColumnTableInfo = {
                    tableName: 'ledgers',
                    pkColumnName: 'id',
                    allowedColumns: ['id', 'amount'],
                    columnKinds: { id: 'bigint', amount: 'bigint' },
                };

                it('a safe-integer pk value anchors the synthetic tiebreaker in both dialects', () => {
                    const pg = prepareColumnTableQuery('pg', bigintPkTable, {
                        sort: [{ key: 'amount', direction: 1 }],
                        after_boundary: { values: [encodeSortValue(10n)], pk: 42 },
                    });
                    expect(pg.success).toBe(true);
                    if (!pg.success) return;
                    expect(pg.where_statement!.statement_arguments).toContain('42');

                    const sqlite = prepareColumnTableQuery('sqlite', bigintPkTable, {
                        sort: [{ key: 'amount', direction: 1 }],
                        after_boundary: { values: [encodeSortValue(10n)], pk: 42 },
                    });
                    expect(sqlite.success).toBe(true);
                    if (!sqlite.success) return;
                    expect(sqlite.where_statement!.statement_arguments).toContain(42n);
                });

                it('a pk value hydrated beyond safe-integer precision fails loudly', () => {
                    const result = prepareColumnTableQuery('pg', bigintPkTable, {
                        sort: [{ key: 'amount', direction: 1 }],
                        after_boundary: { values: [encodeSortValue(10n)], pk: 2 ** 53 },
                    });
                    expect(result.success).toBe(false);
                    if (result.success) return;
                    expect(result.errors[0]!.type).toBe('cursor');
                    expect(result.errors[0]!.message).toContain('safe-integer');
                });

                it('a pk value hydrated as a bare decimal string fails loudly', () => {
                    const result = prepareColumnTableQuery('pg', bigintPkTable, {
                        sort: [{ key: 'amount', direction: 1 }],
                        after_boundary: { values: [encodeSortValue(10n)], pk: '9007199254740993' },
                    });
                    expect(result.success).toBe(false);
                    if (result.success) return;
                    expect(result.errors[0]!.type).toBe('cursor');
                });
            });
        });
    });
});
