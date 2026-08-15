/**
 * Which properties a write may clear or remove, decided from the schema alone.
 *
 * `resolvePropertyPathTarget` is the single gate both the payload parser and the write engine consult, so
 * these tests are the contract for both: a path either resolves to a property the verb may legally touch,
 * or it is refused as a value with a reason the caller can act on.
 *
 * The refusals are grouped by what they protect. Traversal reasons (`disallowed_segment`, `unknown_path`,
 * `traverses_array`) say the path does not name a writable location at all. Permission reasons
 * (`not_undefinable`, `not_optional`) say it names one the schema will not let this verb change.
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { resolvePropertyPathTarget } from "./propertyPathResolution.ts";

/** The two verbs, so a case can state which one it is asking about without repeating the literals. */
const CLEAR = 'set_property_undefined' as const;
const REMOVE = 'delete_property' as const;

describe('a path that does not name a writable location is refused before any permission is considered', () => {

    const schema = z.object({
        id: z.string(),
        nickname: z.string().optional(),
        rows: z.array(z.object({ v: z.string().optional() })),
        bag: z.record(z.string(), z.string().optional()),
    });

    test('a path segment that the property reader refuses to traverse is rejected', () => {
        for (const path of ['__proto__', 'prototype', 'constructor', 'bag.__proto__']) {
            expect(resolvePropertyPathTarget(schema, path, REMOVE)).toEqual({ ok: false, reason: 'disallowed_segment' });
        }
    });

    test('a path with an empty segment is rejected even where the container would accept any key', () => {
        // A record admits any key, so without this gate `bag.` would resolve and the write would land on a
        // key named ''. Leading, trailing and doubled dots all produce that empty segment.
        for (const path of ['bag.', '.bag', 'bag..x', '', '.']) {
            expect(resolvePropertyPathTarget(schema, path, REMOVE)).toEqual({ ok: false, reason: 'disallowed_segment' });
        }
    });

    test('a key holding a literal dot is not confused with a denylisted segment', () => {
        // `k\.constructor` is ONE key named `k.constructor` — an own-property read, not a prototype walk.
        const dotted = z.object({ 'k.constructor': z.string().optional() });
        expect(resolvePropertyPathTarget(dotted, 'k\\.constructor', REMOVE)).toEqual({ ok: true });
    });

    test('a path the schema does not declare is rejected', () => {
        expect(resolvePropertyPathTarget(schema, 'ghost', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
        expect(resolvePropertyPathTarget(schema, 'nickname.deeper', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });

    test('a path that traverses an array is rejected, so element edits go through a scoped write', () => {
        expect(resolvePropertyPathTarget(schema, 'rows.v', REMOVE)).toEqual({ ok: false, reason: 'traverses_array' });
    });

    test('a schema whose root is a union of shapes resolves nothing', () => {
        // The type-level path unions offer every variant's paths for a union row; the resolver is what makes
        // that safe, by refusing the whole shape rather than guessing a variant.
        const union = z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('a'), onlyA: z.string().optional() }),
            z.object({ kind: z.literal('b'), onlyB: z.string().optional() }),
        ]);
        expect(resolvePropertyPathTarget(union, 'onlyA', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });
});

describe('a leaf holding an array of objects is refused by both verbs', () => {

    test('clearing or removing a whole collection of objects is not expressible', () => {
        // The same prohibition an update carries: replacing or discarding a whole object array in one write
        // is what array-scoped writes exist to avoid.
        const schema = z.object({ rows: z.array(z.object({ v: z.string() })).optional() });
        expect(resolvePropertyPathTarget(schema, 'rows', CLEAR)).toEqual({ ok: false, reason: 'object_array_property' });
        expect(resolvePropertyPathTarget(schema, 'rows', REMOVE)).toEqual({ ok: false, reason: 'object_array_property' });
    });

    test('wrapping the array does not smuggle it past the refusal', () => {
        const wrapped = z.object({ rows: z.array(z.object({ v: z.string() })).nullable().optional() });
        expect(resolvePropertyPathTarget(wrapped, 'rows', REMOVE)).toEqual({ ok: false, reason: 'object_array_property' });
    });

    test('an array carrying objects among other things still counts as one', () => {
        const mixed = z.object({ rows: z.array(z.union([z.string(), z.object({ v: z.string() })])).optional() });
        expect(resolvePropertyPathTarget(mixed, 'rows', REMOVE)).toEqual({ ok: false, reason: 'object_array_property' });
    });

    test('an array of scalars is an ordinary leaf', () => {
        const scalars = z.object({ tags: z.array(z.string()).optional() });
        expect(resolvePropertyPathTarget(scalars, 'tags', CLEAR)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(scalars, 'tags', REMOVE)).toEqual({ ok: true });
    });
});

describe('a value may be cleared only when the schema stores undefined as undefined', () => {

    /**
     * Each leaf is asked the same question: after the write, does the item still parse to what was stored?
     * A schema that accepts `undefined` by REWRITING it to something else would leave the stored item
     * permanently disagreeing with its own schema, so it is refused even though its parse succeeds.
     */
    const CASES: { name: string; leaf: z.ZodType; clearable: boolean }[] = [
        { name: 'a plain required field', leaf: z.string(), clearable: false },
        { name: 'an optional field', leaf: z.string().optional(), clearable: true },
        { name: 'an optional field that is also nullable', leaf: z.string().optional().nullable(), clearable: true },
        { name: 'a nullable field that is also optional', leaf: z.string().nullable().optional(), clearable: true },
        { name: 'a nullable-only field', leaf: z.string().nullable(), clearable: false },
        { name: 'an explicit union with undefined', leaf: z.union([z.string(), z.undefined()]), clearable: true },
        { name: 'a defaulted field', leaf: z.string().default('x'), clearable: false },
        { name: 'a defaulted field wrapped in nullable', leaf: z.string().default('x').nullable(), clearable: false },
        { name: 'a defaulted field wrapped in optional', leaf: z.string().default('x').optional(), clearable: false },
        { name: 'an optional field given a default', leaf: z.string().optional().default('x'), clearable: false },
        { name: 'a caught field', leaf: z.string().catch('x'), clearable: false },
        { name: 'a caught field wrapped in optional', leaf: z.string().catch('x').optional(), clearable: true },
        { name: 'a prefaulted field', leaf: z.string().prefault('x'), clearable: false },
        { name: 'a readonly optional field', leaf: z.string().readonly().optional(), clearable: true },
        { name: 'an optional field made required again', leaf: z.string().optional().nonoptional(), clearable: false },
    ];

    test.each(CASES)('$name: clearable = $clearable', ({ leaf, clearable }) => {
        const schema = z.object({ field: leaf });
        expect(resolvePropertyPathTarget(schema, 'field', CLEAR))
            .toEqual(clearable ? { ok: true } : { ok: false, reason: 'not_undefinable' });
    });
});

describe('a key may be removed only when the schema still accepts the item without it', () => {

    /**
     * Each leaf is asked whether an object carrying that field parses when the field is simply absent, AND
     * whether the parse leaves it absent. A schema that fills the key back in (a default) would re-create
     * what the write removed, so removal there is refused.
     */
    const CASES: { name: string; leaf: z.ZodType; removable: boolean }[] = [
        { name: 'a plain required field', leaf: z.string(), removable: false },
        { name: 'an optional field', leaf: z.string().optional(), removable: true },
        { name: 'an optional field that is also nullable', leaf: z.string().optional().nullable(), removable: true },
        { name: 'a nullable-only field', leaf: z.string().nullable(), removable: false },
        { name: 'an explicit union with undefined', leaf: z.union([z.string(), z.undefined()]), removable: false },
        { name: 'a defaulted field', leaf: z.string().default('x'), removable: false },
        { name: 'a defaulted field wrapped in optional', leaf: z.string().default('x').optional(), removable: false },
        { name: 'a caught field wrapped in optional', leaf: z.string().catch('x').optional(), removable: true },
        { name: 'a readonly optional field', leaf: z.string().readonly().optional(), removable: true },
        { name: 'a field typed as any', leaf: z.any(), removable: false },
    ];

    test.each(CASES)('$name: removable = $removable', ({ leaf, removable }) => {
        const schema = z.object({ field: leaf });
        expect(resolvePropertyPathTarget(schema, 'field', REMOVE))
            .toEqual(removable ? { ok: true } : { ok: false, reason: 'not_optional' });
    });

    test('an explicit union with undefined can be cleared but not removed', () => {
        // The two permissions genuinely differ: the schema promises the key is there, holding a value that
        // may be undefined. Clearing honours that promise; removing breaks it.
        const schema = z.object({ field: z.union([z.string(), z.undefined()]) });
        expect(resolvePropertyPathTarget(schema, 'field', CLEAR)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(schema, 'field', REMOVE)).toEqual({ ok: false, reason: 'not_optional' });
    });
});

describe('paths reach through the containers a caller actually nests data in', () => {

    test('a nested object resolves, and so does an optional one on the way', () => {
        const schema = z.object({
            required: z.object({ nickname: z.string().optional() }),
            optionalParent: z.object({ nickname: z.string().optional() }).optional(),
        });
        expect(resolvePropertyPathTarget(schema, 'required.nickname', REMOVE)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(schema, 'optionalParent.nickname', REMOVE)).toEqual({ ok: true });
    });

    test('a lazily-declared object resolves like any other', () => {
        const schema = z.object({ node: z.lazy(() => z.object({ nickname: z.string().optional() })) });
        expect(resolvePropertyPathTarget(schema, 'node.nickname', REMOVE)).toEqual({ ok: true });
    });

    test('a field grafted on by an intersection resolves through whichever side declares it', () => {
        const schema = z.object({ id: z.string() }).and(z.object({ nickname: z.string().optional() }));
        expect(resolvePropertyPathTarget(schema, 'nickname', REMOVE)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(schema, 'id', REMOVE)).toEqual({ ok: false, reason: 'not_optional' });
        expect(resolvePropertyPathTarget(schema, 'ghost', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });

    test('a key holding a literal dot resolves through its escaped spelling', () => {
        const schema = z.object({ 'rank.value': z.string().optional() });
        expect(resolvePropertyPathTarget(schema, 'rank\\.value', REMOVE)).toEqual({ ok: true });
        // The raw spelling names a two-segment path the schema does not declare.
        expect(resolvePropertyPathTarget(schema, 'rank.value', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });

    test('an undeclared key an object explicitly accepts is writable through its catchall', () => {
        const schema = z.object({ id: z.string() }).catchall(z.number());
        // The catchall says undeclared keys are welcome and never required, so removing one is always legal.
        expect(resolvePropertyPathTarget(schema, 'extra', REMOVE)).toEqual({ ok: true });
        // Clearing still asks the catchall's own type, which does not store undefined.
        expect(resolvePropertyPathTarget(schema, 'extra', CLEAR)).toEqual({ ok: false, reason: 'not_undefinable' });
    });

    test('an object that rejects unknown keys declares no undeclared path', () => {
        const strict = z.object({ id: z.string() }).strict();
        expect(resolvePropertyPathTarget(strict, 'extra', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });
});

describe('a record decides for its own keys, because its keys share one declaration', () => {

    test('any key of an open record may be removed, and cleared when its values allow it', () => {
        const open = z.object({ bag: z.record(z.string(), z.string()) });
        expect(resolvePropertyPathTarget(open, 'bag.anything', REMOVE)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(open, 'bag.anything', CLEAR)).toEqual({ ok: false, reason: 'not_undefinable' });

        const clearable = z.object({ bag: z.record(z.string(), z.string().optional()) });
        expect(resolvePropertyPathTarget(clearable, 'bag.anything', CLEAR)).toEqual({ ok: true });
    });

    test('a record keyed by an enum admits only its declared names', () => {
        const schema = z.object({ scores: z.record(z.enum(['home', 'away']), z.number()) });
        expect(resolvePropertyPathTarget(schema, 'scores.zzz', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });

    test('a record keyed by an enum requires every name, so none of them may be removed', () => {
        const schema = z.object({ scores: z.record(z.enum(['home', 'away']), z.number()) });
        expect(resolvePropertyPathTarget(schema, 'scores.home', REMOVE)).toEqual({ ok: false, reason: 'not_optional' });
    });

    test('the same record declared as partial makes every name removable', () => {
        const schema = z.object({ scores: z.partialRecord(z.enum(['home', 'away']), z.number()) });
        expect(resolvePropertyPathTarget(schema, 'scores.home', REMOVE)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(schema, 'scores.zzz', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });

    test('a record whose values are optional lets its keys go, enum-keyed or not', () => {
        // Absence is legal for the whole record, so the container answers for every key it admits.
        const schema = z.object({ scores: z.record(z.enum(['home', 'away']), z.number().optional()) });
        expect(resolvePropertyPathTarget(schema, 'scores.home', REMOVE)).toEqual({ ok: true });
    });

    test('a record with a narrowed key type admits only the keys it accepts', () => {
        const schema = z.object({ bag: z.record(z.string().min(2), z.string().optional()) });
        expect(resolvePropertyPathTarget(schema, 'bag.ab', REMOVE)).toEqual({ ok: true });
        expect(resolvePropertyPathTarget(schema, 'bag.a', REMOVE)).toEqual({ ok: false, reason: 'unknown_path' });
    });
});
