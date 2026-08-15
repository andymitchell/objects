import { describe, test, expect } from "vitest";
import { z } from "zod";
import {
    writeToItemsArray,
    getWriteErrors,
    type DDL,
    type WriteAction,
    type WritePayloadSetPropertyUndefined,
    type WritePayloadDeleteProperty,
    type PropertyPathRejectionReason,
    type ArrayScopeRejectionReason,
} from "./index.ts";

/**
 * The write-actions entry point, used the way a consumer reaches it.
 *
 * Every import here comes from the barrel rather than from a module behind it, so a name that stops being
 * published fails here even while its implementation and its own tests stay untouched. The behaviour is
 * asserted end to end — build an action, send it through JSON, apply it — because surviving that journey is
 * what the write language promises, and the entry point is where a consumer takes it up.
 */
describe('the write-actions entry point', () => {

    const ProfileSchema = z.object({ id: z.string(), nickname: z.string().optional() }).strict();
    type Profile = z.infer<typeof ProfileSchema>;
    const profileDdl: DDL<Profile> = {
        version: 1,
        lists: { '.': { primary_key: 'id', default_ordering_key: { key: 'id', direction: 1 } } },
    };

    const action = (payload: WriteAction<Profile>['payload']): WriteAction<Profile> => ({ type: 'write', ts: 1, uuid: 'u1', payload });
    const overTheWire = (a: WriteAction<Profile>): WriteAction<Profile> => JSON.parse(JSON.stringify(a));

    describe('writes a consumer can build, send, and apply', () => {

        test('a property cleared after a JSON round trip keeps its key, while a removed one loses it', () => {
            const clear: WritePayloadSetPropertyUndefined<Profile> = { type: 'set_property_undefined', path: 'nickname', where: { id: '1' } };
            const remove: WritePayloadDeleteProperty<Profile> = { type: 'delete_property', path: 'nickname', where: { id: '1' } };

            const cleared = writeToItemsArray([overTheWire(action(clear))], [{ id: '1', nickname: 'nick' }], ProfileSchema, profileDdl);
            expect(cleared.ok).toBe(true);
            expect(Object.hasOwn(cleared.changes.final_items[0]!, 'nickname')).toBe(true);
            expect(cleared.changes.final_items[0]!.nickname).toBe(undefined);

            const removed = writeToItemsArray([overTheWire(action(remove))], [{ id: '1', nickname: 'nick' }], ProfileSchema, profileDdl);
            expect(removed.ok).toBe(true);
            expect(Object.hasOwn(removed.changes.final_items[0]!, 'nickname')).toBe(false);
        });

        test('an explicit undefined in written data is refused, naming the field that carried it', () => {
            // Not type-valid at the top level of `data`; the cast is what a value arriving from parsed JSON
            // or an `any`-typed source looks like by the time the runtime gate sees it.
            const updated = writeToItemsArray(
                [action({ type: 'update', data: { nickname: undefined } as never, where: { id: '1' } })],
                [{ id: '1', nickname: 'nick' }], ProfileSchema, profileDdl,
            );
            const updateError = getWriteErrors(updated)[0];
            expect(updateError?.type).toBe('invalid_data_value');
            if (updateError?.type === 'invalid_data_value') expect(updateError.data_path).toBe('nickname');
            expect(updated.changes.final_items).toEqual([{ id: '1', nickname: 'nick' }]);

            const created = writeToItemsArray(
                [action({ type: 'create', data: { id: '2', nickname: undefined } as never })],
                [], ProfileSchema, profileDdl,
            );
            const createError = getWriteErrors(created)[0];
            expect(createError?.type).toBe('invalid_data_value');
            if (createError?.type === 'invalid_data_value') expect(createError.data_path).toBe('nickname');
            expect(created.changes.final_items).toEqual([]);
        });
    });

    describe('vocabularies a consumer can name', () => {

        test('a refused write target can be branched on by its declared reason', () => {
            // The annotations are the assertion: neither reason union can be named unless it is published,
            // so dropping either export fails to compile even though the runtime check would still pass.
            const propertyReason: PropertyPathRejectionReason = 'not_optional';
            const scopeReason: ArrayScopeRejectionReason = 'unknown_path';

            const refused = writeToItemsArray(
                [action({ type: 'delete_property', path: 'id' as never, where: { id: '1' } })],
                [{ id: '1' }], ProfileSchema, profileDdl,
            );
            const error = getWriteErrors(refused)[0];
            expect(error?.type).toBe('invalid_property_path');
            if (error?.type === 'invalid_property_path') expect(error.reason).toBe(propertyReason);
            expect(scopeReason).toBe('unknown_path');
        });
    });
});
