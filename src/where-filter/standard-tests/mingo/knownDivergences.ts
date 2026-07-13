import { isOperatorKey } from "../../ast/index.ts";

/**
 * The disagreements between this package and MongoDB that are already understood and written down.
 *
 * The secondary oracle's job is to surface Mongo-conformance mistakes we do not know about. It cannot do that
 * while it is also shouting about the ones we do. Each entry below claims a class of disagreement and cites the
 * `MONGO-DIVERGENCES.md` entry that explains it; a disagreement no entry claims is the oracle's actual output.
 *
 * A predicate must be as NARROW as the divergence it cites. A broad one silently swallows a real finding, which
 * is the one failure mode that would make this whole apparatus decorative — so each is pinned by a test proving
 * it fires on its own construct and stays silent on its neighbours.
 */
export type KnownDivergence = {
    /** The `MONGO-DIVERGENCES.md` entry that explains this class. */
    readonly id: string;
    /** Why MongoDB answers differently — the one-line version of the register entry. */
    readonly note: string;
    /** Whether this filter's disagreement is explained by that entry. */
    readonly claims: (filter: unknown, isArrayField: (path: string) => boolean) => boolean;
};

export const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [
    {
        id: '#2',
        note: 'An empty $all matches every document here (`[].every()` is vacuously true); MongoDB matches none.',
        claims: (filter) => someOperator(filter, (op, operand) => op === '$all' && Array.isArray(operand) && operand.length === 0),
    },
    {
        id: '#15',
        note: '$exists/$type in a scalar $elemMatch body describe no element, so the body matches nothing; MongoDB applies them element-wise.',
        claims: (filter) => someOperator(filter, (op, operand) =>
            op === '$elemMatch' && isOperatorPayload(operand) && Object.keys(operand).some(k => k === '$exists' || k === '$type')),
    },
];

/**
 * Places where `mingo` itself departs from MongoDB, so the oracle is BLIND rather than merely quiet.
 *
 * An entry here is more serious than a divergence: it marks a question the oracle cannot answer, because mingo
 * shares (or invents) the behaviour. Recording it keeps a future reader from mistaking silence for conformance.
 */
export const MINGO_QUIRKS: readonly { readonly note: string }[] = [
    {
        note: '$type does not traverse arrays in mingo. The MongoDB manual is explicit — "For documents where field '
            + 'is an array, $type returns documents in which at least one array element matches a type passed to '
            + '$type" — so `{tags:{$type:"string"}}` matches `{tags:["a"]}` in MongoDB. mingo answers false, which is '
            + 'the same answer this package gives (MONGO-DIVERGENCES.md #1). The oracle is therefore BLIND to #1: it '
            + 'shares the misunderstanding. #1 stands on the manual, not on this oracle, and no fuzz run can witness '
            + 'it. Should mingo fix this, #1 will begin surfacing as an unexplained disagreement — which is correct.',
    },
    {
        note: 'A path crossing TWO arrays is evaluated incorrectly by mingo. Verified against mongod 8.2.6: for '
            + '`groups:[{subtags:["b","d"]},{subtags:[]},{subtags:["c","a"]}]`, MongoDB matches '
            + '`{"groups.subtags":{$size:0}}` and `{$size:2}` and `{$all:["d"]}` — it resolves the path to the set of '
            + 'individual `subtags` ARRAYS and matches if ANY ONE satisfies the predicate. mingo answers false to all '
            + 'three. This package answers true, i.e. it AGREES with MongoDB and mingo is the outlier, so such paths '
            + 'are excluded from the oracle\'s generator rather than filtered from its output: an oracle that cannot '
            + 'evaluate a construct must not be asked about it. '
            + 'Consequence — the oracle is BLIND to a real divergence on such paths (MONGO-DIVERGENCES.md #16: a '
            + 'multi-value $all is an $and of independent matches in MongoDB, so it spans different groups, where '
            + 'this package requires one leaf array to hold every value). A fuzz property cannot cover what its '
            + 'oracle cannot answer, so that ground is held by example tests (§4) and the mongo-truth corpus.',
    },
];

/**
 * Disagreements that are CONFIRMED BUGS in this package — not accepted divergences.
 *
 * Kept apart from {@link KNOWN_DIVERGENCES} because the distinction is the whole point: a divergence is a
 * decision, a bug is a debt. An entry lets the oracle run green while the bug is outstanding, and must be
 * DELETED — never re-explained — when the bug is fixed. The deletion is its regression test: with nothing left
 * to claim the disagreement, a regression surfaces immediately as an unexplained shape.
 *
 * Empty is the healthy state.
 */
export const PENDING_BUGS: readonly KnownDivergence[] = [];

const isOperatorPayload = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).some(isOperatorKey);

/** Visit every `(operator, operand)` pair anywhere in the filter, at any depth. */
function someOperator(node: unknown, pred: (op: string, operand: unknown) => boolean): boolean {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(child => someOperator(child, pred));
    return Object.entries(node as Record<string, unknown>).some(([key, value]) =>
        (isOperatorKey(key) && pred(key, value)) || someOperator(value, pred));
}

