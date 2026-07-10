/**
 * The pure-JS reference matcher's capability manifest: empty.
 *
 * The reference expresses every filter and diverges from nothing (it IS the reference), so it acknowledges no
 * seam. The drift-guard still runs against this empty set: were the matcher to start skipping or diverging, that
 * would be a regression the guard catches immediately.
 */
export const JS_MANIFEST: readonly string[] = [];
