import { Query } from "mingo";

/**
 * Evaluate a filter with `mingo` — an independent implementation of the MongoDB query language.
 *
 * This is the conformance suite's *secondary* oracle. The differential fuzz (WF-P1) compares every engine
 * against our own JS reference matcher, which catches engine-vs-engine drift but is blind to a mistake the
 * reference itself makes about MongoDB: if the reference is wrong, every engine is wrong the same way and the
 * battery still passes. `mingo` shares no code and no assumptions with this package, so a disagreement between
 * it and the reference is evidence about *MongoDB conformance* rather than internal consistency.
 *
 * @param row - The document to test.
 * @param filter - The filter to apply. Must already be inside the portable operand domain
 *   (`MONGO-DIVERGENCES.md` #9) — a non-JSON carrier makes the reference throw while mingo answers, which is a
 *   gate divergence, not a semantic one, and would be noise here.
 * @returns Whether MongoDB (as implemented by mingo) considers the document a match.
 *
 * @example
 * evaluateWithMingo({ tags: ['a'] }, { tags: { $eq: 'a' } }); // true — Mongo compares element-wise
 * // ...where this package answers false; see MONGO-DIVERGENCES.md #13.
 *
 * @remarks
 * Constructing a `Query` compiles the filter, so mingo can reject a shape our gate accepts (and vice versa).
 * Callers must treat a throw as a datum — a mingo quirk to record — not as a crash.
 */
export function evaluateWithMingo(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    // mingo's `Query<T>` derives its criteria type from the document type, which cannot express this package's
    // filter union. Both sides are plain JSON objects at this boundary, so they cross it as such — the filter's
    // validity is already guaranteed by the gate, and the row by its schema.
    return new Query(filter).test(row);
}
