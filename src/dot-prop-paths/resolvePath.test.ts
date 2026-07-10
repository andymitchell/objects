import { describe, test, expect } from "vitest";
import { z } from "zod";
import { isUnspreadableRecordPath, resolvePath } from "./resolvePath.ts";
import { convertSchemaToDotPropPathTree } from "./schema-tree.ts";
import type { AnyZodSchema } from "../zod/introspection.ts";
import type { ResolvedPath } from "./resolvePath-types.ts";

/** Resolve against a schema, insisting the path itself was well-formed. */
function resolve(schema: AnyZodSchema, path: string): ResolvedPath {
    const result = resolvePath(path, convertSchemaToDotPropPathTree(schema).map);
    if (!result.success) throw new Error(`Expected a well-formed path, got: ${result.error.message}`);
    return result.resolved;
}

const Schema = z.object({
    id: z.string(),
    contact: z.object({ name: z.string(), age: z.number().optional() }).strict(),
    tags: z.array(z.string()),
    rows: z.array(z.object({ 'a.b': z.string(), inner: z.array(z.number()) }).strict()),
    'a.b': z.string(),
    either: z.union([z.string(), z.number()]),
}).strict();

const RecordSchema = z.object({
    flat: z.record(z.string(), z.string()),
    data: z.record(z.string(), z.object({
        value: z.string(),
        n: z.number().optional(),
        tags: z.array(z.string()).optional(),
        nested: z.record(z.string(), z.object({ deep: z.boolean() }).strict()),
        rows: z.array(z.object({ leaf: z.string() }).strict()),
    }).strict()),
    listed: z.array(z.object({ bag: z.record(z.string(), z.number()) }).strict()),
}).strict();

describe('a path is resolved against the schema that describes it', () => {

    describe('a path whose every key the schema declares', () => {

        test('a scalar leaf reports its own type', () => {
            const resolved = resolve(Schema, 'contact.name');
            expect(resolved.known).toBe(true);
            expect(resolved.origin).toBe('enumerated');
            expect(resolved.leafKind).toBe('string');
            expect(resolved.arrayDepth).toBe(0);
        });

        test('an optional leaf reports the type it wraps', () => {
            expect(resolve(Schema, 'contact.age').leafKind).toBe('number');
        });

        test('a leaf that is an array stays an array, and counts as one crossing', () => {
            const resolved = resolve(Schema, 'tags');
            expect(resolved.leafKind).toBe('array');
            expect(resolved.arrayDepth).toBe(1);
        });

        test('a path through an array counts the arrays it crosses', () => {
            expect(resolve(Schema, 'rows.inner').arrayDepth).toBe(2);
            expect(resolve(Schema, 'rows.inner').leafKind).toBe('array');
        });

        test('a key the schema does not declare is unknown, not an error', () => {
            const resolved = resolve(Schema, 'contact.absent');
            expect(resolved.known).toBe(false);
            expect(resolved.origin).toBe('unknown');
            expect(resolved.leafKind).toBe(undefined);
        });

        test('a key beneath a scalar is unknown', () => {
            expect(resolve(Schema, 'id.deeper').known).toBe(false);
        });

        test('a key beneath a union is unknown, because its variants may disagree', () => {
            expect(resolve(Schema, 'either.name').known).toBe(false);
        });
    });

    describe('a key containing a literal dot', () => {

        test('the escape names one key', () => {
            expect(resolve(Schema, 'a\\.b').leafKind).toBe('string');
        });

        test('segments are decoded, so the dot survives as data', () => {
            expect(resolve(Schema, 'a\\.b').segments).toEqual(['a.b']);
            expect(resolve(Schema, 'contact.name').segments).toEqual(['contact', 'name']);
        });

        test('the raw dots name two keys, whatever the leaf lookup reports', () => {
            // Both readings of `a.b` share one entry in the schema's path map, so the leaf's type is
            // borrowed from whichever field the schema declares — here, the literal-dot one. That cannot
            // mislead: a schema declaring BOTH readings is rejected when its path map is built, so only
            // one field can exist, and the decoded segments are what an engine reads the value with.
            expect(resolve(Schema, 'a.b').segments).toEqual(['a', 'b']);

            const bothReadings = z.object({ a: z.object({ b: z.string() }), 'a.b': z.string() });
            expect(() => convertSchemaToDotPropPathTree(bothReadings)).toThrow(/Duplicate dotprop_path/);
        });

        test('the escape survives a path that also crosses an array', () => {
            const resolved = resolve(Schema, 'rows.a\\.b');
            expect(resolved.leafKind).toBe('string');
            expect(resolved.arrayDepth).toBe(1);
            expect(resolved.segments).toEqual(['rows', 'a.b']);
        });
    });

    describe('a path through a record, whose keys no schema can list', () => {

        test('a record value is reached by any key', () => {
            const resolved = resolve(RecordSchema, 'flat.whatever');
            expect(resolved.known).toBe(true);
            expect(resolved.origin).toBe('record_value');
            expect(resolved.leafKind).toBe('string');
        });

        test('a path continues past the dynamic key into the value type', () => {
            expect(resolve(RecordSchema, 'data.foo.value').leafKind).toBe('string');
            expect(resolve(RecordSchema, 'data.foo.n').leafKind).toBe('number');
        });

        test('the record value itself is reachable', () => {
            const resolved = resolve(RecordSchema, 'data.foo');
            expect(resolved.origin).toBe('record_value');
            expect(resolved.leafKind).toBe('object');
        });

        test('a record nested inside a record value resolves through both dynamic keys', () => {
            expect(resolve(RecordSchema, 'data.foo.nested.bar.deep').leafKind).toBe('boolean');
        });

        test('a record reached through an array keeps the array in its depth', () => {
            const resolved = resolve(RecordSchema, 'listed.bag.anything');
            expect(resolved.origin).toBe('record_value');
            expect(resolved.leafKind).toBe('number');
            expect(resolved.arrayDepth).toBe(1);
        });

        test('an array inside a record value is reported, so an engine can refuse it rather than mis-answer', () => {
            expect(resolve(RecordSchema, 'data.foo.tags').arrayDepth).toBe(1);
            expect(resolve(RecordSchema, 'data.foo.rows.leaf').arrayDepth).toBe(1);
            expect(resolve(RecordSchema, 'data.foo.rows.leaf').origin).toBe('record_value');
        });

        test('a record path that crosses an array is real, but no plain accessor can address it', () => {
            // A schema-planned traversal visits an array by its node in the path map, and a dynamic key has
            // none. Saying so lets an engine refuse the path rather than report the leaf as holding nothing.
            expect(isUnspreadableRecordPath(resolve(RecordSchema, 'data.foo.tags'))).toBe(true);
            expect(isUnspreadableRecordPath(resolve(RecordSchema, 'data.foo.rows.leaf'))).toBe(true);
            expect(isUnspreadableRecordPath(resolve(RecordSchema, 'listed.bag.anything'))).toBe(true);
        });

        test('a record path that crosses no array is addressable', () => {
            expect(isUnspreadableRecordPath(resolve(RecordSchema, 'data.foo.value'))).toBe(false);
            expect(isUnspreadableRecordPath(resolve(RecordSchema, 'flat.whatever'))).toBe(false);
            expect(isUnspreadableRecordPath(resolve(RecordSchema, 'data.foo'))).toBe(false);
        });

        test('an ordinary array path is addressable, because the schema names every step', () => {
            expect(isUnspreadableRecordPath(resolve(Schema, 'rows.inner'))).toBe(false);
            expect(isUnspreadableRecordPath(resolve(Schema, 'tags'))).toBe(false);
        });

        test('a key the record value does not declare is unknown', () => {
            expect(resolve(RecordSchema, 'data.foo.absent').known).toBe(false);
            expect(resolve(RecordSchema, 'data.foo.value.deeper').known).toBe(false);
        });

        test('a record key may hold a literal dot, reached through the escape', () => {
            // The decoded segments drive the descent end to end. Re-joining them would read `a.b` as two
            // keys and look for a field `b` on the record's value.
            const resolved = resolve(RecordSchema, 'data.a\\.b.value');
            expect(resolved.known).toBe(true);
            expect(resolved.segments).toEqual(['data', 'a.b', 'value']);
            expect(resolved.leafKind).toBe('string');
        });

        test('a record key may hold anything a string may hold', () => {
            for (const key of ["x' OR TRUE --", 'x"];SELECT', 'back\\slash', ' ', '$', '[0]']) {
                const resolved = resolve(RecordSchema, `data.${key.replace(/\./g, '\\.')}.value`);
                expect(resolved.known).toBe(true);
                expect(resolved.leafKind).toBe('string');
                expect(resolved.segments[1]).toBe(key);
            }
        });
    });

    describe('a path that is not a path', () => {

        test.each([
            ['the empty path', ''],
            ['a lone separator', '.'],
            ['a leading separator', '.id'],
            ['a trailing separator', 'id.'],
            ['a doubled separator', 'contact..name'],
        ])('%s is refused, because a key cannot be empty', (_name, path) => {
            const result = resolvePath(path, convertSchemaToDotPropPathTree(Schema).map);
            expect(result.success).toBe(false);
            if (result.success) return;
            expect(result.error.type).toBe('invalid_path');
            expect(result.error.dotPropPath).toBe(path);
        });

        test('an escaped dot is a key, so it is never an empty segment', () => {
            expect(resolvePath('a\\.b', convertSchemaToDotPropPathTree(Schema).map).success).toBe(true);
        });
    });
});
