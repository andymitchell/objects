/**
 * Split a dot-prop path into its key segments, honouring the escape convention where `\.` is a literal dot
 * inside a key rather than a path separator. So `a\.b` is one key and `a.b` is two.
 *
 * This is the canonical statement of the path grammar's split rule — the property readers and the SQL
 * expression builders all resolve paths through it. A consumer addressing storage by a declared path should
 * split with this function rather than on the raw `.` character, or a key holding a literal dot lands on the
 * wrong location.
 *
 * A leading, trailing, or doubled unescaped dot yields an empty segment, which callers treat as an invalid
 * path rather than as a key named `''`.
 *
 * @param path the dot-prop path to split.
 * @returns the decoded keys, in path order. Always at least one segment.
 *
 * @example
 * parseDotPropPathSegments('a\\.b'); // ['a.b']
 * parseDotPropPathSegments('a.b');   // ['a', 'b']
 */
export function parseDotPropPathSegments(path: string): string[] {
    const segments: string[] = [];
    let current = '';
    for (let i = 0; i < path.length; i++) {
        if (path[i] === '\\' && path[i + 1] === '.') { current += '.'; i++; continue; } // escaped dot → literal
        if (path[i] === '.') { segments.push(current); current = ''; continue; }
        current += path[i];
    }
    segments.push(current);
    return segments;
}

/**
 * Render one key as a dot-prop path segment, escaping any dot it contains.
 *
 * Joining escaped segments with `.` produces a path that parses back to the same keys, so a key holding a
 * literal dot survives being written into a path and resolved again.
 *
 * @param segment the literal key.
 * @returns the key with each dot escaped.
 *
 * @example
 * escapeDotPropPathSegment('a.b'); // 'a\\.b'
 * escapeDotPropPathSegment('ab');  // 'ab'
 *
 * @remarks
 * A dot is the only character the path grammar escapes, so a key holding a backslash is written verbatim and
 * a path can be built that reads back as a different key: the key `a\` followed by the key `b` renders
 * `a\.b`, which parses as the single key `a.b`. Such a key cannot be named by any dot-prop path, escaped or
 * not, so this is a limit of the grammar rather than of this function.
 *
 * The output is canonical for readers that split with `parseDotPropPathSegments`. Readers built on the
 * dot-prop package's grammar (`getProperty` and the typed property helpers) agree on `\.` but ALSO decode
 * `\\` and bracket indexing, so a key containing those sequences is read differently by the two reader
 * families — see the `escaped-dot-path-grammar-split` divergence entry.
 */
export function escapeDotPropPathSegment(segment: string): string {
    return segment.replace(/\./g, '\\.');
}
