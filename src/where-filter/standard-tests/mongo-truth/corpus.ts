import type { MongoTruthCase } from "./types.ts";

/**
 * Every claim this package makes about MongoDB, written so a real `mongod` can settle it.
 *
 * `MONGO-DIVERGENCES.md` and `DECISIONS.md` are full of sentences beginning "MongoDB:". Prose cannot be run, so
 * such a sentence can be wrong for years without anything noticing — and one of them was, asserting the exact
 * opposite of what the server does. Each case below restates one of those sentences as a document, a filter, and
 * the two answers the register promises: MongoDB's, and this package's.
 *
 * A case therefore fails in three distinct ways, and each means something different:
 * - the `mongo` answer is wrong — the register is describing a MongoDB that does not exist;
 * - the `ours` answer is wrong — the register is describing a package that does not exist;
 * - they were equal and now differ (or vice versa) — a divergence has appeared or been fixed, and the register
 *   has not caught up.
 *
 * `ours` is measured against the JS reference matcher. Whether the SQL engines agree with it is a separate
 * question, and the `standardTests` battery is what answers it.
 */
export const MONGO_TRUTH_CORPUS: readonly MongoTruthCase[] = [

    // ---------------------------------------------------------------------------------------------------------
    // Conformance: the readings this package shares with MongoDB. A failure here is a regression, not a divergence.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'conformance-bare-scalar-contains',
        source: 'MONGO-DIVERGENCES.md #8',
        claim: 'A scalar equality also matches a document whose field is an array containing it (containment).',
        row: { tags: ['a', 'b'] },
        filter: { tags: 'a' },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-in-intersects-array',
        source: 'MONGO-DIVERGENCES.md #13',
        claim: '$in applies across an array\'s elements by intersection.',
        row: { tags: ['a', 'b'] },
        filter: { tags: { $in: ['b', 'z'] } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-elemmatch-value-ops',
        source: 'MONGO-DIVERGENCES.md #13',
        claim: '$elemMatch is how an operator is made element-wise; it matches when one element satisfies the whole body.',
        row: { scores: [1, 9] },
        filter: { scores: { $elemMatch: { $gt: 5, $lt: 20 } } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-size-counts-the-array',
        source: 'MONGO-DIVERGENCES.md #6 (retired)',
        claim: '$size counts the array\'s own elements.',
        row: { tags: ['a', 'b'] },
        filter: { tags: { $size: 2 } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-multi-operator-payload-is-a-conjunction',
        source: 'DECISIONS.md Release notes',
        claim: 'Multiple operators in one payload are conjunctive.',
        row: { age: 7 },
        filter: { age: { $gt: 5, $lt: 10 } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-range-type-brackets',
        source: 'DECISIONS.md #1',
        claim: 'A comparison against a wrong-typed stored value does not match, and does not error — comparison operators type-bracket.',
        row: { name: 'cheap' },
        filter: { name: { $gt: 'm' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'conformance-not-negates-on-a-missing-field',
        source: 'DECISIONS.md #5',
        claim: '$not negates its operand rather than short-circuiting on a missing field, so { $not: { $ne: 5 } } does not match an absent field.',
        row: { name: 'ann' },
        filter: { age: { $not: { $ne: 5 } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'conformance-not-exists-false-negates',
        source: 'DECISIONS.md #5',
        claim: '{ $not: { $exists: false } } is false on an absent field.',
        row: { name: 'ann' },
        filter: { age: { $not: { $exists: false } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'conformance-regex-is-case-sensitive-by-default',
        source: 'MONGO-DIVERGENCES.md #3',
        claim: '$regex is case-sensitive by default.',
        row: { name: 'Andy' },
        filter: { name: { $regex: 'andy' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'conformance-regex-options-i-is-case-insensitive',
        source: 'MONGO-DIVERGENCES.md #3',
        claim: '$options: "i" makes $regex case-insensitive.',
        row: { name: 'Andy' },
        filter: { name: { $regex: 'andy', $options: 'i' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-type-bool-is-the-bson-type-name',
        source: 'MONGO-DIVERGENCES.md #5',
        claim: 'MongoDB spells the boolean BSON type name "bool".',
        row: { active: true },
        filter: { active: { $type: 'bool' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-bson-keeps-infinity',
        source: 'MONGO-DIVERGENCES.md #7',
        claim: 'BSON stores Infinity as a Double, so it survives an insert and out-ranks any finite bound.',
        row: { age: Infinity },
        filter: { age: { $gt: 1e308 } },
        mongo: true,
        ours: true,
    },
    {
        id: 'conformance-bson-keeps-a-null-byte',
        source: 'MONGO-DIVERGENCES.md #10',
        claim: 'A BSON string is a length-prefixed byte sequence, so an embedded U+0000 stores and queries like any other character.',
        row: { name: 'a\u0000b' },
        filter: { name: 'a\u0000b' },
        mongo: true,
        ours: true,
    },

    // ---------------------------------------------------------------------------------------------------------
    // #1 — $type checks the field, not array elements.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'divergence-1-type-does-not-reach-array-elements',
        source: 'MONGO-DIVERGENCES.md #1',
        claim: 'MongoDB matches when at least one array element has the type; this package checks the field\'s own type, so an array field has type "array".',
        row: { tags: ['a'] },
        filter: { tags: { $type: 'string' } },
        mongo: true,
        ours: false,
    },
    {
        id: 'divergence-1-type-array-is-the-shared-reading',
        source: 'MONGO-DIVERGENCES.md #1',
        claim: 'Both agree that an array field has type "array" — this is the escape hatch the divergence points at.',
        row: { tags: ['a'] },
        filter: { tags: { $type: 'array' } },
        mongo: true,
        ours: true,
    },

    // ---------------------------------------------------------------------------------------------------------
    // #2 — an empty $all.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'divergence-2-empty-all-matches-nothing-in-mongodb',
        source: 'MONGO-DIVERGENCES.md #2',
        claim: 'MongoDB matches no document; this package returns true (Array.every over an empty list).',
        row: { tags: ['a'] },
        filter: { tags: { $all: [] } },
        mongo: false,
        ours: true,
    },

    // ---------------------------------------------------------------------------------------------------------
    // $type: 'null' — a missing field has no type at all.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'type-null-does-not-match-a-missing-field',
        source: 'MONGO-DIVERGENCES.md #4 (retired)',
        claim: '$type: "null" matches only a field that is present and holds null. A missing field has no type, so it does not match.',
        row: { name: 'ann' },
        filter: { age: { $type: 'null' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'type-null-matches-a-stored-null',
        source: 'MONGO-DIVERGENCES.md #4 (retired)',
        claim: 'A field that exists and holds null does match $type: "null".',
        row: { name: 'ann', age: null },
        filter: { age: { $type: 'null' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'type-null-is-not-plain-equality',
        source: 'MONGO-DIVERGENCES.md #4 (retired)',
        claim: 'This is the one place $type: "null" parts company with plain equality: { field: null } matches a missing field, and must keep doing so.',
        row: { name: 'ann' },
        filter: { age: null },
        mongo: true,
        ours: true,
    },
    {
        id: 'type-null-negated-on-a-missing-field',
        source: 'DECISIONS.md #5',
        claim: '$not negates its operand, so a missing field — having no type — matches { $not: { $type: "null" } }.',
        row: { name: 'ann' },
        filter: { age: { $not: { $type: 'null' } } },
        mongo: true,
        ours: true,
    },

    // ---------------------------------------------------------------------------------------------------------
    // A comparison operator against an array field reads element-wise.
    //
    // Each operator in a field condition is applied independently across the elements, and conjoined at the
    // document level — which is not the same question as $elemMatch, and the two part company on the very first
    // example that has more than one bound.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'element-wise-eq-on-an-array-field',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$eq on an array field matches when some element equals the operand.',
        row: { tags: ['a'] },
        filter: { tags: { $eq: 'a' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'element-wise-range-on-an-array-field',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: 'A range bound on an array field matches when some element satisfies it.',
        row: { scores: [9] },
        filter: { scores: { $gt: 5 } },
        mongo: true,
        ours: true,
    },
    {
        id: 'element-wise-ne-is-the-complement-of-eq',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$ne is the complement of $eq, so an array holding the operand does not match — "no element equals it", not "some element differs".',
        row: { tags: ['x'] },
        filter: { tags: { $ne: 'x' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-ne-matches-when-no-element-equals',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$ne on an array field matches when no element equals the operand.',
        row: { tags: ['x'] },
        filter: { tags: { $ne: 'z' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'element-wise-ne-is-not-some-element-differs',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$ne is NOT "some element differs" — an array holding the operand alongside other values is still excluded, because one element does equal it.',
        row: { tags: ['a', 'b'] },
        filter: { tags: { $ne: 'a' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-not-range-is-not-some-element-differs',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: 'The same holds for a negated range: one element inside the bound excludes the row, whatever the others do.',
        row: { scores: [1, 9] },
        filter: { scores: { $not: { $gt: 5 } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-not-eq-negates-an-element-wise-match',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$not negates the element-wise match, so an array holding the operand is excluded.',
        row: { tags: ['x'] },
        filter: { tags: { $not: { $eq: 'x' } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-not-range-negates-an-element-wise-match',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: 'The same holds for a negated range bound.',
        row: { scores: [9] },
        filter: { scores: { $not: { $gt: 5 } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-not-regex-negates-an-element-wise-match',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: 'The same holds for a negated $regex.',
        row: { tags: ['x'] },
        filter: { tags: { $not: { $regex: 'x' } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-bounds-are-applied-independently',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: 'Each bound is applied independently across the elements, so different elements may satisfy different bounds.',
        row: { scores: [1, 5] },
        filter: { scores: { $gt: 2, $lt: 4 } },
        mongo: true,
        ours: true,
    },
    {
        id: 'element-wise-is-not-elemmatch',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$elemMatch asks the opposite question — whether ONE element satisfies the whole body — so it does not match where independent bounds do.',
        row: { scores: [1, 5] },
        filter: { scores: { $elemMatch: { $gt: 2, $lt: 4 } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'element-wise-elemmatch-still-finds-a-single-element',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$elemMatch still matches when one element does satisfy the whole body.',
        row: { tags: ['a'] },
        filter: { tags: { $elemMatch: { $eq: 'a' } } },
        mongo: true,
        ours: true,
    },
    {
        id: 'element-wise-not-size-still-describes-the-array-itself',
        source: 'MONGO-DIVERGENCES.md #13 (retired)',
        claim: '$size describes the array itself rather than an element, so negating it is unaffected.',
        row: { tags: ['a', 'b'] },
        filter: { tags: { $not: { $size: 3 } } },
        mongo: true,
        ours: true,
    },

    // ---------------------------------------------------------------------------------------------------------
    // #15 — $exists / $type inside a scalar $elemMatch body.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'divergence-15-exists-in-an-elemmatch-body',
        source: 'MONGO-DIVERGENCES.md #15',
        claim: 'MongoDB reads $exists element-wise, so it matches any non-empty array; this package compares the body as a literal object against each element, which nothing equals.',
        row: { tags: ['a'] },
        filter: { tags: { $elemMatch: { $exists: true } } },
        mongo: true,
        ours: false,
    },
    {
        id: 'divergence-15-type-in-an-elemmatch-body',
        source: 'MONGO-DIVERGENCES.md #15',
        claim: 'The same holds for $type.',
        row: { tags: ['a'] },
        filter: { tags: { $elemMatch: { $type: 'string' } } },
        mongo: true,
        ours: false,
    },
    {
        id: 'divergence-15-mixing-with-a-scalar-predicate-does-not-rescue-it',
        source: 'MONGO-DIVERGENCES.md #15',
        claim: 'Mixing a field-level operator with a scalar predicate does not rescue the body, even though the scalar predicate alone would match.',
        row: { tags: ['a'] },
        filter: { tags: { $elemMatch: { $exists: true, $eq: 'a' } } },
        mongo: true,
        ours: false,
    },

    // ---------------------------------------------------------------------------------------------------------
    // Negation on a path that descends through an array. MongoDB negates the document-level match: "no candidate
    // matches", not "some candidate differs".
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'negation-ne-excludes-when-any-element-matches',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$ne on an array-descended path means no element matches, so an array holding the forbidden value excludes the document.',
        row: { items: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] },
        filter: { 'items.k': { $ne: 'b' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'negation-ne-still-matches-when-no-element-matches',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$ne still matches when the forbidden value is absent from every element.',
        row: { items: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] },
        filter: { 'items.k': { $ne: 'z' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-not-eq-behaves-as-ne',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$ne is sugar for $not { $eq }, so it negates the same document-level match.',
        row: { items: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] },
        filter: { 'items.k': { $not: { $eq: 'b' } } },
        mongo: false,
        ours: false,
    },
    {
        id: 'negation-double-negation-unwinds',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'Negation composes: { $not: { $ne: "b" } } asks whether some element does equal "b".',
        row: { items: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] },
        filter: { 'items.k': { $not: { $ne: 'b' } } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-nin-excludes-when-any-leaf-holds-a-forbidden-value',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$nin is sugar for $not { $in }, so one leaf holding a forbidden value excludes the document.',
        row: { groups: [{ tags: ['a'] }, { tags: ['x'] }] },
        filter: { 'groups.tags': { $nin: ['x'] } },
        mongo: false,
        ours: false,
    },
    {
        id: 'negation-elemmatch-binds-to-one-element',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$elemMatch is the construct that binds a predicate to a single element, so an inner $ne asks whether some element differs.',
        row: { items: [{ k: 'a' }, { k: 'b' }] },
        filter: { items: { $elemMatch: { k: { $ne: 'b' } } } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-composes-with-an-array-leaf',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'A negation over a path whose leaves are themselves arrays composes both readings: no leaf may hold the operand.',
        row: { groups: [{ tags: ['x'] }] },
        filter: { 'groups.tags': { $ne: 'x' } },
        mongo: false,
        ours: false,
    },
    {
        id: 'negation-composes-with-an-array-leaf-when-absent',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'The same negation matches when no leaf holds the operand.',
        row: { groups: [{ tags: ['x'] }] },
        filter: { 'groups.tags': { $ne: 'z' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-exists-false-when-one-element-carries-the-field',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$exists: false is a negation too: the path resolves as soon as ONE element carries the field, so the document is excluded.',
        row: { items: [{ k: 'a' }, { v: 1 }] },
        filter: { 'items.k': { $exists: false } },
        mongo: false,
        ours: false,
    },
    {
        id: 'negation-exists-false-when-no-element-carries-the-field',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'When NO element carries the field, the path reaches nothing at all — which is a missing field, so $exists: false matches.',
        row: { items: [{ v: 1 }, { v: 2 }] },
        filter: { 'items.k': { $exists: false } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-exists-true-when-one-element-carries-the-field',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$exists: true is the positive form — one element carrying the field is enough.',
        row: { items: [{ k: 'a' }, { v: 1 }] },
        filter: { 'items.k': { $exists: true } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-on-an-absent-spread-source',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'A negation vacuously matches when the path has no candidates at all — an absent array excludes nothing.',
        row: { name: 'ann' },
        filter: { 'items.k': { $ne: 'b' } },
        mongo: true,
        ours: true,
    },
    {
        id: 'negation-on-an-empty-spread-source',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'The same holds for an empty array.',
        row: { items: [] },
        filter: { 'items.k': { $ne: 'b' } },
        mongo: true,
        ours: true,
    },

    // ---------------------------------------------------------------------------------------------------------
    // #16 — a field condition on a nested-array path binds to a single leaf, where MongoDB conjoins each operator
    // independently over the flattened candidate set.
    // ---------------------------------------------------------------------------------------------------------

    {
        id: 'divergence-16-all-across-two-leaves',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'MongoDB reads a multi-value $all as an $and of independent matches, so it matches when the values sit in different leaf arrays; this package requires one leaf to hold them all.',
        row: { groups: [{ subtags: ['b', 'd'] }, { subtags: ['c', 'a'] }] },
        filter: { 'groups.subtags': { $all: ['d', 'a'] } },
        mongo: true,
        ours: false,
    },
    {
        id: 'divergence-16-compound-payload-across-two-leaves',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'Each operator in a compound payload is applied independently over the candidate set, so different leaves may satisfy different operators.',
        row: { groups: [{ tags: ['a'] }, { tags: ['bx'] }] },
        filter: { 'groups.tags': { $all: ['a'], $elemMatch: { $eq: 'bx' } } },
        mongo: true,
        ours: false,
    },
    {
        id: 'divergence-16-range-bounds-across-two-elements',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'The same holds for range bounds: MongoDB matches when one element clears the lower bound and another clears the upper, even though no single element clears both.',
        row: { items: [{ v: 1 }, { v: 5 }] },
        filter: { 'items.v': { $gt: 2, $lt: 3 } },
        mongo: true,
        ours: false,
    },
    {
        id: 'divergence-16-single-value-all-agrees',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'A single-value $all has nothing to split across leaves, so both agree.',
        row: { groups: [{ subtags: ['b', 'd'] }, { subtags: ['c', 'a'] }] },
        filter: { 'groups.subtags': { $all: ['d'] } },
        mongo: true,
        ours: true,
    },
    {
        id: 'divergence-16-size-is-per-leaf-on-both',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: '$size counts one leaf array, so a single operator on a nested-array path agrees.',
        row: { groups: [{ subtags: ['b', 'd'] }, { subtags: [] }] },
        filter: { 'groups.subtags': { $size: 2 } },
        mongo: true,
        ours: true,
    },
    {
        id: 'divergence-16-bare-containment-agrees',
        source: 'MONGO-DIVERGENCES.md #16',
        claim: 'Bare containment on a nested-array path agrees — one candidate holding the value is all either side needs.',
        row: { groups: [{ subtags: ['b', 'd'] }, { subtags: ['c', 'a'] }] },
        filter: { 'groups.subtags': 'a' },
        mongo: true,
        ours: true,
    },
];
