import type { Predicate } from "../ast/index.ts";
import type { TreeNode } from "../../dot-prop-paths/schema-tree.ts";
import type { ResolvedPath } from "../../dot-prop-paths/resolvePath-types.ts";

/**
 * A field condition bound to ONE leaf array, rather than to the pooled elements of every array the path reaches.
 *
 * A path such as `groups.subtags` names a `subtags` array per `groups` entry. The condition attached to it must
 * be satisfied by a single one of those arrays — `{$size: 2, $all: ['a']}` asks for one leaf array holding two
 * elements of which one is `'a'`, not for two elements somewhere and an `'a'` somewhere else. SQL reaches an
 * inner array by spreading the outer ones, and a spread flattens; this node records the split that keeps the
 * condition whole: which arrays to spread, and which keys then address the leaf array within one spread element.
 */
export type TraverseArrayPredicate = {
    readonly kind: 'traverseArray';
    /**
     * The nodes to spread, ending at the last array ABOVE the leaf array. Empty when the leaf array is the only
     * array on the path, in which case the leaf is addressed directly from the column.
     */
    readonly intermediates: readonly TreeNode[];
    /** The keys addressing the leaf array from a spread element (or from the column, when nothing is spread). */
    readonly leafSegments: readonly string[];
    /** The leaf array's node. Its schema types the elements for `$elemMatch` and sub-document conditions. */
    readonly leafArrayNode: TreeNode;
    /** The whole condition, evaluated against one leaf array. */
    readonly child: Predicate;
};

/**
 * What a SQL emitter dispatches on: the engine-neutral {@link Predicate}, plus the one node only a query needs.
 *
 * The value-driven matcher holds an array in its hand and never has to plan a traversal, so `traverseArray` has
 * no meaning for it and stays out of `Predicate` — leaving that union total for the evaluator's exhaustive switch.
 */
export type SqlPredicate = Predicate | TraverseArrayPredicate;

/**
 * Plan how a SQL emitter should reach the array a path ends at, so a condition on it binds to one leaf array.
 *
 * @param resolved The path, resolved against the schema. The leaf array's node travels on it, identity-verified.
 * @param predicate The whole field condition. It is wrapped as one unit — a conjunction stays inside the wrapper,
 *   which is what confines every operator of the conjunction to the same leaf array.
 * @returns A `traverseArray` node when the path's leaf is an array; otherwise `predicate` unchanged, because
 *   a scalar or object leaf is read from each spread element rather than bound to an array of its own.
 *
 * @example
 * // `groups` is an array of `{subtags: string[]}`
 * planSqlArrayTraversal(resolve('groups.subtags'), pred);
 * // → { kind: 'traverseArray', intermediates: [groups], leafSegments: ['subtags'], … }
 *
 * @remarks
 * `leafSegments` are node names in path order, so a key holding a literal dot stays one segment. `intermediates`
 * carries only named nodes: an array element has no name of its own and contributes nothing to a JSON path.
 */
export function planSqlArrayTraversal(resolved: ResolvedPath, predicate: Predicate): SqlPredicate {
    if (resolved.arrayDepth === 0) return predicate;

    // The leaf array's node arrives identity-verified on the resolution (its ancestry spells the segments), so
    // an accessor rebuilt from it addresses the field the path names. A record_value path — or any path with no
    // enumerated node — has none, and there is no schema-planned array to traverse, so the predicate passes through.
    const leafArrayNode = resolved.node;
    if (!leafArrayNode || leafArrayNode.kind !== 'array') return predicate;

    const named = namedAncestry(leafArrayNode);
    const lastIntermediateArray = lastIndexOfArrayBelowLeaf(named);

    return {
        kind: 'traverseArray',
        intermediates: named.slice(0, lastIntermediateArray + 1),
        leafSegments: named.slice(lastIntermediateArray + 1).map(node => node.name),
        leafArrayNode,
        child: predicate,
    };
}

/** The named nodes from the root down to (and including) `node`. Array elements are nameless and drop out. */
function namedAncestry(node: TreeNode): TreeNode[] {
    const chain: TreeNode[] = [];
    let target: TreeNode | undefined = node;
    while (target) {
        if (target.name) chain.unshift(target);
        target = target.parent;
    }
    return chain;
}

/** The index of the last array node strictly above the leaf, or `-1` when the leaf array is the only one. */
function lastIndexOfArrayBelowLeaf(named: readonly TreeNode[]): number {
    for (let i = named.length - 2; i >= 0; i--) {
        if (named[i]!.kind === 'array') return i;
    }
    return -1;
}
