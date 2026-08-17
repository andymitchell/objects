


import type { EnsureRecord } from "../types.js";
import type { PrimaryKeyValue } from "../utils/getKeyValue.ts";

/* ----------------------------------------------------------------------------
The dot-prop path grammar (canonical runtime statement: `parseDotPropPathSegments`) escapes a literal
dot inside a key: `rank\.value` is ONE key named `rank.value`, while `rank.value` is the two-segment
path rank → value. Every path-generating type in this file renders object keys through
`EscapeSegment`, and every path-consuming type splits on UNESCAPED dots only — so a spelling these
types offer is a spelling the runtime resolves, and vice versa.

A dot is the only character the grammar escapes, so a key ENDING in a backslash cannot address its
children by any spelling (`a\` + `.` + `b` renders `a\.b`, which decodes as the single key `a.b`).
The generators therefore offer such a key as a leaf and suppress its subtree.
---------------------------------------------------------------------------- */

/** Renders one object key as a path segment: each literal dot gains a backslash escape. Type-level mirror of `escapeDotPropPathSegment`. */
type EscapeSegment<S extends string> = S extends `${infer Head}.${infer Rest}` ? `${Head}\\.${EscapeSegment<Rest>}` : S;

/** Decodes one path segment back to the object key it names: each `\.` becomes a literal dot. */
type UnescapeSegment<S extends string> = S extends `${infer A}\\.${infer B}` ? `${A}.${UnescapeSegment<B>}` : S;

/** Splits a path at its first UNESCAPED dot: `[head, rest]`, or `[whole]` when every dot is escaped. Type-level mirror of `parseDotPropPathSegments`' split rule. */
type SplitFirstUnescapedDot<P extends string, Acc extends string = ''> =
    P extends `${infer Head}.${infer Rest}`
        ? Head extends `${string}\\`
            ? SplitFirstUnescapedDot<Rest, `${Acc}${Head}.`>
            : [`${Acc}${Head}`, Rest]
        : [`${Acc}${P}`];


export type DotPropPathsRecord<T extends Record<string, any>> = {
    [P in DotPropPathsUnion<T> as string & P]: PathValue<T, P>
};


export type DotPropPathsRecordWithOptionalAdditionalValues<T extends Record<string, any>, EV> = {
    [P in DotPropPathsUnion<T> as string & P]: PathValue<T, P> | EV
};


/*
type Path_WORKING_BUT_POSSIBLY_INFINITE<T> = T extends Array<any>
    ? never
    : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
        ? `${string & K}` | `${string & K}.${Path<T[K]>}`
        : never;
    }[keyof T]
    : '';

Switch on 14/7/2025: 
This was working fine in a lot of code. But I got a  "Type instantiation is excessively deep and possibly infinite.ts(2589)"
in the test 'handles complex discriminated unions with possibly infinite recursion [regression]'. 
I added depth guards to Path below. 
*/
type Path<T, Depth extends number = 6, ISD extends number = 2> = Depth extends 0 ? '' : T extends Array<any>
    ? never
    : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
        ? string extends K
            ? ISD extends 0
                ? `${string & K}` // Index-sig budget exhausted: just the key, no recursion
                : `${string & K}` | `${string & K}.${Path<NonNullable<T[K]>, ISD, Prev[ISD]>}`
            : number extends K
                ? never // Numeric index sig: not useful for dot-prop paths
                : `${EscapeSegment<string & K>}` | (K extends `${string}\\` ? never : `${EscapeSegment<string & K>}.${Path<NonNullable<T[K]>, Prev[Depth], ISD>}`)
        : never;
    }[keyof T]
    : '';

/**
 * Drops dangling paths that end in a path separator (`a.`), keeping paths whose final dot is escaped
 * data (`x\.` names a key called `x.`).
 */
export type RemoveTrailingDot<T> = T extends `${infer S}.` ? (S extends `${string}\\` ? T : never) : T;
/**
 * Union of every dot-prop path `T` declares, spelled in the escaped grammar the runtime parses:
 * a key holding a literal dot appears as `rank\.value`, never as the two-segment `rank.value`.
 */
export type DotPropPathsUnion<T, ISD extends number = 2> = { [K in Path<T, 6, ISD>]: RemoveTrailingDot<K> }[Path<T, 6, ISD>];
/**
 * Every path that steps INTO an array of objects and carries on to a path the element declares.
 *
 * The runtime path readers spread an array they cross and ask the rest of the path of each element, so
 * `items.k` names the `k` of every element of `items`. That rule is composed here from the two halves
 * that already state it: the paths ending at an array of objects, and the paths the element declares.
 *
 * An array holding a mix of objects and scalars contributes the paths its object members declare —
 * again matching the runtime, which puts the question to every element and takes the answer from those
 * that can supply one.
 */
type SpreadElementPaths<T extends Record<string, any>, ISD extends number> =
    ElementPathsUnder<T, DotPropPathToObjectArraySpreadingArrays<T>, ISD>;

/**
 * The paths declared by the element of the array at `P`, each spelled as a continuation of `P`.
 *
 * `P` is a naked type parameter so the conditional distributes: every object-array path is paired with
 * the element type IT holds, rather than with the union of every element type on `T`.
 */
type ElementPathsUnder<T extends Record<string, any>, P, ISD extends number> =
    P extends string
        ? PathValue<T, P> extends Array<infer Element>
            ? `${P}.${DotPropPathsUnion<EnsureRecord<Element>, ISD>}`
            : never
        : never;

/**
 * Union of every dot-prop path on `T` a filter may ask a question about.
 *
 * Three path families make up the domain, and together they cover every spelling the runtime path
 * readers resolve: paths that end at an array of objects, plain paths that stop at the first array,
 * and paths that step into an array of objects and carry on into its element (`items.k`,
 * `items.tags`).
 *
 * `ISD` bounds how far a path may step through an index signature, whose keys are open-ended; it is
 * threaded into every family that can traverse one.
 *
 * @remarks
 * This is a READ domain. It must never be reused as a write-target domain: a path that steps into an
 * array names a value inside each element, and an element is written by scoping into the array
 * (`array_scope`), never by a path through it.
 */
export type DotPropPathsIncArrayUnion<T extends Record<string,any>, ISD extends number = 2> =
    DotPropPathToObjectArraySpreadingArrays<T>
    | DotPropPathsUnion<T, ISD>
    | SpreadElementPaths<T, ISD>;



type Scalar = string | number | boolean | null | undefined;

/*
The key filters below all read `{[P in keyof T]-?: <test> ? P : never}[keyof T]`. The `-?` is load
bearing: the mapping is homomorphic, so an optional key would keep its `?` and the `[keyof T]` index
would then contribute `| undefined` to the key union. `undefined` is not a key, and a mapped type
indexed by it resolves to `unknown` — which absorbs whatever union the result feeds. Removing the
modifier from the RESULT does not alter `T[P]` inside the test, so the qualifying keys are unchanged.
*/

export type ScalarProperties<T> = { // Helper type to pick only scalar properties of an object
    [P in keyof T]-?: NonNullable<T[P]> extends Scalar ? P : never
}[keyof T];
/** Keys of T that can identify an item: always present, and holding a string or number. */
export type PrimaryKeyProperties<T> = {
    [P in keyof T]-?: T[P] extends PrimaryKeyValue ? P : never
}[keyof T];
type ObjectProperties<T> = { // Helper type to pick only non-scalar, non-array object properties
    [P in keyof T]-?: NonNullable<T[P]> extends object ? (NonNullable<T[P]> extends Array<any> ? never : P) : never
}[keyof T];
type ScalarPath<T extends Record<string, any>, Prefix extends string = ''> = T extends Scalar ? '' :
    {
        [P in keyof T]-?: P extends ScalarProperties<T> ? `${Prefix}${EscapeSegment<string & P>}` :
            P extends ObjectProperties<T>
            ? (P extends `${string}\\` ? never : `${Prefix}${EscapeSegment<string & P>}.${ScalarPath<NonNullable<T[P]>>}`)
            : never;
    }[keyof T];
/**
 * The index-signature budget left after a walk steps THROUGH key `K`.
 *
 * Only an open-ended key — one contributed by a string index signature — spends the budget. A declared
 * key names a single property, so stepping through it widens nothing and costs nothing.
 */
type SpendIndexSigBudget<K, ISD extends number> = string extends K ? Prev[ISD] : ISD;

/**
 * Whether a walk may still step THROUGH key `K`.
 *
 * An open-ended key needs index-signature budget to be traversed; a declared key never does. A key
 * whose own value is the leaf is unaffected — the walk stops there, so it never steps through anything.
 */
type MayStepThroughKey<K, ISD extends number> = string extends K ? (ISD extends 0 ? false : true) : true;

/**
 * Every path on `T` that ends at a scalar, stepping into an array of objects to reach its element.
 *
 * A path is offered whenever the runtime can walk it, so an optional or nullable object along the way
 * is traversed, and an array of objects is stepped into — `sub_items.val` names the `val` of each
 * element. An array whose element type is not wholly object ends the walk. Keys holding a literal dot
 * are spelled in the escaped grammar (`rank\.value`), and a key ending in a backslash is offered as a
 * leaf only, since no spelling can address its children.
 *
 * Two independent budgets keep the union finite and literal. `Depth` bounds object and array nesting,
 * so a self-referential row resolves to a finite union instead of a circular one — which TypeScript
 * answers with an error and a silent degradation to `any`. `ISD` bounds how far the walk may step
 * through an index signature, whose keys are open-ended: each such step adds another `${string}`
 * segment, expanding template literals without end. Beyond either budget the walk contributes nothing.
 *
 * @remarks
 * A `readonly` array is indistinguishable from a plain object to the array tests here, so its own
 * members (`length` and the array methods) are walked as if they were data. `Path` reads readonly
 * arrays the same way, so the two agree; closing the hole means fixing both in one change, or the
 * spread paths and the plain paths would offer different key domains for the same row.
 */
type ScalarPathSpreadingObjectArrays<T extends Record<string, any>, Depth extends number = 8, ISD extends number = 2, Prefix extends string = ''> =
    Depth extends 0 ? never : T extends Scalar ? '' :
    T extends Array<infer U>
    ? U extends object
        ? `${Prefix}${ScalarPathSpreadingObjectArrays<U, Prev[Depth], ISD>}`
        : never
    : {
        [P in keyof T]-?: P extends ScalarProperties<T> ? `${Prefix}${EscapeSegment<string & P>}` :
            MayStepThroughKey<P, ISD> extends false ? never :
            P extends ObjectProperties<T>
            ? (P extends `${string}\\` ? never : `${Prefix}${EscapeSegment<string & P>}.${ScalarPathSpreadingObjectArrays<NonNullable<T[P]>, Prev[Depth], SpendIndexSigBudget<P, ISD>>}`)
            : NonNullable<T[P]> extends Array<any> ? (NonNullable<T[P]>[number] extends object ?
                (P extends `${string}\\` ? never : `${Prefix}${EscapeSegment<string & P>}.${ScalarPathSpreadingObjectArrays<NonNullable<T[P]>[number], Prev[Depth], SpendIndexSigBudget<P, ISD>>}`) : never)
            : never;
    }[keyof T];
type ArrayOfScalarProperties<T> = {
    [P in keyof T]-?: NonNullable<T[P]> extends Array<infer U> ? U extends Scalar ? P : never : never
}[keyof T];
/**
 * Every path on `T` that ends at an array of scalars, stepping into an array of objects to reach its element.
 *
 * The sibling of {@link ScalarPathSpreadingObjectArrays}: the same walk, but the leaves it offers are
 * scalar-array keys (`msgs.labelIds`) rather than scalar keys, and it carries the same `Depth` and
 * `ISD` budgets with the same meaning.
 */
type ScalarPathToScalarArraySpreadingObjectArrays<T extends Record<string, any>, Depth extends number = 8, ISD extends number = 2, Prefix extends string = ''> =
    Depth extends 0 ? never : T extends Scalar ? '' :
    T extends Array<infer U>
    ? U extends object
        ? `${Prefix}${ScalarPathToScalarArraySpreadingObjectArrays<U, Prev[Depth], ISD>}`
        : never
    : {
        [P in keyof T]-?: P extends ScalarProperties<T> ? never :
            P extends ArrayOfScalarProperties<T> ? `${Prefix}${EscapeSegment<string & P>}` :
            MayStepThroughKey<P, ISD> extends false ? never :
            P extends ObjectProperties<T>
            ? (P extends `${string}\\` ? never : `${Prefix}${EscapeSegment<string & P>}.${ScalarPathToScalarArraySpreadingObjectArrays<NonNullable<T[P]>, Prev[Depth], SpendIndexSigBudget<P, ISD>>}`)
            : (NonNullable<T[P]> extends Array<any>
                ? (NonNullable<T[P]>[number] extends object
                    ? (P extends `${string}\\` ? never : `${Prefix}${EscapeSegment<string & P>}.${ScalarPathToScalarArraySpreadingObjectArrays<NonNullable<T[P]>[number], Prev[Depth], SpendIndexSigBudget<P, ISD>>}`)
                    : (NonNullable<T[P]>[number] extends Scalar
                        ? `${Prefix}${EscapeSegment<string & P>}`
                        : never))
                : never);

    }[keyof T];

export type DotPropPathsUnionScalar<T  extends Record<string, any>> = { [K in ScalarPath<T>]: RemoveTrailingDot<K> }[ScalarPath<T>];
/**
 * Union of every dot-prop path on `T` that ends at a scalar, stepping into an array of objects to
 * reach its element (`sub_items.val`).
 *
 * `Depth` bounds object and array nesting; `ISD` bounds how far a path may step through an index
 * signature. See {@link ScalarPathSpreadingObjectArrays} for what each budget protects against.
 */
export type DotPropPathsUnionScalarSpreadingObjectArrays<T  extends Record<string, any>, Depth extends number = 8, ISD extends number = 2> = { [K in ScalarPathSpreadingObjectArrays<T, Depth, ISD>]: RemoveTrailingDot<K> }[ScalarPathSpreadingObjectArrays<T, Depth, ISD>];
/**
 * Union of every dot-prop path on `T` that ends at an array of scalars, stepping into an array of
 * objects to reach its element (`msgs.labelIds`).
 *
 * `Depth` bounds object and array nesting; `ISD` bounds how far a path may step through an index
 * signature. See {@link ScalarPathSpreadingObjectArrays} for what each budget protects against.
 */
export type DotPropPathsUnionScalarArraySpreadingObjectArrays<T  extends Record<string, any>, Depth extends number = 8, ISD extends number = 2> = { [K in ScalarPathToScalarArraySpreadingObjectArrays<T, Depth, ISD>]: RemoveTrailingDot<K> }[ScalarPathToScalarArraySpreadingObjectArrays<T, Depth, ISD>];

/**
 * Keys of T whose value is not an array, however the key is declared.
 *
 * An optional (`tags?: string[]`) or undefinable (`tags: string[] | undefined`) array is still an
 * array, so it is excluded — the question is what the key HOLDS, not whether it is always present.
 * A key whose only value is `null` is answered before the array test, because `NonNullable<null>` is
 * `never` and `never` satisfies every constraint, `Array<any>` included.
 */
export type NonArrayProperty<T> = {
    [P in keyof T]-?: [NonNullable<T[P]>] extends [never]
        ? P
        : NonNullable<T[P]> extends Array<any> ? never : P
}[keyof T];

/**
 * Resolves to a union of keys of T for all properties that are not an array of objects.
 * This includes non-array properties and arrays of scalars.
 */
export type NonObjectArrayProperty<T> = NonArrayProperty<T> | ArrayOfScalarProperties<T>;



/**
 * The type of the value a dot-prop path resolves to on `T`.
 *
 * Reads the escaped path grammar: the path is split at UNESCAPED dots only, and each segment is
 * decoded (`\.` → literal dot) before the key lookup — so `rank\.value` resolves the key named
 * `rank.value` while `rank.value` resolves rank → value. An array along the way is spread to its
 * element type. An unresolvable path is `never`.
 *
 * NOTE: keep the body in lockstep with {@link PathValueIncDiscrimatedUnions} — same walk, but the
 * union variant distributes over `T` at every recursion level, so the two cannot share one alias.
 */
export type PathValue<T extends Record<string, any>, P> =
    P extends `${string}.${string}`
        ? SplitFirstUnescapedDot<P & string> extends [infer Key extends string, infer Rest extends string]
            ? UnescapeSegment<Key> extends infer UKey extends keyof T
                ? NonNullable<T[UKey]> extends Array<infer U>
                    ? PathValue<EnsureRecord<U>, Rest>
                    : PathValue<NonNullable<T[UKey]>, Rest>
                : never
            : SplitFirstUnescapedDot<P & string> extends [infer Key extends string]
                ? UnescapeSegment<Key> extends infer UKey extends keyof T
                    ? NonNullable<T[UKey]>
                    : never
                : never
        : P extends keyof T
            ? NonNullable<T[P]>
            : never;


/** {@link PathValue} that also distributes over each member of a `T` union at every nesting level. */
export type PathValueIncDiscrimatedUnions<T extends Record<string, any>, P> =
T extends unknown
    ? P extends `${string}.${string}`
        ? SplitFirstUnescapedDot<P & string> extends [infer Key extends string, infer Rest extends string]
            ? UnescapeSegment<Key> extends infer UKey extends keyof T
                ? NonNullable<T[UKey]> extends Array<infer U>
                    ? PathValueIncDiscrimatedUnions<EnsureRecord<U>, Rest>
                    : PathValueIncDiscrimatedUnions<NonNullable<T[UKey]>, Rest>
                : never
            : SplitFirstUnescapedDot<P & string> extends [infer Key extends string]
                ? UnescapeSegment<Key> extends infer UKey extends keyof T
                    ? NonNullable<T[UKey]>
                    : never
                : never
        : P extends keyof T
            ? NonNullable<T[P]>
            : never
    : never;
    

// Helper type to decrement depth
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, ...0[]];

/**
 * Every path on `T` that ends at an array, of scalars or of objects alike.
 *
 * A path is offered whenever the runtime can walk it, so an optional or nullable object along the
 * way is traversed rather than treated as a dead end. Keys holding a literal dot are spelled in the
 * escaped grammar (`rank\.value`).
 */
export type DotPropPathToArraySpreadingArrays<T extends Record<string, any>, Depth extends number = 8, Prefix extends string = ''> =  Depth extends 0 ? never : T extends object ? {
    [K in keyof T]-?: K extends string
        ? string extends K
            ? never // Skip index-sig keys: can't enumerate array paths through an index signature
            : NonNullable<T[K]> extends Array<infer U> // NonNullable handles optional property here
                ? U extends object
                    ? (K extends `${string}\\` ? never : `${Prefix}${EscapeSegment<K>}.${DotPropPathToArraySpreadingArrays<U, Prev[Depth], ''>}`) | `${Prefix}${EscapeSegment<K>}`
                    : `${Prefix}${EscapeSegment<K>}`
                : NonNullable<T[K]> extends object
                    ? (K extends `${string}\\` ? never : `${Prefix}${EscapeSegment<K>}.${DotPropPathToArraySpreadingArrays<NonNullable<T[K]>, Prev[Depth], ''>}`)
                    : never
        : never;
}[keyof T] : '';

/**
 * Every path on `T` that ends at an array of objects — the paths a scoped write may target.
 *
 * A path is offered whenever the runtime can walk it, so an optional or nullable object along the
 * way is traversed rather than treated as a dead end. Keys holding a literal dot are spelled in the
 * escaped grammar (`rank\.value`).
 */
export type DotPropPathToObjectArraySpreadingArrays<T extends Record<string, any>, Depth extends number = 8, Prefix extends string = ''> =  Depth extends 0 ? never : T extends object ? {
    [K in keyof T]-?: K extends string
        ? string extends K
            ? never // Skip index-sig keys: can't enumerate object-array paths through an index signature
            : NonNullable<T[K]> extends Array<infer U> // NonNullable handles optional property here
                ? U extends object // Check if the elements of array are objects
                    ? (K extends `${string}\\` ? never : `${Prefix}${EscapeSegment<K>}.${DotPropPathToObjectArraySpreadingArrays<U, Prev[Depth], ''>}`) | `${Prefix}${EscapeSegment<K>}`
                    : never // Exclude if the elements are not objects
                : NonNullable<T[K]> extends object
                    ? (K extends `${string}\\` ? never : `${Prefix}${EscapeSegment<K>}.${DotPropPathToObjectArraySpreadingArrays<NonNullable<T[K]>, Prev[Depth], ''>}`)
                    : never
        : never;
}[keyof T] : '';




/* ----------------------------------------------------------------------------
Paths to properties that may be cleared (set to `undefined`) or removed (key deleted).

Clearing and removing are different permissions, and `exactOptionalPropertyTypes` is what makes the
difference real: `{x?: string}` may lose its key but may never hold `undefined`, while
`{y: string | undefined}` may hold `undefined` but may never lose its key. A type that offered one
union for both would license writes the declared shape forbids, so there are two.
---------------------------------------------------------------------------- */

/** Which permission a key must hold to be offered as a leaf: hold `undefined`, or be absent entirely. */
type PropertyPermission = 'undefinable' | 'optional';

/**
 * Whether key `K` of `T` holds the permission `Mode` names.
 *
 * `undefinable` asks whether an object supplying `undefined` for `K` still satisfies `T`;
 * `optional` asks whether an object supplying nothing for `K` still satisfies `T`. Both questions are
 * put to `Pick<T, K>` so the key's own modifier (`?`) is part of the answer — that modifier is exactly
 * what `exactOptionalPropertyTypes` gives independent meaning to.
 *
 * A string index signature answers both questions through the same two tests: its value type decides
 * `undefinable`, and an empty object always satisfies an index signature, so it is always `optional`.
 */
type KeyHasPermission<T, K extends keyof T, Mode extends PropertyPermission> =
    Mode extends 'undefinable'
        ? ({ [P in K]: undefined } extends Pick<T, K> ? true : false)
        : ({} extends Pick<T, K> ? true : false);

/**
 * Whether a value is an array of objects — the one leaf shape neither permission offers.
 *
 * Clearing or removing such a key discards a whole collection of objects in a single write, which is
 * the same hazard that keeps object arrays out of `NonObjectArrayProperty`. Arrays of scalars carry no
 * such hazard and stay in. `NonNullable` is applied first so an optional or nullable array is judged by
 * the array it holds, and the element test is deliberately non-distributive: a mixed array
 * (`(string | {a: 1})[]`) carries objects and so counts as one.
 */
type IsObjectArrayValue<V> = NonNullable<V> extends Array<infer U> ? ([U] extends [Scalar] ? false : true) : false;

/** The rendered segment for key `K`, or `never` when `K` does not qualify as a leaf under `Mode`. */
type OfferedLeafSegment<T, K extends keyof T, Mode extends PropertyPermission, Segment extends string> =
    IsObjectArrayValue<T[K]> extends true
        ? never
        : (KeyHasPermission<T, K, Mode> extends true ? Segment : never);

/**
 * Every dot-prop path on `T` whose leaf key holds the permission `Mode` names.
 *
 * Built like {@link Path}: object depth is bounded by `Depth`, traversal through index signatures is
 * bounded by the separate `ISD` budget, keys render through `EscapeSegment`, and a key ending in a
 * backslash is offered as a leaf only (no spelling can reach its children).
 *
 * Two rules distinguish it from `Path`. A key that fails the permission is still traversed — a required
 * object can perfectly well hold an optional leaf — it is simply not offered as a leaf itself. And
 * arrays are never traversed: an element is addressed by scoping into the array, not by a path through
 * it, so an array value terminates the walk.
 */
type PropertyPermissionPath<T, Mode extends PropertyPermission, Depth extends number = 6, ISD extends number = 2> =
    Depth extends 0 ? never : T extends Array<any>
    ? never
    : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
        ? string extends K
            ? ISD extends 0
                ? OfferedLeafSegment<T, K, Mode, `${string & K}`> // Index-sig budget exhausted: leaf only, no recursion
                : OfferedLeafSegment<T, K, Mode, `${string & K}`> | `${string & K}.${PropertyPermissionPath<NonNullable<T[K]>, Mode, ISD, Prev[ISD]>}`
            : number extends K
                ? never // Numeric index sig: not useful for dot-prop paths
                : OfferedLeafSegment<T, K, Mode, `${EscapeSegment<string & K>}`> | (K extends `${string}\\` ? never : `${EscapeSegment<string & K>}.${PropertyPermissionPath<NonNullable<T[K]>, Mode, Prev[Depth], ISD>}`)
        : never;
    }[keyof T]
    : never;

/**
 * Union of every dot-prop path on `T` whose value is allowed to be `undefined`.
 *
 * These are the properties a write may CLEAR: the key stays present, its value becomes `undefined`.
 * A key qualifies when its declared type admits `undefined` — `{y: string | undefined}` and
 * `{z?: string | undefined}` (the shape Zod's `.optional()` produces) both do, while `{x?: string}`
 * does not, because under `exactOptionalPropertyTypes` an optional key may be absent but may not hold
 * `undefined`.
 *
 * @example
 * type Row = { id: string; nickname?: string | undefined; profile: { bio: string | undefined } };
 * type Clearable = DotPropPathToUndefinableProperty<Row>; // 'nickname' | 'profile.bio'
 *
 * @remarks
 * Paths never traverse an array, and a leaf holding an array of objects is never offered — the same
 * prohibition {@link NonObjectArrayProperty} applies to whole-array updates. Arrays of scalars are
 * offered as leaves. Keys holding a literal dot are spelled in the escaped grammar (`rank\.value`).
 */
export type DotPropPathToUndefinableProperty<T, ISD extends number = 2> = PropertyPermissionPath<T, 'undefinable', 6, ISD>;

/**
 * Union of every dot-prop path on `T` whose key is allowed to be absent.
 *
 * These are the properties a write may REMOVE entirely. A key qualifies when it is declared optional
 * (`{x?: string}`), or when it belongs to an index signature (`Record<string, …>`), where any key is
 * free to be missing. A required key never qualifies — not even one whose value admits `undefined`,
 * since `{y: string | undefined}` promises the key is there.
 *
 * @example
 * type Row = { id: string; nickname?: string; meta: Record<string, number> };
 * // `meta` itself is required, but any key inside the record is free to be missing.
 * type Removable = DotPropPathToOptionalProperty<Row>; // 'nickname' | `meta.${string}`
 *
 * @remarks
 * Paths never traverse an array, and a leaf holding an array of objects is never offered — the same
 * prohibition {@link NonObjectArrayProperty} applies to whole-array updates. Arrays of scalars are
 * offered as leaves. Keys holding a literal dot are spelled in the escaped grammar (`rank\.value`).
 */
export type DotPropPathToOptionalProperty<T, ISD extends number = 2> = PropertyPermissionPath<T, 'optional', 6, ISD>;


export type DotPropPathValidArrayValue<T extends Record<string, any>, P extends DotPropPathToArraySpreadingArrays<T> = DotPropPathToArraySpreadingArrays<T>> = PathValue<T, P> extends Array<infer ElementType> ? EnsureRecord<ElementType> : never;


/** Keys of T whose value is any variable-length array (scalar or object). Excludes tuples. */
export type ArrayProperty<T> = {
    [P in keyof T]-?: NonNullable<T[P]> extends Array<any>
        ? number extends NonNullable<T[P]>['length'] ? P : never  // exclude tuples
        : never
}[keyof T];

/** Element type of the array at key P. */
export type ArrayElement<T extends Record<string, any>, P extends keyof T> =
    NonNullable<T[P]> extends Array<infer U> ? U : never;

/** Keys of T whose value is generic number (excludes literal types like 1 | 2). */
export type NumberProperty<T> = {
    [P in keyof T]-?: NonNullable<T[P]> extends number
        ? number extends NonNullable<T[P]> ? P : never  // bidirectional: excludes literals
        : never
}[keyof T];

