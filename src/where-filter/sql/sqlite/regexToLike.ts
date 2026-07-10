/** How a translated pattern compares against a value. */
export type LikeComparison = 'equals' | 'startsWith' | 'endsWith' | 'contains';

/**
 * A pattern SQLite can answer, or the reason it cannot.
 *
 * `not_well_defined` means the pattern is broken and no engine could honour it — the value-driven matcher throws
 * on it too, so a caller should reject the filter. `options_unsupported` and `too_complex` mean the pattern is
 * valid but asks for more than `LIKE` can express (a non-`i` flag, or any regex metacharacter) — a capability
 * gap the caller should decline rather than answer.
 */
export type LikeTranslation =
    | { readonly success: true; readonly comparison: LikeComparison; readonly operand: string }
    | { readonly success: false; readonly reason: 'not_well_defined' | 'options_unsupported' | 'too_complex'; readonly message: string };

/**
 * Translate a `$regex` payload into a `LIKE` comparison, when one exists.
 *
 * SQLite has no regular-expression operator. `LIKE` can express a literal substring, optionally anchored to the
 * start or end of the value — and nothing more. A pattern is therefore translated only when, once its anchors are
 * stripped, what remains is literal text.
 *
 * @param pattern The `$regex` operand.
 * @param options The `$options` operand. `i` is a no-op, because `LIKE` is already ASCII case-insensitive.
 * @returns The comparison and the (LIKE-escaped) operand to compare against, or why the pattern cannot be answered.
 *
 * @example
 * translateRegexToLike('^ann', undefined);  // { success: true, comparison: 'startsWith', operand: 'ann%' }
 * translateRegexToLike('a.b', undefined);   // { success: false, reason: 'too_complex', … } — `.` is a wildcard
 * translateRegexToLike('a[', undefined);    // { success: false, reason: 'not_well_defined', … }
 *
 * @remarks
 * A `%` or `_` in the pattern is literal text to a regex but a wildcard to `LIKE`, so both are escaped and the
 * caller must emit `ESCAPE '\'` alongside the comparison.
 */
export function translateRegexToLike(pattern: string, options: string | undefined): LikeTranslation {
    const opts = options ?? '';

    // Mirror the JS oracle (`new RegExp($regex, $options)`): an invalid pattern or an invalid flag is broken,
    // not merely inexpressible.
    try {
        new RegExp(pattern, options);
    } catch {
        return { success: false, reason: 'not_well_defined', message: `$regex is not well-defined: /${pattern}/${opts}` };
    }

    // Any flag other than `i` (m/s/u/y/…) changes matching in a way LIKE cannot reproduce.
    if ([...opts].some(flag => flag !== 'i')) {
        return { success: false, reason: 'options_unsupported', message: '$regex $options is unsupported for SQLite LIKE translation' };
    }

    const anchoredStart = pattern.startsWith('^');
    const anchoredEnd = pattern.endsWith('$');
    let body = pattern;
    if (anchoredStart) body = body.slice(1);
    if (anchoredEnd) body = body.slice(0, -1);

    // Once the anchors are stripped, any regex metacharacter — a char class `[]`, group `()`, quantifier `{}+*?`,
    // wildcard `.`, alternation `|`, a backslash escape, or a mid-string anchor `^`/`$` — is a genuine regex
    // feature LIKE cannot express. A body of literal characters (letters, digits, `-`, `%`, `_`) translates.
    if (/[[\](){}+*?.|\\^$]/.test(body)) {
        return { success: false, reason: 'too_complex', message: '$regex pattern is too complex for SQLite LIKE translation' };
    }

    const literal = body.replace(/%/g, '\\%').replace(/_/g, '\\_');

    if (anchoredStart && anchoredEnd) return { success: true, comparison: 'equals', operand: literal };
    if (anchoredStart) return { success: true, comparison: 'startsWith', operand: `${literal}%` };
    if (anchoredEnd) return { success: true, comparison: 'endsWith', operand: `%${literal}` };
    return { success: true, comparison: 'contains', operand: `%${literal}%` };
}
