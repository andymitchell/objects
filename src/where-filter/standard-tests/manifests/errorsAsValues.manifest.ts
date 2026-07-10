/**
 * The errors-as-values reference consumer's capability manifest: empty.
 *
 * It wraps the same reference matcher, differing only in that a malformed filter surfaces as a resolved
 * `undefined` rather than a throw — which is a REJECTION, not an acknowledged seam. So it too acknowledges
 * nothing, and the drift-guard freezes that.
 */
export const ERRORS_AS_VALUES_MANIFEST: readonly string[] = [];
