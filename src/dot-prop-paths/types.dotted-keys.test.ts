/**
 * The compile-time path grammar and the runtime path parser speak the same language.
 *
 * A dot-prop path escapes a literal dot inside a key (`rank\.value` is ONE key named `rank.value`;
 * `rank.value` is two keys). `parseDotPropPathSegments` is the canonical runtime statement of that
 * grammar. These tests pin the other half of the contract: every path-generating type renders object
 * keys in the SAME escaped spelling, and every path-consuming type splits on unescaped dots only —
 * so a spelling the types offer is a spelling the runtime resolves, and vice versa.
 *
 * The shared `KEYS` table drives both halves (exact type pins and the executable runtime register),
 * so the two can't drift apart silently.
 */
import { describe, test, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import { escapeDotPropPathSegment, parseDotPropPathSegments } from "./dotPropPathSegments.ts";
import { convertSchemaToDotPropPathTree } from "./schema-tree.ts";
import { getTypedProperty, setTypedProperty } from "./typed-dot-prop.ts";
import type {
    DotPropPathsRecord,
    DotPropPathsRecordWithOptionalAdditionalValues,
    DotPropPathsUnion,
    DotPropPathsUnionScalar,
    DotPropPathsUnionScalarArraySpreadingObjectArrays,
    DotPropPathsUnionScalarSpreadingObjectArrays,
    DotPropPathToArraySpreadingArrays,
    DotPropPathToObjectArraySpreadingArrays,
    PathValue,
    PathValueIncDiscrimatedUnions,
} from "./types.ts";

/**
 * Object key → its canonical escaped path-segment spelling.
 *
 * The single source of truth for this suite: the type half asserts the path unions offer exactly
 * these spellings, and the runtime half asserts `escapeDotPropPathSegment` produces them and
 * `parseDotPropPathSegments` decodes them back to the keys.
 */
const KEYS = {
    'plain': 'plain',
    'rank.value': 'rank\\.value',
    'a.b.c': 'a\\.b\\.c',
    'x.': 'x\\.',
    '.y': '\\.y',
    'a\\': 'a\\',       // trailing backslash: representable as a leaf only (see grammar-limit tests)
    'a\\.b': 'a\\\\.b', // backslash-then-dot inside the key: only the dot gains an escape
    'a[0]': 'a[0]',     // brackets are ordinary characters in the canonical grammar
} as const;
type EscapedSpellings = (typeof KEYS)[keyof typeof KEYS];

/** Every key in the table, as a flat object — the fixture the union pins run against. */
type FlatFixture = { [K in keyof typeof KEYS]: number };

describe('the path union spells every key exactly as the runtime parser reads it', () => {

    test('the union over the shared key table is exactly the escaped spellings', () => {
        expectTypeOf<DotPropPathsUnion<FlatFixture>>().toEqualTypeOf<EscapedSpellings>();
    });

    describe('executable register: the escaped spelling round-trips through the canonical parser', () => {

        test.each(Object.entries(KEYS))('key %j is spelled %j', (key, escaped) => {
            expect(escapeDotPropPathSegment(key)).toBe(escaped);
            expect(parseDotPropPathSegments(escaped)).toEqual([key]);
        });

        test.each(Object.entries(KEYS).filter(([key]) => !key.endsWith('\\')))(
            'key %j joins with a child segment and splits back apart', (key, escaped) => {
                expect(parseDotPropPathSegments(`${escaped}.child`)).toEqual([key, 'child']);
            });
    });

    test('the raw dotted spelling is rejected: it names two keys, not the dotted one', () => {
        type Lone = { 'rank.value': number; other: string };
        // @ts-expect-error `rank.value` reads as the path rank → value, which Lone does not declare
        ('rank.value') satisfies DotPropPathsUnion<Lone>;
        ('rank\\.value') satisfies DotPropPathsUnion<Lone>;
    });
});

describe('a dotted key and the two-segment path it must not collide with', () => {

    /** `rank\.value` (one key) and `rank.value` (two keys) coexist and carry different types. */
    type Coexist = { 'rank.value': number; rank: { value: string }; nested: { 'a.b': { c: boolean } } };

    test('the union offers both spellings, plus the escaped nested forms', () => {
        expectTypeOf<DotPropPathsUnion<Coexist>>().toEqualTypeOf<
            'rank\\.value' | 'rank' | 'rank.value' | 'nested' | 'nested.a\\.b' | 'nested.a\\.b.c'
        >();
    });

    test('each spelling resolves its own value type', () => {
        expectTypeOf<PathValue<Coexist, 'rank\\.value'>>().toEqualTypeOf<number>();
        expectTypeOf<PathValue<Coexist, 'rank.value'>>().toEqualTypeOf<string>();
        expectTypeOf<PathValue<Coexist, 'nested.a\\.b'>>().toEqualTypeOf<{ c: boolean }>();
        expectTypeOf<PathValue<Coexist, 'nested.a\\.b.c'>>().toEqualTypeOf<boolean>();
    });

    test('the raw spelling of a nested dotted key resolves nothing', () => {
        expectTypeOf<PathValue<Coexist, 'nested.a.b'>>().toEqualTypeOf<never>();
    });

    test('a path deeper than the value it names resolves nothing', () => {
        expectTypeOf<PathValue<Coexist, 'rank\\.value.oops'>>().toEqualTypeOf<never>();
    });

    test('record types key by the escaped spelling and keep the per-spelling value types', () => {
        expectTypeOf<DotPropPathsRecord<Coexist>['rank\\.value']>().toEqualTypeOf<number>();
        expectTypeOf<DotPropPathsRecord<Coexist>['rank.value']>().toEqualTypeOf<string>();

        ({
            'rank\\.value': 5,
            'rank.value': 's',
            'nested.a\\.b.c': { $eq: true },
        }) satisfies Partial<DotPropPathsRecordWithOptionalAdditionalValues<Coexist, { $eq: unknown }>>;
    });

    test('the schema analogue of a true collision still refuses to build (types name both, runtime never promises both)', () => {
        // The type union CAN offer both spellings because they are distinct strings. The runtime path
        // tree indexes nodes by rendered path, where the two readings of `a.b` collide — and it throws
        // rather than silently prefer one. Frozen behavior (schema-tree), re-pinned here two-sided.
        const bothReadings = z.object({ a: z.object({ b: z.string() }), 'a.b': z.string() });
        expect(() => convertSchemaToDotPropPathTree(bothReadings)).toThrow(/Duplicate dotprop_path/);
    });
});

describe('a key ending in a backslash is a leaf the grammar can name, with a subtree it cannot', () => {

    test('runtime grammar limit: joining a trailing-backslash key to a child reads back as a different key', () => {
        // `a\` + `.` + `b` renders `a\.b`, which the parser decodes as the single key `a.b`. No spelling
        // reaches a child of `a\` — so the types must offer the leaf and suppress the subtree.
        expect(parseDotPropPathSegments('a\\.b')).toEqual(['a.b']);
        expect(parseDotPropPathSegments(escapeDotPropPathSegment('a\\') + '.b')).not.toEqual(['a\\', 'b']);
    });

    test('the general union offers the leaf and omits the whole subtree', () => {
        type BSFix = { id: string; rows: { 'a\\': { b: number } } };
        expectTypeOf<DotPropPathsUnion<BSFix>>().toEqualTypeOf<'id' | 'rows' | 'rows.a\\'>();
        expectTypeOf<PathValue<BSFix, 'rows.a\\'>>().toEqualTypeOf<{ b: number }>();
    });

    test('all three scalar unions suppress the subtree too (interlock with the trailing-dot filter)', () => {
        // RemoveTrailingDot now lets `x\.`-style leaves through, which is sound ONLY because every
        // generator suppresses trailing-backslash joins. A forgotten suppression would EMIT a dangling
        // `a\.child` path (which parses as the key `a.child`) instead of filtering it — these pins catch that.
        type BSNest = { 'a\\': { b: number }; ok: string };
        expectTypeOf<DotPropPathsUnionScalar<BSNest>>().toEqualTypeOf<'ok'>();
        expectTypeOf<DotPropPathsUnionScalarSpreadingObjectArrays<BSNest>>().toEqualTypeOf<'ok'>();

        type BSNestArr = { 'a\\': { b: number[] }; ok: number[] };
        expectTypeOf<DotPropPathsUnionScalarArraySpreadingObjectArrays<BSNestArr>>().toEqualTypeOf<'ok'>();
    });

    test('the array-path unions offer a trailing-backslash array key as a leaf only', () => {
        type BSGen = { 'a\\': { v: number }[]; ok: { w: string } };
        expectTypeOf<DotPropPathToObjectArraySpreadingArrays<BSGen>>().toEqualTypeOf<'a\\'>();
    });

    test('a trailing-backslash scalar key is still offered — a leaf needs no join', () => {
        type BSLeaf = { 'a\\': number; ok: string };
        expectTypeOf<DotPropPathsUnion<BSLeaf>>().toEqualTypeOf<'a\\' | 'ok'>();
        expectTypeOf<DotPropPathsUnionScalar<BSLeaf>>().toEqualTypeOf<'a\\' | 'ok'>();
    });
});

describe('a key ending in a dot survives the trailing-dot filter in escaped form', () => {

    // The trailing-dot filter exists to drop genuinely dangling paths (`a.`). A key NAMED `x.`
    // escapes to `x\.` — an escaped dot is data, not a dangling separator, so it must survive.

    test('the general union keeps the escaped leaf and joins children through it', () => {
        type TDFix = { 'x.': { c: number }; y: string };
        expectTypeOf<DotPropPathsUnion<TDFix>>().toEqualTypeOf<'x\\.' | 'x\\..c' | 'y'>();
        expectTypeOf<PathValue<TDFix, 'x\\.'>>().toEqualTypeOf<{ c: number }>();
        expectTypeOf<PathValue<TDFix, 'x\\..c'>>().toEqualTypeOf<number>();
    });

    test('the scalar unions keep the escaped leaf', () => {
        type TDScalar = { 'x.': number; y: string };
        expectTypeOf<DotPropPathsUnionScalar<TDScalar>>().toEqualTypeOf<'x\\.' | 'y'>();
        expectTypeOf<DotPropPathsUnionScalarSpreadingObjectArrays<TDScalar>>().toEqualTypeOf<'x\\.' | 'y'>();

        type TDArr = { 'x.': number[]; y: string[] };
        expectTypeOf<DotPropPathsUnionScalarArraySpreadingObjectArrays<TDArr>>().toEqualTypeOf<'x\\.' | 'y'>();
    });

    test('runtime agreement: the escaped trailing-dot leaf parses back to the key', () => {
        expect(parseDotPropPathSegments('x\\.')).toEqual(['x.']);
        expect(parseDotPropPathSegments('x\\..c')).toEqual(['x.', 'c']);
    });
});

describe('index signatures keep their open-ended paths', () => {

    test('a Record property still admits any sub-key', () => {
        type ISFix = { meta: Record<string, any>; name: string };
        type U = DotPropPathsUnion<ISFix>;
        ('meta.whatever') satisfies U;
        ('name') satisfies U;
    });
});

describe('discriminated unions resolve escaped paths per member', () => {

    type DU = { type: 'a'; deets: { 'k.v': number } } | { type: 'b'; deets: { plain: string } };

    test('an escaped path resolves through the member that declares the dotted key', () => {
        expectTypeOf<PathValueIncDiscrimatedUnions<DU, 'deets.k\\.v'>>().toEqualTypeOf<number>();
        expectTypeOf<PathValueIncDiscrimatedUnions<DU, 'deets.plain'>>().toEqualTypeOf<string>();
        expectTypeOf<PathValueIncDiscrimatedUnions<DU, 'type'>>().toEqualTypeOf<'a' | 'b'>();
    });
});

describe('arrays: escaped keys travel through array-spreading paths', () => {

    test('PathValue spreads an array under a dotted key', () => {
        type ArrFixV = { 'l.ist': { v: number }[] };
        expectTypeOf<PathValue<ArrFixV, 'l\\.ist.v'>>().toEqualTypeOf<number>();
        expectTypeOf<PathValue<ArrFixV, 'l\\.ist'>>().toEqualTypeOf<{ v: number }[]>();
    });

    test('the scalar unions escape keys at every level, including inside array elements', () => {
        type SCFix = { 's.k': number; obj: { 'd.k': string }; arr: { 'i.k': boolean }[] };
        expectTypeOf<DotPropPathsUnionScalar<SCFix>>().toEqualTypeOf<'s\\.k' | 'obj.d\\.k'>();
        expectTypeOf<DotPropPathsUnionScalarSpreadingObjectArrays<SCFix>>().toEqualTypeOf<'s\\.k' | 'obj.d\\.k' | 'arr.i\\.k'>();

        type SCArr = { 'a.rr': string[]; obj: { 'n.um': number[] } };
        expectTypeOf<DotPropPathsUnionScalarArraySpreadingObjectArrays<SCArr>>().toEqualTypeOf<'a\\.rr' | 'obj.n\\.um'>();
    });

    test('the object-array union escapes dotted array keys', () => {
        type ARRFix2 = { 'l.ist': { v: number }[]; plain: { arr2: string[] } };
        expectTypeOf<DotPropPathToObjectArraySpreadingArrays<ARRFix2>>().toEqualTypeOf<'l\\.ist'>();
    });

    test('the any-array union escapes dotted keys, junk quirk preserved 1:1', () => {
        // Parity pin, not an endorsement: DotPropPathToArraySpreadingArrays has a pre-existing quirk —
        // its `?:` mapped-type modifier makes recursion emit `...undefined` members and `| undefined`.
        // The escaping change mirrors that behavior exactly; fixing the quirk is a separate concern.
        type ARRFix2 = { 'l.ist': { v: number }[]; plain: { arr2: string[] } };
        expectTypeOf<DotPropPathToArraySpreadingArrays<ARRFix2>>().toEqualTypeOf<
            'l\\.ist' | 'plain.undefined' | 'plain.arr2' | 'l\\.ist.undefined' | undefined
        >();
    });
});

describe('the typed property bridge accepts and resolves the escaped spelling', () => {

    // getTypedProperty/setTypedProperty read with the vendored dot-prop grammar, which agrees with the
    // canonical grammar on `\.` (dot-only keys behave identically in both). Keys using the extra
    // dot-prop escapes (`\\`, brackets) are where the readers split — that divergence is pinned in
    // where-filter/divergence-tracking/escaped-dot-path-grammar-split.test.ts (#14), not promised here.

    test('a dotted key reads back through its escaped path', () => {
        const obj: { 'rank.value': number; plain: string } = { 'rank.value': 5, plain: 'p' };
        expect(getTypedProperty(obj, 'rank\\.value')).toBe(5);
        expectTypeOf(getTypedProperty(obj, 'rank\\.value')).toEqualTypeOf<number | undefined>();
    });

    test('a dotted key writes through its escaped path without disturbing the raw-spelling twin', () => {
        const obj: { 'rank.value': number; rank: { value: string } } = { 'rank.value': 5, rank: { value: 's' } };
        const written = setTypedProperty(obj, 'rank\\.value', 9);
        expect(written['rank.value']).toBe(9);
        expect(written.rank.value).toBe('s');
    });
});
