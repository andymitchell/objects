import { describe, expect, it } from 'vitest';
import {
    StandardTestItemSchema,
    booleanItems,
    multiTiedItems,
    nestedItems,
    nullableItems,
    nullishItems,
    numericItems,
    tenItems,
    tiedItems,
    undefinedItems,
    unicodeItems,
} from './standardTestFixtures.ts';

/**
 * Every fixture item must survive `StandardTestItemSchema.parse` unchanged.
 *
 * The schema is a union whose branches overlap on `id`; a branch that silently
 * accepts an item while stripping its other fields would hand implementations
 * rows that cannot exercise the sort the fixture was designed for (e.g. a
 * multi-key tiebreaker fixture reduced to bare `{id}` sorts in pk order and
 * the test passes vacuously). Lossless parsing is therefore a contract of the
 * fixture module itself.
 */
describe('standardTestFixtures', () => {

    const fixtureArrays: Array<[name: string, items: ReadonlyArray<Record<string, unknown>>]> = [
        ['numericItems', numericItems],
        ['nullableItems', nullableItems],
        ['undefinedItems', undefinedItems],
        ['nullishItems', nullishItems],
        ['nestedItems', nestedItems],
        ['tiedItems', tiedItems],
        ['multiTiedItems', multiTiedItems],
        ['unicodeItems', unicodeItems],
        ['booleanItems', booleanItems],
        ['tenItems', tenItems],
    ];

    describe('StandardTestItemSchema parses every fixture item without losing fields', () => {
        for (const [name, items] of fixtureArrays) {
            it(`preserves every ${name} item exactly`, () => {
                for (const item of items) {
                    expect(StandardTestItemSchema.parse(item)).toEqual(item);
                }
            });
        }
    });
});
