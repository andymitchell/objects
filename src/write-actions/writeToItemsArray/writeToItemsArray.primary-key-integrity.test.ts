import { describe, test, expect } from "vitest";
import { z } from "zod";
import { writeToItemsArray } from "./writeToItemsArray.ts";
import { getWriteFailures } from "../helpers.ts";
import type { DDL } from "../../ddl/types.ts";
import type { WriteAction } from "../types.ts";

// The engine locates, reports and reconciles every item by its primary key, so the key a row already carries
// is the one field a write may not change. Whatever an action does to reach it — naming it in an update's
// `data`, or pointing a path verb at it — the write is refused as a value, never applied and never thrown
// over, so every row stays locatable and the batch settles like any other failure.

const ObjSchema = z.object({
    id: z.string(),
    text: z.string().optional(),
}).strict();
type Obj = z.infer<typeof ObjSchema>;

const objDdl: DDL<Obj> = {
    version: 1,
    lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
};

const seed = (): Obj[] => [{ id: '1', text: 'a' }];

const NumericKeySchema = z.object({
    id: z.number(),
    count: z.number().optional(),
    text: z.string().optional(),
}).strict();
type NumericKey = z.infer<typeof NumericKeySchema>;

const numericKeyDdl: DDL<NumericKey> = {
    version: 1,
    lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
};

const numericKeySeed = (): NumericKey[] => [{ id: 5, count: 1, text: 'ok' }];

// A key holding a literal dot is an ordinary key. `inc` addresses raw key names, so `'a.b'` names this one
// key — while a path the engine REPORTS is written in the escaped dot-prop grammar, where the same key is
// spelled `a\.b`.
const DottedKeySchema = z.object({
    'a.b': z.number(),
    text: z.string().optional(),
}).strict();
type DottedKey = z.infer<typeof DottedKeySchema>;

const dottedKeyDdl: DDL<DottedKey> = {
    version: 1,
    lists: { '.': { primary_key: 'a.b', default_ordering_key: { key: 'a\\.b', direction: 1 } } },
};

const dottedKeySeed = (): DottedKey[] => [{ 'a.b': 7, text: 'x' }];

const NestedDottedKeySchema = z.object({
    id: z.string(),
    rows: z.array(z.object({ 'a.b': z.number(), label: z.string().optional() }).strict()).optional(),
}).strict();
type NestedDottedKey = z.infer<typeof NestedDottedKeySchema>;

const nestedDottedKeyDdl: DDL<NestedDottedKey> = {
    version: 1,
    lists: {
        '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } },
        'rows': { primary_key: 'a.b' },
    },
};

const nestedDottedKeySeed = (): NestedDottedKey[] => [{ id: '1', rows: [{ 'a.b': 7, label: 'x' }] }];

/** Build a write action from a well-typed payload. */
const write = <T extends Record<string, any>>(payload: WriteAction<T>['payload'], uuid = 'u'): WriteAction<T> =>
    ({ type: 'write', ts: 0, uuid, payload });

/**
 * Build a write action whose payload holds a value the payload types forbid, so the runtime is what answers.
 *
 * A caller reaching the engine from untyped JavaScript, or across a boundary that did not re-validate, can
 * send a primary key of any type at all — so a refusal has to be exercised with values the TypeScript surface
 * already rules out. The single assertion is quarantined here rather than repeated at each call site.
 */
const writeForeign = <T extends Record<string, any>>(payload: unknown, uuid = 'u'): WriteAction<T> =>
    ({ type: 'write', ts: 0, uuid, payload: payload as WriteAction<T>['payload'] });

describe('writeToItemsArray — primary-key integrity (errors as values)', () => {

    describe('an update whose data names the primary key', () => {

        test('an update that blanks the primary key fails as a value instead of throwing', () => {
            const actions = [
                write<Obj>({ type: 'update', data: { id: '' }, where: { id: '1' } }, 'a1'),
                write<Obj>({ type: 'update', data: { text: 'b' }, where: { id: '1' } }, 'a2'),
            ];
            expect(() => writeToItemsArray(actions, seed(), ObjSchema, objDdl)).not.toThrow();

            const result = writeToItemsArray(actions, seed(), ObjSchema, objDdl);
            expect(result.ok).toBe(false);
            const failure = getWriteFailures(result)[0]!;
            expect(failure.action_uuid).toBe('a1');
            expect(failure.errors[0]).toMatchObject({ type: 'update_altered_key', primary_key: 'id' });
            expect(failure.errors[0]!.item_pk).toBe('1');
            expect(failure.unrecoverable).toBe(true);
        });

        test('a single blanking update under mutate mode fails as a value instead of throwing', () => {
            const action = write<Obj>({ type: 'update', data: { id: '' }, where: { id: '1' } });
            expect(() => writeToItemsArray([action], seed(), ObjSchema, objDdl, { mutate: true })).not.toThrow();

            const item: Obj = { id: '1', text: 'a' };
            const result = writeToItemsArray([action], [item], ObjSchema, objDdl, { mutate: true });
            expect(result.ok).toBe(false);
            expect(result.changes.final_items[0]).toBe(item);
            expect(item).toEqual({ id: '1', text: 'a' });
        });

        test('a single blanking update in clone mode reports failure rather than returning a corrupted item', () => {
            const result = writeToItemsArray(
                [write<Obj>({ type: 'update', data: { id: '' }, where: { id: '1' } })],
                seed(), ObjSchema, objDdl,
            );
            expect(result.ok).toBe(false);
            expect(result.changes.final_items).toEqual(seed());
        });

        test.each([
            ['an empty string', ''],
            ['null', null],
            ['false', false],
        ])('a primary key set to %s is an altered key', (_label, value) => {
            const result = writeToItemsArray(
                [writeForeign<Obj>({ type: 'update', data: { id: value }, where: { id: '1' } })],
                seed(), ObjSchema, objDdl,
            );
            expect(result.ok).toBe(false);
            expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'update_altered_key', primary_key: 'id' });
            expect(result.changes.final_items).toEqual(seed());
        });

        test('a zero primary key on a numeric-key schema is an altered key, not a missing key', () => {
            // A create judges the same value the other way round: there the payload IS the item, so a falsy
            // key leaves it with no locator at all. An update's row already carries a usable key, which makes
            // naming any other value — falsy or not — an attempted change to it.
            const result = writeToItemsArray(
                [write<NumericKey>({ type: 'update', data: { id: 0 }, where: { id: 5 } })],
                numericKeySeed(), NumericKeySchema, numericKeyDdl,
            );
            expect(result.ok).toBe(false);
            const error = getWriteFailures(result)[0]!.errors[0]!;
            expect(error).toMatchObject({ type: 'update_altered_key', primary_key: 'id' });
            expect(error.item_pk).toBe(5);
            expect(result.changes.final_items).toEqual(numericKeySeed());
        });

        test('a primary key present but not enumerable is still judged', () => {
            // Presence is judged with `in`, deliberately wider than the own-enumerable walk the value gate
            // makes, so a carrier the gate cannot see is refused outright rather than half-trusted.
            const data: Record<string, unknown> = { text: 'b' };
            Object.defineProperty(data, 'id', { value: '', enumerable: false });

            const result = writeToItemsArray(
                [writeForeign<Obj>({ type: 'update', data, where: { id: '1' } })],
                seed(), ObjSchema, objDdl,
            );
            expect(result.ok).toBe(false);
            expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'update_altered_key', primary_key: 'id' });
            expect(result.changes.final_items).toEqual(seed());
        });

        test('every action in the batch is accounted for, the later ones as blocked', () => {
            const actions = [
                write<Obj>({ type: 'update', data: { id: '' }, where: { id: '1' } }, 'a1'),
                write<Obj>({ type: 'update', data: { text: 'b' }, where: { id: '1' } }, 'a2'),
            ];
            const result = writeToItemsArray(actions, seed(), ObjSchema, objDdl);

            expect(result.actions.map(a => a.action_uuid)).toEqual(['a1', 'a2']);
            expect(getWriteFailures(result).find(f => f.action_uuid === 'a2')?.blocked_by_action_uuid).toBe('a1');
        });

        test("an update carrying the key's own value is not a primary-key alteration", () => {
            const result = writeToItemsArray(
                [write<Obj>({ type: 'update', data: { id: '1', text: 'b' }, where: { id: '1' } })],
                seed(), ObjSchema, objDdl,
            );
            expect(result.ok).toBe(true);
            expect(result.changes.final_items).toEqual([{ id: '1', text: 'b' }]);
        });

        test('an altered-key update whose where matches nothing succeeds, like any zero-match update', () => {
            // An altered key is judged per matched row, so a where that matches nothing has nothing to judge —
            // exactly as it would for an ordinary `id: 'changed'`. A path verb differs because its target is
            // illegal under any match at all, which is why that fault is raised before matching begins.
            const result = writeToItemsArray(
                [write<Obj>({ type: 'update', data: { id: '' }, where: { id: 'nope' } })],
                seed(), ObjSchema, objDdl,
            );
            expect(result.ok).toBe(true);
            expect(result.changes.final_items).toEqual(seed());
        });
    });

    describe('a path verb naming the primary key', () => {

        test('inc naming the primary key is refused before any item is matched', () => {
            const incrementKeyOf = (matchedId: number) => writeToItemsArray(
                [write<NumericKey>({ type: 'inc', path: 'id', amount: -5, where: { id: matchedId } })],
                numericKeySeed(), NumericKeySchema, numericKeyDdl,
            );

            // A key the engine may never move is a fault in the action itself, so it is answered whether or
            // not the where reaches anything — the same standing the other path verbs already have.
            const unmatched = incrementKeyOf(999);
            expect(unmatched.ok).toBe(false);
            expect(getWriteFailures(unmatched)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'id', reason: 'primary_key' });

            const matched = incrementKeyOf(5);
            expect(matched.ok).toBe(false);
            expect(getWriteFailures(matched)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'id', reason: 'primary_key' });
            expect(matched.changes.final_items).toEqual(numericKeySeed());
        });

        test('inc naming a literal dotted primary key is refused, reported in the escaped grammar', () => {
            const result = writeToItemsArray(
                [write<DottedKey>({ type: 'inc', path: 'a.b', amount: 1, where: {} })],
                dottedKeySeed(), DottedKeySchema, dottedKeyDdl,
            );
            expect(result.ok).toBe(false);
            expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'a\\.b', reason: 'primary_key' });
            expect(result.changes.final_items).toEqual(dottedKeySeed());
        });

        test("inc naming a scoped list's own dotted primary key reports the escaped path under its scope", () => {
            const result = writeToItemsArray(
                [write<NestedDottedKey>({
                    type: 'array_scope', scope: 'rows', where: { id: '1' },
                    action: { type: 'inc', path: 'a.b', amount: 1, where: {} },
                })],
                nestedDottedKeySeed(), NestedDottedKeySchema, nestedDottedKeyDdl,
            );
            expect(result.ok).toBe(false);
            expect(getWriteFailures(result)[0]!.errors[0]).toMatchObject({ type: 'invalid_property_path', path: 'rows.a\\.b', reason: 'primary_key' });
            expect(result.changes.final_items).toEqual(nestedDottedKeySeed());
        });

        test('inc on an ordinary numeric field still applies', () => {
            const result = writeToItemsArray(
                [write<NumericKey>({ type: 'inc', path: 'count', amount: 3, where: { id: 5 } })],
                numericKeySeed(), NumericKeySchema, numericKeyDdl,
            );
            expect(result.ok).toBe(true);
            expect(result.changes.final_items).toEqual([{ id: 5, count: 4, text: 'ok' }]);
        });
    });
});
