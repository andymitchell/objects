/**
 * Two path unions name the properties a caller is allowed to clear or remove.
 *
 * `DotPropPathToUndefinableProperty` offers the paths whose value may become `undefined`;
 * `DotPropPathToOptionalProperty` offers the paths whose key may be absent. Under
 * `exactOptionalPropertyTypes` those are genuinely different permissions — `{x?: string}` may lose its
 * key but may not hold `undefined`, and `{y: string | undefined}` is the exact reverse — so the two
 * unions must disagree, and these tests pin where.
 */
import { describe, test, expectTypeOf } from "vitest";
import type { DotPropPathToOptionalProperty, DotPropPathToUndefinableProperty } from "./types.ts";

describe('the two permissions are told apart by the key modifier, not by the value type', () => {

    type Modifiers = {
        required: string;
        optionalOnly?: string;
        undefinableOnly: string | undefined;
        both?: string | undefined;
    };

    test('a value may be cleared only when its declared type admits undefined', () => {
        expectTypeOf<DotPropPathToUndefinableProperty<Modifiers>>()
            .toEqualTypeOf<'undefinableOnly' | 'both'>();
    });

    test('a key may be removed only when it is declared optional', () => {
        expectTypeOf<DotPropPathToOptionalProperty<Modifiers>>()
            .toEqualTypeOf<'optionalOnly' | 'both'>();
    });

    test('wrapping the same shape in a parent prefixes every path and offers nothing else', () => {
        // Metamorphic: nesting changes where the paths point, never which properties qualify.
        type Wrapped = { parent: Modifiers };
        expectTypeOf<DotPropPathToUndefinableProperty<Wrapped>>()
            .toEqualTypeOf<`parent.${DotPropPathToUndefinableProperty<Modifiers>}`>();
        expectTypeOf<DotPropPathToOptionalProperty<Wrapped>>()
            .toEqualTypeOf<`parent.${DotPropPathToOptionalProperty<Modifiers>}`>();
    });
});

describe('a property that cannot itself be cleared or removed is still traversed', () => {

    type Nested = {
        id: string;
        required: { leaf?: string | undefined; alsoRequired: string };
        optionalParent?: { leaf?: string | undefined };
    };

    test('a required object holding a clearable leaf offers the leaf, not itself', () => {
        expectTypeOf<DotPropPathToUndefinableProperty<Nested>>()
            .toEqualTypeOf<'required.leaf' | 'optionalParent.leaf'>();
    });

    test('an optional object is both a removable key of its own and a route to its children', () => {
        expectTypeOf<DotPropPathToOptionalProperty<Nested>>()
            .toEqualTypeOf<'optionalParent' | 'required.leaf' | 'optionalParent.leaf'>();
    });
});

describe('arrays end the walk, and only arrays of scalars are offered as leaves', () => {

    type Arrays = {
        scalarArray?: string[] | undefined;
        objectArray?: { v: number }[] | undefined;
        mixedArray?: (string | { v: number })[] | undefined;
        arrayOfArrays?: string[][] | undefined;
    };

    test('a scalar array is the only array either permission offers', () => {
        expectTypeOf<DotPropPathToUndefinableProperty<Arrays>>().toEqualTypeOf<'scalarArray'>();
        expectTypeOf<DotPropPathToOptionalProperty<Arrays>>().toEqualTypeOf<'scalarArray'>();
    });

    test('no path reaches inside an array, so element properties are unreachable', () => {
        // Both unions above are exact, so `objectArray.v` is absent by construction. Stated separately
        // because it is the contract callers rely on: element edits are scoped into the array instead.
        type NoElementPaths = Extract<DotPropPathToOptionalProperty<Arrays>, `${string}.${string}`>;
        expectTypeOf<NoElementPaths>().toEqualTypeOf<never>();
    });
});

describe('index signatures admit any key, and their value type decides whether it can be cleared', () => {

    type Records = {
        plain: Record<string, string>;
        clearableValues: Record<string, string | undefined>;
    };

    test('any key of any record may be removed', () => {
        expectTypeOf<DotPropPathToOptionalProperty<Records>>()
            .toEqualTypeOf<`plain.${string}` | `clearableValues.${string}`>();
    });

    test('only a record whose values admit undefined offers clearable keys', () => {
        expectTypeOf<DotPropPathToUndefinableProperty<Records>>()
            .toEqualTypeOf<`clearableValues.${string}`>();
    });
});

describe('keys are spelled in the escaped path grammar', () => {

    type Dotted = {
        'rank.value'?: string | undefined;
        'a\\'?: { child?: string | undefined } | undefined;
    };

    test('a key holding a literal dot is offered in its escaped spelling only', () => {
        expectTypeOf<DotPropPathToUndefinableProperty<Dotted>>().toEqualTypeOf<'rank\\.value' | 'a\\'>();
        expectTypeOf<DotPropPathToOptionalProperty<Dotted>>().toEqualTypeOf<'rank\\.value' | 'a\\'>();
    });

    test('a key ending in a backslash is a leaf whose children no spelling can reach', () => {
        // `a\` + `.` + `child` renders `a\.child`, which the parser reads as the single key `a.child`.
        // The unions above are exact, so that unreachable child path is absent from both.
        type BackslashChildPaths = Extract<DotPropPathToOptionalProperty<Dotted>, `a\\.${string}`>;
        expectTypeOf<BackslashChildPaths>().toEqualTypeOf<never>();
    });
});

describe('the walk is bounded, so a deep or numerically-keyed shape cannot expand without limit', () => {

    test('a numeric index signature contributes no paths', () => {
        // A dot-prop segment is a string key; a numeric index signature names nothing a caller can spell.
        type Numeric = { byIndex: { [k: number]: string | undefined }; named?: string };
        expectTypeOf<DotPropPathToOptionalProperty<Numeric>>().toEqualTypeOf<'named'>();
    });

    test('object nesting is offered to six segments and no deeper', () => {
        type L6 = { leaf?: string };
        type L5 = { d5: L6 };
        type L4 = { d4: L5 };
        type L3 = { d3: L4 };
        type L2 = { d2: L3 };
        type Deep = { d1: L2 };

        expectTypeOf<DotPropPathToOptionalProperty<Deep>>().toEqualTypeOf<'d1.d2.d3.d4.d5.leaf'>();

        // One level further down, the same leaf is beyond the budget and is simply not offered.
        type Deeper = { d0: Deep };
        expectTypeOf<DotPropPathToOptionalProperty<Deeper>>().toEqualTypeOf<never>();
    });
});

describe('known looseness, pinned so a change to it is deliberate', () => {

    test('a readonly property is offered like any other', () => {
        // Same looseness `update` already carries: readonly is a compile-time authoring rule, and these
        // unions do not enforce it.
        type Frozen = { readonly cleared?: string | undefined; readonly removed?: string };
        expectTypeOf<DotPropPathToUndefinableProperty<Frozen>>().toEqualTypeOf<'cleared'>();
        expectTypeOf<DotPropPathToOptionalProperty<Frozen>>().toEqualTypeOf<'cleared' | 'removed'>();
    });

    test('a union type offers every variant’s paths, including ones the value at hand cannot have', () => {
        // The union distributes, so a path valid in one variant is offered for the whole union. Nothing
        // can be corrupted by it: the runtime resolver refuses a union-rooted schema outright, so such a
        // path fails its action loudly rather than writing to the wrong shape.
        type Variants = { kind: 'a'; onlyA?: string } | { kind: 'b'; onlyB?: string };
        expectTypeOf<DotPropPathToOptionalProperty<Variants>>().toEqualTypeOf<'onlyA' | 'onlyB'>();
    });

    test('an untyped shape offers every string, deferring entirely to runtime validation', () => {
        // `any` collapses both unions to `string`, which is what lets a schema-less caller build actions
        // at all. The runtime resolver is the only gate in that case.
        expectTypeOf<DotPropPathToUndefinableProperty<any>>().toEqualTypeOf<string>();
        expectTypeOf<DotPropPathToOptionalProperty<any>>().toEqualTypeOf<string>();
    });
});
