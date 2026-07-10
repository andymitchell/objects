/**
 * Wrap a string as a Postgres escape-string literal, e.g. `O'Brien` → `E'O''Brien'`.
 *
 * In an ordinary Postgres literal a backslash means itself, but only while `standard_conforming_strings` is
 * on. That is a session setting: turn it off and a backslash begins an escape, so a value ending in one
 * consumes the closing quote and everything after it becomes SQL. An escape-string literal (`E'…'`) always
 * treats a backslash as an escape, so doubling both the backslash and the quote leaves nothing for either
 * setting to reinterpret.
 *
 * The `E` prefix is emitted for every value, not only for those holding a backslash. A rule that inspects a
 * value before deciding how to quote it is a rule that must be re-derived by every reader, and re-derived
 * correctly; quoting one way makes safety independent of what the value contains.
 *
 * @param value the text to embed, such as a jsonb object key.
 * @returns the quoted literal, including its `E` prefix and surrounding quotes.
 *
 * @example
 * pgQuoteLiteral("O'Brien");     // `E'O''Brien'`
 * pgQuoteLiteral('back\\slash'); // `E'back\\\\slash'`
 *
 * @remarks
 * The quote is doubled rather than backslash-escaped, so the result does not depend on the `backslash_quote`
 * setting either.
 */
export function pgQuoteLiteral(value: string): string {
    return `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/**
 * Build a Postgres accessor that reads one member out of a jsonb column, e.g. `(data->'contact'->>'name')`.
 *
 * Postgres addresses jsonb members by key, one operator per step: `->` yields jsonb, `->>` yields text. The
 * final step chooses between them — a scalar is usually wanted as text so it can be cast and compared, while
 * an object or array must stay jsonb. Intermediate steps are always `->`, because only jsonb can be indexed
 * further.
 *
 * Every key is quoted, so a key carrying a quote or a comment marker is inert data rather than syntax.
 *
 * @param columnName the jsonb column, or any expression yielding jsonb.
 * @param segments decoded key segments, in path order. Any string is admissible.
 * @param options `asText` reads the final member with `->>`; otherwise the accessor yields jsonb throughout.
 * @returns the parenthesised accessor, ready for a cast to be appended.
 *
 * @example
 * pgJsonbAccessor('data', ['contact', 'name'], { asText: true });  // "(data->E'contact'->>E'name')"
 * pgJsonbAccessor('data', ['tags'], { asText: false });            // "(data->E'tags')"
 */
export function pgJsonbAccessor(columnName: string, segments: readonly string[], options: { asText: boolean }): string {
    const path = segments
        .map((segment, index) => {
            const isLast = index === segments.length - 1;
            const operator = isLast && options.asText ? '->>' : '->';
            return `${operator}${pgQuoteLiteral(segment)}`;
        })
        .join('');
    return `(${columnName}${path})`;
}
