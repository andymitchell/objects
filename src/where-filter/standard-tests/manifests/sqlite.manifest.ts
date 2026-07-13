/**
 * SQLite's frozen capability manifest: every seam the conformance battery acknowledges rather than proves.
 *
 * Each line is `kind ::: reason ::: testName`. `unsupported` = a filter SQLite's JSON/LIKE engine cannot express
 * (a capability gap that skips); `divergence` = a definite verdict that departs from the reference, documented in
 * `MONGO-DIVERGENCES.md`. The drift-guard (`assertNoCapabilityDrift`) fails if this set changes in either
 * direction, so closing a gap or introducing a new skip is a deliberate edit here, never a silent slide.
 *
 * Captured from a green run; do not hand-edit without a corresponding behaviour change.
 */
export const SQLITE_MANIFEST: readonly string[] = [
    // Capability gaps — SQLite's LIKE cannot express these regex features, so the filter is skipped.
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.4 quantifier \"a{2}\" matches \"aa\"",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.5 quantifier \"a{2}\" rejects \"a\"",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.7 mid-string escaped \"^\" matches literally",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.17 $options \"m\" (multiline) honoured",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.18 $options \"s\" (dotall) honoured",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.20 multi-flag \"im\" honoured",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.23 character class \"[abc]\" matches \"b\"",
    "unsupported ::: not supported ::: sqlite where clause builder > 11. $regex engine fidelity > 11.24 \".\" wildcard matches any single char",
    // A shape-ambiguous (scalar | array) schema is unrepresentable by a schema-driven emitter.
    "unsupported ::: scalar|array ambiguous schema: schema-driven SQL cannot represent it (returns undefined); JS duck-types to true — see MONGO-DIVERGENCES.md (value-driven JS vs schema-driven SQL) ::: sqlite where clause builder > 10. Schema conformance (value-driven JS vs schema-driven SQL) > a shape-ambiguous (scalar | array) schema is unrepresentable in schema-driven SQL (rejected), while JS still duck-types",
    // An array beneath a record's dynamic key cannot be spread.
    "unsupported ::: an array inside a record value is an acknowledged unsupported path ::: sqlite where clause builder > 26. Paths through a record > 26.5 an array inside a record value is refused, never silently unmatched",
    // Documented divergences from MongoDB semantics.
    "divergence ::: #3 $regex case-sensitivity on SQLite ::: sqlite where clause builder > 11. $regex engine fidelity > 11.16 case-sensitive by default: \"andy\" does not match \"Andy\"",
    "divergence ::: $regex case-sensitivity: SQLite LIKE is case-insensitive for ASCII ::: sqlite where clause builder > 2. Scalar value comparisons > $regex > $regex case-sensitive default: fails",
    "divergence ::: Infinity in stored data: see MONGO-DIVERGENCES.md §7 — JSON spec excludes Infinity, lost at JSON.stringify boundary ::: sqlite where clause builder > 2. Scalar value comparisons > Numeric edge values (NaN, Infinity, -0) > Infinity exceeds any finite bound",
    "divergence ::: array under a scalar-declared field: value-driven JS containment vs schema-driven SQL — see MONGO-DIVERGENCES.md (value-driven JS vs schema-driven SQL) ::: sqlite where clause builder > 10. Schema conformance (value-driven JS vs schema-driven SQL) > array data under a scalar-declared field: JS matches by containment, schema-driven SQL does not",
];
