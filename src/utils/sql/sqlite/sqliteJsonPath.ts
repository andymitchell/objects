/**
 * Render key segments as a SQLite JSON path, e.g. `['contact', 'name']` → `$."contact"."name"`.
 *
 * SQLite's JSON functions address a member with a path string. An unquoted label ends at the next `.` or
 * `[`, so a key holding either character — or a quote, or nothing at all — cannot be written plainly. A
 * bracket-quoted label lifts that restriction: SQLite parses it as a JSON string, which is exactly what
 * `JSON.stringify` produces for any JavaScript string.
 *
 * Every segment is quoted, not just the awkward ones. A key is data, and data that must be inspected before
 * it is safe is a rule waiting to be forgotten; quoting unconditionally makes correctness independent of the
 * key's contents.
 *
 * @param segments decoded key segments, in path order. Any string is admissible, including one holding a
 *   dot, a quote, a backslash, a control character, or the empty string.
 * @returns the path, always beginning `$`. Pass it through {@link sqliteSqlStringLiteral} before embedding.
 *
 * @example
 * sqliteJsonPathSegments(['a.b']);       // '$."a.b"'        — one key holding a literal dot
 * sqliteJsonPathSegments(["O'Brien"]);   // `$."O'Brien"`    — quotes are data, not syntax
 * sqliteJsonPathSegments(['a"b']);       // '$."a\\"b"'      — a JSON string escape, not a doubled quote
 */
export function sqliteJsonPathSegments(segments: readonly string[]): string {
    return '$' + segments.map(segment => `.${JSON.stringify(segment)}`).join('');
}

/**
 * Wrap a string as a SQLite SQL string literal, doubling any single quote it contains.
 *
 * SQLite reads `''` inside a literal as one quote and has no other escape, so doubling is complete: a
 * backslash carries no meaning and needs no treatment.
 *
 * @param value the text to embed, such as a JSON path from {@link sqliteJsonPathSegments}.
 * @returns the quoted literal, including its surrounding quotes.
 *
 * @example
 * sqliteSqlStringLiteral(`$."O'Brien"`); // `'$."O''Brien"'`
 */
export function sqliteSqlStringLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
