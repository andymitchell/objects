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

        it('rejects any boundary on a bigint key', () => {
            const entries: BoundaryEntry[] = [{ key: 'n', direction: 1, value: '123' }];
            const result = _buildAfterBoundaryWhereClause(entries, withKinds({ n: 'bigint' }), 'pg');
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.errors[0]!.type).toBe('cursor');
            expect(result.errors[0]!.message.toLowerCase()).toContain('bigint');
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
