/**
 * Postgres's frozen capability manifest: every seam the conformance battery acknowledges rather than proves.
 *
 * Each line is `kind ::: reason ::: testName`. `unsupported` = a filter the JSONB engine cannot express (a
 * capability gap that skips); `divergence` = a definite verdict that departs from the reference, documented in
 * `MONGO-DIVERGENCES.md`. The drift-guard (`assertNoCapabilityDrift`) fails if this set changes in either
 * direction, so closing a gap or introducing a new skip is a deliberate edit here, never a silent slide.
 *
 * Captured from a green run; do not hand-edit without a corresponding behaviour change.
 */
export const POSTGRES_MANIFEST: readonly string[] = [
    // A shape-ambiguous (scalar | array) schema is unrepresentable by a schema-driven emitter.
    "unsupported ::: scalar|array ambiguous schema: schema-driven SQL cannot represent it (returns undefined); JS duck-types to true — see MONGO-DIVERGENCES.md (value-driven JS vs schema-driven SQL) ::: postgres where clause builder > 10. Schema conformance (value-driven JS vs schema-driven SQL) > a shape-ambiguous (scalar | array) schema is unrepresentable in schema-driven SQL (rejected), while JS still duck-types",
    // An array beneath a record's dynamic key cannot be spread.
    "unsupported ::: an array inside a record value is an acknowledged unsupported path ::: postgres where clause builder > 26. Paths through a record > 26.5 an array inside a record value is refused, never silently unmatched",
    // Documented divergences from MongoDB semantics.
    "divergence ::: #10 Postgres cannot store a U+0000 (null byte) ::: postgres where clause builder > 19. Exotic values & binding > 19.19 a null byte in the value binds and matches",
    "divergence ::: #4 $type null on missing fields ::: postgres where clause builder > 15. Nullish matrix > $type 'null' on a missing field",
    "divergence ::: #4 $type null on missing fields ::: postgres where clause builder > 22. $type mapping > 22.10 $type \"null\" on a missing field",
    "divergence ::: $type null on missing field: SQL returns SQL NULL not JSON null type ::: postgres where clause builder > 2. Scalar value comparisons > $type > $type \"null\" on missing optional field (JS treats missing as null; SQL may not)",
    "divergence ::: Infinity in stored data: see MONGO-DIVERGENCES.md §7 — JSON spec excludes Infinity, lost at JSON.stringify boundary ::: postgres where clause builder > 2. Scalar value comparisons > Numeric edge values (NaN, Infinity, -0) > Infinity exceeds any finite bound",
    "divergence ::: array under a scalar-declared field: value-driven JS containment vs schema-driven SQL — see MONGO-DIVERGENCES.md (value-driven JS vs schema-driven SQL) ::: postgres where clause builder > 10. Schema conformance (value-driven JS vs schema-driven SQL) > array data under a scalar-declared field: JS matches by containment, schema-driven SQL does not",
];
