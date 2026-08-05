/**
 * The collation pin every Postgres text comparison carries, and the one place it is added or removed.
 *
 * Postgres compares and orders text under the database's default collation, which follows the server's locale —
 * so `'a' < 'B'` is true on `en_US` and false on `C`. The reference matcher and SQLite both compare by code
 * point, so a filter or a sort would otherwise mean something different on each database. Pinning `COLLATE "C"`
 * on the text expression itself makes the comparison locale-independent, and makes a filter, an `ORDER BY` and a
 * keyset predicate over one field address one identical expression — which is what lets a single expression
 * index serve all three, since Postgres matches an index to a query structurally, collation included.
 */
const PIN = ' COLLATE "C"';

/**
 * Pins a text expression to code-point comparison.
 *
 * @param textExpression - An expression whose type is text. Applying this to a non-text expression produces SQL
 *   Postgres rejects, since only a collatable type can carry a collation.
 * @returns The expression with the pin appended, or unchanged if it already carries it.
 *
 * @example
 * withCodePointCollation(`(data->>E'name')::text`); // `(data->>E'name')::text COLLATE "C"`
 */
export function withCodePointCollation(textExpression: string): string {
    return textExpression.endsWith(PIN) ? textExpression : `${textExpression}${PIN}`;
}

/**
 * Removes the code-point pin from an expression, for the comparisons that are not code-point comparisons.
 *
 * A regex asks the engine to case-fold, and under `C` Postgres folds ASCII only — so a pinned subject stops
 * matching `É` against `/é/i`, which the reference matcher matches. Stripping at the consumer rather than
 * asking each producer to opt out keeps the rule reliable: an expression is built once and may be read by any
 * operator, so the producer cannot know whether a regex will be the one to read it.
 *
 * @param expression - Any expression, pinned or not.
 * @returns The expression without a trailing pin. Unpinned input is returned unchanged.
 *
 * @example
 * withoutCodePointCollation(`(data->>E'name')::text COLLATE "C"`); // `(data->>E'name')::text`
 */
export function withoutCodePointCollation(expression: string): string {
    return expression.endsWith(PIN) ? expression.slice(0, -PIN.length) : expression;
}
