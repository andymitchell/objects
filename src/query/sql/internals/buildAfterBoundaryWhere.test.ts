import { describe, expect, it } from 'vitest';
import type { DotPropPathConversionResult, SortValueKind } from '../../../utils/sql/types.ts';
import { _buildAfterBoundaryWhereClause, type BoundaryEntry } from './buildAfterBoundaryWhere.ts';

/** Converter with no kind — values bind raw (the kindless path). */
const identity = (k: string): DotPropPathConversionResult => ({ success: true, expression: k });

/** Converter that attaches a declared kind per key, driving the per-kind bind rules. */
const withKinds = (kinds: Record<string, SortValueKind>) =>
    (k: string): DotPropPathConversionResult => {
        const kind = kinds[k];
        return kind === undefined ? { success: true, expression: k } : { success: true, expression: k, kind };
    };

describe('buildAfterBoundaryWhere', () => {

    describe('Postgres arm structure', () => {
        it('emits a single null-tolerant greater-than arm for one ascending key', () => {
            const entries: BoundaryEntry[] = [{ key: 'age', direction: 1, value: 20 }];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'pg');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe('((age > $1 OR age IS NULL))');
            expect(result.statement.parameters).toEqual([20]);
        });

        it('flips the comparison operator for a descending key', () => {
            const entries: BoundaryEntry[] = [{ key: 'age', direction: -1, value: 20 }];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'pg');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe('((age < $1 OR age IS NULL))');
            expect(result.statement.parameters).toEqual([20]);
        });

        it('builds the lexicographic OR-of-arms for a mixed-direction multi-key boundary', () => {
            // a ASC, b DESC, then a synthetic pk entry (id ASC) — as the prepare functions zip it.
            const entries: BoundaryEntry[] = [
                { key: 'a', direction: 1, value: 'X' },
                { key: 'b', direction: -1, value: 'Y' },
                { key: 'id', direction: 1, value: 'Z' },
            ];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'pg');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe(
                '((a > $1 OR a IS NULL))' +
                ' OR (a = $2 AND (b < $3 OR b IS NULL))' +
                ' OR (a = $4 AND b = $5 AND (id > $6 OR id IS NULL))'
            );
            expect(result.statement.parameters).toEqual(['X', 'X', 'Y', 'X', 'Y', 'Z']);
        });
    });

    describe('Null boundary values (NULLS LAST)', () => {
        it('drops the arm whose own key is null and equality-matches null with IS NULL', () => {
            const entries: BoundaryEntry[] = [
                { key: 'a', direction: 1, value: null },
                { key: 'id', direction: 1, value: 'Z' },
            ];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'pg');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe('(a IS NULL AND (id > $1 OR id IS NULL))');
            expect(result.statement.parameters).toEqual(['Z']);
        });

        it('emits an explicitly-false predicate when every boundary value is null', () => {
            // An all-null boundary sits at the NULLS-LAST end: no row is ordered strictly after it.
            // The predicate must be well-formed false (not an empty string) so it composes safely.
            const entries: BoundaryEntry[] = [
                { key: 'a', direction: 1, value: null },
                { key: 'id', direction: 1, value: null },
            ];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'pg');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe('1=0');
            expect(result.statement.parameters).toEqual([]);
        });
    });

    describe('SQLite placeholders', () => {
        it('uses positional ? placeholders instead of $n', () => {
            const entries: BoundaryEntry[] = [{ key: 'age', direction: 1, value: 20 }];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'sqlite');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe('((age > ? OR age IS NULL))');
            expect(result.statement.sql).not.toContain('$1');
            expect(result.statement.parameters).toEqual([20]);
        });

        it('emits one ? per value occurrence, in order, for a multi-key boundary', () => {
            const entries: BoundaryEntry[] = [
                { key: 'a', direction: 1, value: 'X' },
                { key: 'id', direction: 1, value: 'Z' },
            ];
            const result = _buildAfterBoundaryWhereClause(entries, identity, 'sqlite');
            expect(result.success).toBe(true);
            if (!result.success) return;
            expect(result.statement.sql).toBe('((a > ? OR a IS NULL)) OR (a = ? AND (id > ? OR id IS NULL))');
            expect(result.statement.parameters).toEqual(['X', 'X', 'Z']);
        });
    });

    describe('Kind-driven value binding', () => {
        it('rejects a non-number value on a numeric key (guards the pg ::numeric ordering)', () => {
            const entries: BoundaryEntry[] = [{ key: 'age', direction: 1, value: '-Infinity' }];
            const result = _buildAfterBoundaryWhereClause(entries, withKinds({ age: 'numeric' }), 'pg');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors[0]!.type).toBe('cursor');
            expect(result.errors[0]!.message).toContain('age');
        });

        it('rejects a non-string value on a text key', () => {
            const entries: BoundaryEntry[] = [{ key: 'name', direction: 1, value: 42 }];
            const result = _buildAfterBoundaryWhereClause(entries, withKinds({ name: 'text' }), 'pg');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors[0]!.type).toBe('cursor');
        });

        describe('Bigint kind [dec-bigint-boundary-strict-binding]', () => {

            it('binds a tagged bigint beyond double precision as a decimal string for Postgres', () => {
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: '9007199254740993' } }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.statement.sql).toBe('((n > $1 OR n IS NULL))');
                expect(result.statement.parameters).toEqual(['9007199254740993']);
            });

            it('binds a tagged bigint as a native BigInt for SQLite', () => {
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: '9007199254740993' } }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'sqlite');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.statement.sql).toBe('((n > ? OR n IS NULL))');
                expect(result.statement.parameters).toEqual([9007199254740993n]);
            });

            it('accepts both int64 extremes (the range is inclusive)', () => {
                for (const payload of ['9223372036854775807', '-9223372036854775808']) {
                    const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: payload } }];
                    const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                    expect(result.success, `expected ${payload} to bind`).toBe(true);
                    if (!result.success) continue;
                    expect(result.statement.parameters).toEqual([payload]);
                }
            });

            it('accepts a safe-integer number: what small-value driver hydration yields', () => {
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: 42 }];
                const pg = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                const sqlite = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'sqlite');
                expect(pg.success && sqlite.success).toBe(true);
                if (!pg.success || !sqlite.success) return;
                expect(pg.statement.parameters).toEqual(['42']);
                expect(sqlite.statement.parameters).toEqual([42n]);
            });

            it('rejects a tagged value beyond the int64 range: a foreign or corrupt cursor', () => {
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: '9223372036854775808' } }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain('n');
                expect(result.errors[0]!.message).toContain('int64');
            });

            it('rejects an unsafe-magnitude number and names the hydration remedy', () => {
                // 2^53 is exactly what a lossy better-sqlite3 default read produces for a large bigint.
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: 9007199254740992 }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain('safeIntegers(true)');
            });

            it('rejects a non-integer number', () => {
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: 10.5 }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain('integer');
            });

            it('rejects a bare decimal string and names the hydration remedy', () => {
                // A bare '10' is what node-postgres default int8 hydration produces.
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: '10' }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain('types.setTypeParser(20, BigInt)');
            });

            it('rejects a malformed tagged value without throwing', () => {
                // The EncodedBigInt type admits any string payload; the binder must not let a
                // non-canonical one reach BigInt() (which would throw) nor bind it.
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: 'abc' } }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
            });

            it('rejects a tagged value on an undeclared-kind column, naming the columnKinds remedy', () => {
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: '10' } }];
                const result = _buildAfterBoundaryWhereClause(entries, identity, 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain(`columnKinds['n'] = 'bigint'`);
            });

            it('binds the bigint into the equality-prefix arm of a multi-key boundary, in order', () => {
                const entries: BoundaryEntry[] = [
                    { key: 'n', direction: 1, value: { $bigint: '12345678901234567' } },
                    { key: 'id', direction: 1, value: 'Z' },
                ];
                const pg = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(pg.success).toBe(true);
                if (!pg.success) return;
                expect(pg.statement.sql).toBe('((n > $1 OR n IS NULL)) OR (n = $2 AND (id > $3 OR id IS NULL))');
                expect(pg.statement.parameters).toEqual(['12345678901234567', '12345678901234567', 'Z']);
                const sqlite = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'sqlite');
                expect(sqlite.success).toBe(true);
                if (!sqlite.success) return;
                expect(sqlite.statement.parameters).toEqual([12345678901234567n, 12345678901234567n, 'Z']);
            });

            it('rejects a tagged object on a text or numeric key', () => {
                for (const kind of ['text', 'numeric'] as const) {
                    const entries: BoundaryEntry[] = [{ key: 'k', direction: 1, value: { $bigint: '10' } }];
                    const result = _buildAfterBoundaryWhereClause(entries, withKinds({ k: kind }), 'pg');
                    expect(result.success, `expected rejection on a ${kind} key`).toBe(false);
                    if (result.success) continue;
                    expect(result.errors[0]!.type).toBe('cursor');
                }
            });

            it('a one-shot hostile getter cannot corrupt the bind: the single guarded read wins [dec-encode-snapshots]', () => {
                // A getter can produce a canonical payload once and then throw or change; the
                // binder must act only on what its single guarded read saw, never re-reading.
                let reads = 0;
                const oneShot = {
                    get $bigint(): string {
                        reads += 1;
                        if (reads > 1) throw new Error('re-read of a one-shot value');
                        return '10';
                    },
                };
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: oneShot }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(true);
                if (!result.success) return;
                expect(result.statement.parameters).toEqual(['10']);
            });

            it('rejects a canonical payload too long for int64 without materialising or echoing it', () => {
                // A million-digit canonical string passes the shape check but can never come from
                // an int64 column; the rejection must not build the value or dump it into the message.
                const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: { $bigint: '9'.repeat(1_000_000) } }];
                const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
                expect(result.success).toBe(false);
                if (result.success) return;
                expect(result.errors[0]!.type).toBe('cursor');
                expect(result.errors[0]!.message).toContain('int64');
                expect(result.errors[0]!.message.length).toBeLessThan(500);
            });

        });

        it('translates a boolean boundary to a real boolean parameter for Postgres', () => {
            const t = _buildAfterBoundaryWhereClause([{ key: 'flag', direction: 1, value: 'true' }], withKinds({ flag: 'boolean' }), 'pg');
            const f = _buildAfterBoundaryWhereClause([{ key: 'flag', direction: 1, value: 'false' }], withKinds({ flag: 'boolean' }), 'pg');
            expect(t.success && f.success).toBe(true);
            if (!t.success || !f.success) return;
            expect(t.statement.parameters).toEqual([true]);
            expect(f.statement.parameters).toEqual([false]);
        });

        it('translates a boolean boundary to 1/0 for SQLite', () => {
            const t = _buildAfterBoundaryWhereClause([{ key: 'flag', direction: 1, value: 'true' }], withKinds({ flag: 'boolean' }), 'sqlite');
            const f = _buildAfterBoundaryWhereClause([{ key: 'flag', direction: 1, value: 'false' }], withKinds({ flag: 'boolean' }), 'sqlite');
            expect(t.success && f.success).toBe(true);
            if (!t.success || !f.success) return;
            expect(t.statement.parameters).toEqual([1]);
            expect(f.statement.parameters).toEqual([0]);
        });
    });

    describe('Error propagation', () => {
        it('returns the converter error when a key cannot be resolved', () => {
            const failing = (_k: string): DotPropPathConversionResult =>
                ({ success: false, error: { type: 'invalid_path', dotPropPath: 'bad', message: 'Bad path' } });
            const result = _buildAfterBoundaryWhereClause([{ key: 'bad', direction: 1, value: 'x' }], failing, 'pg');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors[0]!.message).toBe('Bad path');
        });
    });
});
