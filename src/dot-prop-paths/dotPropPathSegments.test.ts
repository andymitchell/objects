import { describe, test, expect } from "vitest";
import { getProperty } from "dot-prop";
import { escapeDotPropPathSegment, parseDotPropPathSegments } from "./dotPropPathSegments.ts";

describe('a dot-prop path names keys, and a dot inside a key is escaped', () => {

    test('an unescaped dot separates keys', () => {
        expect(parseDotPropPathSegments('a.b')).toEqual(['a', 'b']);
        expect(parseDotPropPathSegments('one')).toEqual(['one']);
    });

    test('an escaped dot belongs to the key', () => {
        expect(parseDotPropPathSegments('a\\.b')).toEqual(['a.b']);
        expect(parseDotPropPathSegments('x.a\\.b.y')).toEqual(['x', 'a.b', 'y']);
    });

    test('a separator with nothing beside it yields an empty key, which callers refuse', () => {
        expect(parseDotPropPathSegments('')).toEqual(['']);
        expect(parseDotPropPathSegments('.')).toEqual(['', '']);
        expect(parseDotPropPathSegments('a..b')).toEqual(['a', '', 'b']);
        expect(parseDotPropPathSegments('.a')).toEqual(['', 'a']);
        expect(parseDotPropPathSegments('a.')).toEqual(['a', '']);
    });

    test('a backslash before anything but a dot is part of the key', () => {
        expect(parseDotPropPathSegments('a\\b')).toEqual(['a\\b']);
        expect(parseDotPropPathSegments('trail\\')).toEqual(['trail\\']);
    });
});

describe('escaping a key and parsing it back returns the key', () => {

    const KEYS = ['plain', 'a.b', '.leading', 'trailing.', 'a.b.c', '', "O'Brien", 'sp ace', 'emoji\u{1F600}', '[0]', '$', '#'] as const;

    test.each(KEYS.map(key => [JSON.stringify(key), key] as const))('%s survives a round trip', (_name, key) => {
        expect(parseDotPropPathSegments(escapeDotPropPathSegment(key))).toEqual([key]);
    });

    test('several keys joined into one path parse back to those keys', () => {
        const keys = ['rows', 'a.b', 'deep'];
        const path = keys.map(escapeDotPropPathSegment).join('.');
        expect(path).toBe('rows.a\\.b.deep');
        expect(parseDotPropPathSegments(path)).toEqual(keys);
    });

    test('a rendered path is read the same way by the dot-prop resolver', () => {
        // The paths this grammar renders are handed back to `getProperty`, so the two readers must agree.
        const path = ['rows', 'a.b'].map(escapeDotPropPathSegment).join('.');
        expect(getProperty({ rows: { 'a.b': 'v' } }, path)).toBe('v');
    });

    test('a key holding a backslash cannot be named by any path, escaped or not', () => {
        // Documented limit of the grammar: the key `a\` followed by the key `b` renders a path that reads
        // back as the single key `a.b`. Pinned so the loss is visible rather than surprising.
        const path = ['a\\', 'b'].map(escapeDotPropPathSegment).join('.');
        expect(path).toBe('a\\.b');
        expect(parseDotPropPathSegments(path)).toEqual(['a.b']);
    });
});
