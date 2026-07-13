import type { WhereFilterDefinition } from "../../types.ts";

/**
 * The document shape every ground-truth case is written against.
 *
 * One shape serves the whole corpus so a case is a row + a filter and nothing else — no per-case schema, no
 * generic parameter to thread. Every field is optional, which is what makes "the field is absent" expressible:
 * a case that omits `age` produces a document with no `age` key, in memory and in the collection alike.
 */
export type TruthRow = {
    name?: string;
    age?: number | null;
    active?: boolean;
    tags?: string[];
    scores?: number[];
    items?: { k?: string, v?: number }[];
    groups?: { tags?: string[], subtags?: string[] }[];
};

/**
 * One executable claim about MongoDB.
 *
 * A case is a sentence from `MONGO-DIVERGENCES.md` or `DECISIONS.md` turned into something a real `mongod` can
 * answer. `mongo` is what the register says MongoDB does; `ours` is what the register says this package does.
 * Asserting both is what stops a divergence entry from drifting into fiction — a divergence is only a
 * divergence if the two answers really differ, and a conformance claim is only true if they really agree.
 */
export type MongoTruthCase = {
    /** Stable identifier. Doubles as the document `_id`, so it must be unique across the corpus. */
    id: string;
    /** Where the claim is written down, e.g. `MONGO-DIVERGENCES.md #13`. */
    source: string;
    /** The claim, in the register's own words. */
    claim: string;
    /** The document to test. */
    row: TruthRow;
    /**
     * The filter to apply.
     *
     * Untyped, because the corpus tests the language the *engines* accept, which is wider than the one
     * `WhereFilterDefinition<TruthRow>` can express: a path descending through an array (`items.k`) and a
     * comparison operator on an array field are both accepted by the validity gate — as MongoDB accepts them —
     * but neither is reachable from a schema-derived type. A filter arriving as JSON can carry either.
     */
    filter: WhereFilterDefinition;
    /** What a real `mongod` answers. Verified, never assumed. */
    mongo: boolean;
    /** What this package's JS matcher answers. */
    ours: boolean;
};
