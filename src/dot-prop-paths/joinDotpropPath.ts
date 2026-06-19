/**
 * Append a segment onto a dot-prop path prefix — the inverse of splitting a path on `.`. The one place
 * dot-prop ancestry is assembled, so every path-producing walk emits the same canonical `a.b.c` form
 * (an empty prefix yields the bare segment, never a leading dot).
 *
 * @example
 * joinDotpropPath("", "child");   // "child"
 * joinDotpropPath("a.b", "c");    // "a.b.c"
 */
export function joinDotpropPath(prefix: string, segment: string): string {
    return prefix ? `${prefix}.${segment}` : segment;
}
