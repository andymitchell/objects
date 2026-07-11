import type { WhereClauseError } from "../sql/types.ts";

/**
 * The typed result of running one filter against one object through a conformance seam.
 *
 * Every back-end reduces to exactly one of four outcomes, so a consumer decides what to do from the
 * `kind` (and its typed `code`) rather than from a substring of a human-readable message:
 *
 * - `matched` — a definite verdict: the row does or does not match.
 * - `unsupported` — the engine cannot express this filter (a capability gap); an acknowledged skip, never
 *   a silent match or a confident `false`.
 * - `rejected` — the filter is malformed or contradictory; the value-driven matcher throws on it too.
 * - `environmental` — a hard platform limit outside the filter language (e.g. Postgres cannot store a null
 *   byte) forces a definite verdict that diverges from the reference, linked to a `MONGO-DIVERGENCES.md` id.
 *
 * @remarks
 * This is the adapters' internal currency: they classify a compile/execute round-trip into a `ConformanceOutcome`
 * with {@link classifyWhereClauseErrors} / {@link classifyInsertError}, then collapse it to the boolean/undefined
 * the conformance battery's seam expects. Keeping the classification typed removes the message-substring cascades
 * the adapters would otherwise carry.
 */
export type ConformanceOutcome =
    | { readonly kind: 'matched'; readonly value: boolean }
    | { readonly kind: 'unsupported'; readonly code: UnsupportedCode; readonly detail?: string }
    | { readonly kind: 'rejected'; readonly code: RejectionCode; readonly detail?: string }
    | { readonly kind: 'environmental'; readonly code: EnvironmentalCode; readonly value: boolean; readonly divergenceId: string; readonly detail?: string };

/** Why an engine declined a filter it understood but could not express. */
export type UnsupportedCode =
    | 'regex_options'        // a non-`i` regex flag SQLite's LIKE translation cannot honour
    | 'regex_too_complex'    // a regex metacharacter LIKE cannot express
    | 'schema_ambiguous'     // a `scalar | array` field a schema-driven emitter cannot represent
    | 'schema_normalizes'    // a coercing/transforming schema whose stored value the emitter cannot replicate
    | 'record_value_array'   // an array beneath a record's dynamic key, which the array spreader cannot address
    | 'dialect_mismatch'     // the translator targets a different SQL dialect than requested
    | 'path_unaddressable';  // any other path the engine cannot turn into an accessor

/** Why an engine rejected a filter as broken (the reference matcher throws on these too). */
export type RejectionCode = 'malformed_filter' | 'regex_invalid';

/** A hard platform limit outside the filter language that forces a divergent verdict. */
export type EnvironmentalCode = 'pg_null_byte_unstorable';

/**
 * Classify a failed SQL where-clause compilation into a typed outcome, by the errors' discriminated `kind`
 * and `type`/`reasonCode` — never by matching their message text.
 *
 * The priority mirrors the disposition each error class has always had:
 *  1. an array beneath a record key is a capability gap (skip), not a non-match;
 *  2. an unresolvable/unaddressable path IS a missing field, so it is a definite non-match (`matched:false`);
 *  3. a malformed filter or broken regex is a rejection (the reference throws);
 *  4. anything else — a valid filter the dialect cannot express — is a capability gap (skip).
 *
 * @param errors The `errors` array from a `{ success: false }` compile result. Must be non-empty.
 * @returns The typed outcome; `matched` only ever carries `false` here (a resolvable path that matches never fails).
 */
export function classifyWhereClauseErrors(errors: readonly WhereClauseError[]): ConformanceOutcome {
    if (errors.some(e => e.kind === 'path_conversion' && e.error.type === 'unsupported_kind')) {
        return { kind: 'unsupported', code: 'record_value_array' };
    }
    // An unknown/invalid/unexpected path cannot be addressed, which is exactly a missing field: a definite non-match.
    if (errors.some(e => e.kind === 'path_conversion'
        && (e.error.type === 'unknown_path' || e.error.type === 'invalid_path' || e.error.type === 'unexpected_kind'))) {
        return { kind: 'matched', value: false };
    }
    const rejection = errors.find(e => e.kind === 'filter' && (e.reasonCode === 'malformed_filter' || e.reasonCode === 'regex_invalid'));
    if (rejection && rejection.kind === 'filter') {
        return { kind: 'rejected', code: rejection.reasonCode as RejectionCode, detail: rejection.message };
    }
    return { kind: 'unsupported', code: residualUnsupportedCode(errors[0]!), detail: errors[0]!.message };
}

/** The capability-gap code for a residual error that is neither a record-array gap, an unresolvable path, nor a rejection. */
function residualUnsupportedCode(error: WhereClauseError): UnsupportedCode {
    switch (error.kind) {
        case 'filter':
            return error.reasonCode === 'regex_too_complex' ? 'regex_too_complex' : 'regex_options';
        case 'schema_ambiguous': return 'schema_ambiguous';
        case 'schema_normalizes': return 'schema_normalizes';
        case 'dialect_mismatch': return 'dialect_mismatch';
        case 'path_conversion': return 'path_unaddressable';
    }
}

/**
 * Classify a database INSERT failure. Postgres cannot store a U+0000 byte in `text`/`jsonb`, so a value carrying
 * one can never round-trip and a filter targeting it can never match — a hard platform limit, not a builder choice.
 *
 * @returns The environmental outcome for a recognised platform limit, or `undefined` for any other insert error
 *          (a real fault the caller must rethrow).
 */
export function classifyInsertError(e: unknown): (ConformanceOutcome & { kind: 'environmental' }) | undefined {
    if (e instanceof Error && /unsupported Unicode escape/i.test(e.message)) {
        return { kind: 'environmental', code: 'pg_null_byte_unstorable', value: false, divergenceId: '#10', detail: e.message };
    }
    return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// Acknowledgement collection → capability manifests
// ═══════════════════════════════════════════════════════════════════

/** An acknowledged seam: a filter an engine could not express (`unsupported`) or answered against spec (`divergence`). */
export type AcknowledgementKind = 'unsupported' | 'divergence';

/** One acknowledged seam, recorded where the assertion helper decides it, keyed later by all three fields. */
export type AcknowledgementEvent = {
    readonly kind: AcknowledgementKind;
    /** The reason handed to the helper (a `MONGO-DIVERGENCES.md` pointer for a divergence, or a capability note). */
    readonly reason: string;
    /** The full `describe > … > test` name, so two seams sharing a reason stay distinct. */
    readonly testName: string;
};

/**
 * Accumulates every acknowledged seam an engine reports across a battery run, so a drift-guard test can freeze
 * the set against a capability manifest. An engine gaining or losing an acknowledged seam is a behaviour change:
 * a NEW skip may hide a regression, a LOST skip means a gap was closed and the manifest should record it.
 */
export class AcknowledgementCollector {
    private readonly events: AcknowledgementEvent[] = [];

    record(event: AcknowledgementEvent): void {
        this.events.push(event);
    }

    /** The canonical, sorted `kind ::: reason ::: testName` lines a manifest freezes and a drift-guard compares. */
    snapshot(): string[] {
        return this.events.map(e => `${e.kind} ::: ${e.reason} ::: ${e.testName}`).sort();
    }
}
