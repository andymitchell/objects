import { describe, test, expect } from "vitest";
import type { WhereClauseError } from "../sql/types.ts";
import { classifyWhereClauseErrors, classifyInsertError } from "./outcomes.ts";

/**
 * The adapters decide a filter's fate from the typed shape of a compile error, not from its prose. These tests
 * pin that mapping so a future edit to an error's message cannot silently change whether a filter is skipped,
 * rejected, or treated as a non-match.
 */

const pathError = (type: 'unknown_path' | 'invalid_path' | 'unsupported_kind' | 'unexpected_kind' | 'missing_schema'): WhereClauseError =>
    ({ kind: 'path_conversion', error: { type, dotPropPath: 'a.b', message: `path ${type}` }, message: `path ${type}` });

const filterError = (reasonCode: 'malformed_filter' | 'regex_invalid' | 'regex_options' | 'regex_too_complex'): WhereClauseError =>
    ({ kind: 'filter', reasonCode, sub_filter: {}, root_filter: {}, message: `filter ${reasonCode}` });

describe('classifying a failed SQL compilation into a typed outcome', () => {

    describe('a path the engine cannot address', () => {
        test('an array beneath a record key is an acknowledged capability gap, not a non-match', () => {
            expect(classifyWhereClauseErrors([pathError('unsupported_kind')])).toEqual({ kind: 'unsupported', code: 'record_value_array' });
        });

        test.each(['unknown_path', 'invalid_path', 'unexpected_kind'] as const)(
            'an unresolvable %s IS a missing field, so it is a definite non-match',
            (type) => {
                expect(classifyWhereClauseErrors([pathError(type)])).toEqual({ kind: 'matched', value: false });
            });
    });

    describe('a broken filter is rejected — the reference matcher throws on it too', () => {
        test('a malformed filter rejects as malformed_filter', () => {
            const outcome = classifyWhereClauseErrors([filterError('malformed_filter')]);
            expect(outcome.kind).toBe('rejected');
            expect(outcome).toMatchObject({ code: 'malformed_filter' });
        });
        test('a broken regex pattern rejects as regex_invalid', () => {
            expect(classifyWhereClauseErrors([filterError('regex_invalid')])).toMatchObject({ kind: 'rejected', code: 'regex_invalid' });
        });
    });

    describe('a valid filter the dialect cannot express is an acknowledged skip', () => {
        test('an unhonourable regex flag skips as regex_options', () => {
            expect(classifyWhereClauseErrors([filterError('regex_options')])).toMatchObject({ kind: 'unsupported', code: 'regex_options' });
        });
        test('an inexpressible regex metacharacter skips as regex_too_complex', () => {
            expect(classifyWhereClauseErrors([filterError('regex_too_complex')])).toMatchObject({ kind: 'unsupported', code: 'regex_too_complex' });
        });
        test('a shape-ambiguous schema skips as schema_ambiguous', () => {
            expect(classifyWhereClauseErrors([{ kind: 'schema_ambiguous', dotprop_path: 'x', message: 'm' }])).toMatchObject({ kind: 'unsupported', code: 'schema_ambiguous' });
        });
        test('a value-normalizing schema skips as schema_normalizes', () => {
            expect(classifyWhereClauseErrors([{ kind: 'schema_normalizes', dotprop_path: 'x', message: 'm' }])).toMatchObject({ kind: 'unsupported', code: 'schema_normalizes' });
        });
    });

    describe('priority when several errors coexist mirrors the historic cascade', () => {
        test('a record-array gap outranks every other error', () => {
            expect(classifyWhereClauseErrors([filterError('malformed_filter'), pathError('unsupported_kind')]))
                .toMatchObject({ kind: 'unsupported', code: 'record_value_array' });
        });
        test('an unresolvable path outranks a rejection (a missing field wins over a throw)', () => {
            expect(classifyWhereClauseErrors([filterError('malformed_filter'), pathError('unknown_path')]))
                .toEqual({ kind: 'matched', value: false });
        });
    });
});

describe('classifying a database INSERT failure', () => {
    test('a Postgres null-byte rejection is an environmental non-match linked to divergence #10', () => {
        expect(classifyInsertError(new Error('unsupported Unicode escape sequence')))
            .toEqual({ kind: 'environmental', code: 'pg_null_byte_unstorable', value: false, divergenceId: '#10', detail: 'unsupported Unicode escape sequence' });
    });
    test('any other insert error is not recognised, so the caller rethrows it', () => {
        expect(classifyInsertError(new Error('disk full'))).toBe(undefined);
        expect(classifyInsertError('not even an error')).toBe(undefined);
    });
});
