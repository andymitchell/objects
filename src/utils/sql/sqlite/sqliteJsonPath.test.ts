import { describe, test, expect } from "vitest";
import Database from 'better-sqlite3';
import { sqliteJsonPathSegments, sqliteSqlStringLiteral } from "./sqliteJsonPath.ts";

/**
 * These helpers encode how the installed SQLite parses a JSON path label, which its documentation does not
 * spell out. The rendering is therefore asserted against a real database rather than against a remembered
 * rule: if a future SQLite stops reading a bracket-quoted label as a JSON string, these tests say so loudly
 * instead of letting a key silently address the wrong member.
 */
const db = new Database(':memory:');

/** Read the member at `segments` out of a stored object, exactly as an emitter would address it. */
function extract(stored: Record<string, unknown>, segments: readonly string[], storage: 'text' | 'jsonb' = 'text'): unknown {
    const literal = sqliteSqlStringLiteral(JSON.stringify(stored));
    const json = storage === 'jsonb' ? `jsonb(${literal})` : literal;
    const path = sqliteSqlStringLiteral(sqliteJsonPathSegments(segments));
    const row = db.prepare(`SELECT json_extract(${json}, ${path}) AS v`).get() as { v: unknown };
    return row.v;
}

/**
 * Keys that would each escape an unquoted label, an unquoted SQL literal, or both. `simple` is here so the
 * uniform-quoting claim is tested on an ordinary key too, not only on awkward ones.
 *
 * The path-lookalikes (`[0]`, `#`, `#-1`, `$.x`) and the escape-lookalikes (a literal backslash followed by
 * `n`, or by `u0041`) are the classes that would break first if a future SQLite stopped reading a
 * bracket-quoted label as a JSON string: each would then be reparsed as path structure, or unescaped into a
 * different key entirely.
 */
const HOSTILE_KEYS = [
    'simple',
    "O'Brien",
    'a"b',
    'a.b',
    "a.b'c",
    "x' OR TRUE --",
    'x"];SELECT',
    "x'); DROP TABLE t;--",
    'with[bracket]',
    'a.b[0]',
    '[0]',
    'a[1].b',
    '$',
    '$.x',
    '#',
    '#-1',
    'with$dollar',
    'escape\\n',
    'escape\\u0041',
    'nul\u0000byte',
    'ret\u000Durn',
    'back\\slash',
    'trailing\\',
    '',
    'sp ace',
    'tab\there',
    'new\nline',
    'quote"and\\both',
    'real\u0009tab',
    'real\u000Anewline',
    'ctrl\u0001char',
    'emoji\u{1F600}',
] as const;

describe('a key is addressed as data, whatever characters it holds', () => {

    test.each(HOSTILE_KEYS.map(key => [JSON.stringify(key), key] as const))(
        'the key %s addresses its own member',
        (_name, key) => {
            expect(extract({ [key]: 'HIT' }, [key])).toBe('HIT');
        }
    );

    test('a key addresses only its own member, never a neighbour', () => {
        const stored = { "O'Brien": 'target', innocent: 'other' };
        expect(extract(stored, ["O'Brien"])).toBe('target');
        expect(extract(stored, ['absent'])).toBe(null);
    });

    test('a key holding a dot is one member, not a path through two', () => {
        expect(extract({ 'a.b': 'literal' }, ['a.b'])).toBe('literal');
        expect(extract({ a: { b: 'nested' } }, ['a.b'])).toBe(null);
        expect(extract({ a: { b: 'nested' } }, ['a', 'b'])).toBe('nested');
    });

    test('a hostile key cannot reach a member it does not name', () => {
        // Were the key spliced in as syntax rather than data, `OR TRUE` would make this row match anything.
        expect(extract({ innocent: 'v' }, ["x' OR TRUE --"])).toBe(null);
        expect(extract({ innocent: 'v' }, ['x"];SELECT'])).toBe(null);
    });

    test('a key deep in a path is quoted like any other', () => {
        expect(extract({ 'a.b': { "O'Brien": 'deep' } }, ['a.b', "O'Brien"])).toBe('deep');
    });

    test('a key that looks like an escape sequence is not one', () => {
        // Were the label unescaped a second time, `escapeA` would address the key `escapeA`.
        const stored = { 'escape\\u0041': 'literal', escapeA: 'unescaped' };
        expect(extract(stored, ['escape\\u0041'])).toBe('literal');
    });

    test('the same keys resolve when the column holds SQLite\'s binary jsonb, which re-encodes them', () => {
        for (const key of HOSTILE_KEYS) {
            expect(extract({ [key]: 'HIT' }, [key], 'jsonb')).toBe('HIT');
        }
    });
});

describe('the rendered path and literal', () => {

    test('every segment is bracket-quoted, so no key needs inspecting first', () => {
        expect(sqliteJsonPathSegments(['contact', 'name'])).toBe('$."contact"."name"');
    });

    test('a quote inside a key is a JSON string escape, not a doubled quote', () => {
        expect(sqliteJsonPathSegments(['a"b'])).toBe('$."a\\"b"');
    });

    test('a backslash inside a key is doubled, as a JSON string requires', () => {
        expect(sqliteJsonPathSegments(['back\\slash'])).toBe('$."back\\\\slash"');
    });

    test('a single quote is doubled when the path becomes a SQL literal', () => {
        expect(sqliteSqlStringLiteral(sqliteJsonPathSegments(["O'Brien"]))).toBe(`'$."O''Brien"'`);
    });

    test('an empty segment list is the root', () => {
        expect(sqliteJsonPathSegments([])).toBe('$');
    });
});

describe('the path form the array spreader relies on', () => {

    test('json_each accepts the same quoted path', () => {
        const json = sqliteSqlStringLiteral(JSON.stringify({ "O'Brien": ['x', 'y', 'z'] }));
        const path = sqliteSqlStringLiteral(sqliteJsonPathSegments(["O'Brien"]));
        const row = db.prepare(`SELECT count(*) AS c FROM json_each(${json}, ${path})`).get() as { c: number };
        expect(row.c).toBe(3);
    });
});
