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
        id: '#13',
        note: 'A comparison operator on an array field is not element-wise here; MongoDB traverses the array.',
        claims: (filter, isArrayField) => someFieldCondition(filter, isArrayField, (isArray, condition) => {
            if (!isArray || !isOperatorPayload(condition)) return false;
            // `$not` inherits the polarity of whatever it negates, so look through it.
            const payloads = [condition, ...operandsOf(condition, '$not').filter(isOperatorPayload)];
            return payloads.some(p => Object.keys(p).some(k => NON_TRAVERSING_ON_ARRAY.has(k)));
        }),
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
            + 'Consequence — the oracle is BLIND to a real divergence here: MongoDB treats a multi-value `$all` on '
            + 'such a path as an $and of independent matches, so `{"groups.subtags":{$all:["d","a"]}}` matches when '
            + '"d" and "a" live in DIFFERENT groups, where this package requires one leaf array to hold both. That '
            + 'divergence is real and unwitnessed; it needs an example-based test, not a fuzz property.',
    },
];

/**
 * Disagreements that are CONFIRMED BUGS in this package — not accepted divergences.
 *
 * They are listed so the oracle can run green while they are outstanding, and they are kept apart from
 * {@link KNOWN_DIVERGENCES} because the distinction is the whole point: a divergence is a decision, a bug is a
 * debt. Each entry cites the MongoDB behaviour it violates and must be DELETED, not re-explained, when fixed —
 * the deletion is its regression test.
 */
export const PENDING_BUGS: readonly KnownDivergence[] = [
    {
        id: 'BUG-A',
        note: '`$type:"null"` matches a MISSING field here; MongoDB matches only a field that EXISTS and holds null. '
            + 'Verified against mongod 8.2.6 and stated outright by the manual\'s "Query for Null or Missing Fields" '
            + 'tutorial: "The { item : { $type: 10 } } query matches only documents that contain the item field whose '
            + 'value is null." (Equality to null — `{item: null}` — DOES match a missing field; $type does not.) '
            + 'NOTE: MONGO-DIVERGENCES.md #4 currently asserts the OPPOSITE — that the JS engine "matches, consistent '
            + 'with MongoDB" — and blames the SQL engines for answering false. The SQL engines were right.',
        claims: (filter, isArrayField) => someFieldCondition(filter, isArrayField, (_isArray, condition) =>
            isOperatorPayload(condition) && condition['$type'] === 'null'),
    },
    {
        id: 'BUG-B',
        note: '`$ne`/`$nin` on a dotted path into an array of objects means "SOME element differs" here; in MongoDB it '
            + 'means "NO element matches". Verified against mongod 8.2.6: `{"items.k":{$ne:"b"}}` does NOT match '
            + '`{items:[{k:"a"},{k:"b"},{k:"c"}]}` — one element has k=="b", so the document is excluded. The manual: '
            + '"$nin ... selects the documents whose field has an array with no element equal to a value in the '
            + 'specified array." ("some element differs" is what `{items:{$elemMatch:{k:{$ne:"b"}}}}` means, and that '
            + 'is a DIFFERENT query, which does match.)',
        claims: (filter, isArrayField) => someFieldCondition(filter, isArrayField, (_isArray, condition, path) =>
            // Only a path that DESCENDS THROUGH an array (`items.k`) — a plain array field (`tags`) taking `$ne`
            // is MONGO-DIVERGENCES.md #13, a different and already-accepted thing.
            path.includes('.') && isOperatorPayload(condition) && ('$ne' in condition || '$nin' in condition)),
    },
];

/** The operators MongoDB applies element-wise on an array field, and this package applies to the array itself. */
const NON_TRAVERSING_ON_ARRAY: ReadonlySet<string> = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$regex']);

const isOperatorPayload = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).some(isOperatorKey);

const operandsOf = (payload: Record<string, unknown>, op: string): unknown[] =>
    op in payload ? [payload[op]] : [];

/** Visit every `(operator, operand)` pair anywhere in the filter, at any depth. */
function someOperator(node: unknown, pred: (op: string, operand: unknown) => boolean): boolean {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(child => someOperator(child, pred));
    return Object.entries(node as Record<string, unknown>).some(([key, value]) =>
        (isOperatorKey(key) && pred(key, value)) || someOperator(value, pred));
}

/** Visit every field path and the condition applied to it, at any depth. */
function someFieldCondition(
    node: unknown,
    isArrayField: (path: string) => boolean,
    pred: (fieldIsArray: boolean, condition: unknown, path: string) => boolean,
): boolean {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(child => someFieldCondition(child, isArrayField, pred));
    return Object.entries(node as Record<string, unknown>).some(([key, value]) => {
        // A logic operator's arms are filters in their own right; any other operator is not a field.
        if (isOperatorKey(key)) return someFieldCondition(value, isArrayField, pred);
        return pred(isArrayField(key), value, key) || someFieldCondition(value, isArrayField, pred);
    });
}
