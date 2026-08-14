/**
 * Append a segment onto a dot-prop path prefix — the inverse of splitting a path on `.`. The one place
 * dot-prop ancestry is assembled, so every path-producing walk emits the same canonical `a.b.c` form
 * (an empty prefix yields the bare segment, never a leading dot).
 *
 * Both arguments are already-rendered path FRAGMENTS, joined verbatim. A raw object key must be
 * rendered with `escapeDotPropPathSegment` first (a key holding a literal dot needs its `\.` escape);
 * passing an escaped fragment back through here never double-escapes it.
 *
 * @example
 * joinDotpropPath("", "child");   // "child"
 * joinDotpropPath("a.b", "c");    // "a.b.c"
 * joinDotpropPath("a", escapeDotPropPathSegment("k.ey"));  // "a.k\\.ey" — ONE key named "k.ey"
 */
export function joinDotpropPath(prefix: string, segment: string): string {
    return prefix ? `${prefix}.${segment}` : segment;
}
