import { z } from 'zod';

import type { DDL } from '../ddl/types.ts';

/**
 * Fixture types and items used by the shared sort-and-slice standard tests
 * (see `./standardTests.ts`). Published here so adapters can build a real
 * ICollection from `STANDARD_TEST_DDL` + the matching Zod schemas, and have
 * the standard tests gate per-test via the DDL's `sortable_keys`.
 *
 * Each fixture covers one test angle:
 *  - `NumericItem` — multi-field with mixed types (numeric, string, category, date)
 *  - `NullableItem` — nullable values for null-last sort assertions
 *  - `UndefinedItem` — undefined values for absent-last sort assertions
 *  - `NullishItem` — null and absent values together, for null-group ordering assertions
 *  - `NestedItem` — nested object for dot-prop sort key
 *  - `TiedItem` — duplicate sort values for PK tiebreaker
 *  - `MultiTiedItem` — rows tied on every key of a multi-key sort, for PK tiebreaker assertions
 *  - `UnicodeItem` — strings beyond the Basic Multilingual Plane, for code-point ordering assertions
 *  - `BooleanItem` — boolean sort values, for false-before-true ordering assertions
 */

export type NumericItem = { id: string; age: number; name: string; category: string; date: string };
export type NullableItem = { id: string; value: number | null };
export type UndefinedItem = { id: string; value?: number };
export type NullishItem = { id: string; value?: number | null };
export type NestedItem = { id: string; sender: { name: string } };
export type TiedItem = { id: string; score: number };
export type MultiTiedItem = { id: string; score: number; date: string };
export type UnicodeItem = { id: string; name: string };
export type BooleanItem = { id: string; flag: boolean };

// Every member schema is strict: within the union, a branch must reject items carrying keys it
// does not declare, so parsing resolves to the branch that fully describes the item and never
// strips fields (a loose branch like {id, value?} would otherwise swallow richer shapes to `{id}`).
export const NumericItemSchema = z.strictObject({
    id: z.string(),
    age: z.number(),
    name: z.string(),
    category: z.string(),
    date: z.string(),
});

export const NullableItemSchema = z.strictObject({
    id: z.string(),
    value: z.number().nullable(),
});

export const UndefinedItemSchema = z.strictObject({
    id: z.string(),
    value: z.number().optional(),
});

export const NullishItemSchema = z.strictObject({
    id: z.string(),
    value: z.number().nullish(),
});

export const NestedItemSchema = z.strictObject({
    id: z.string(),
    sender: z.strictObject({ name: z.string() }),
});

export const TiedItemSchema = z.strictObject({
    id: z.string(),
    score: z.number(),
});

export const MultiTiedItemSchema = z.strictObject({
    id: z.string(),
    score: z.number(),
    date: z.string(),
});

export const UnicodeItemSchema = z.strictObject({
    id: z.string(),
    name: z.string(),
});

export const BooleanItemSchema = z.strictObject({
    id: z.string(),
    flag: z.boolean(),
});

/** Union covering every shape used in the standard sort/slice tests. All branches share `id: string`. */
export type StandardTestItem = NumericItem | NullableItem | UndefinedItem | NullishItem | NestedItem | TiedItem | MultiTiedItem | UnicodeItem | BooleanItem;

/**
 * Zod union mirroring `StandardTestItem`. First-match wins; because every member is strict,
 * a branch can only win for items it fully describes, so parsing never strips fields.
 * Overlapping value shapes (NullableItem/UndefinedItem/NullishItem) may resolve to an earlier
 * branch, which is harmless: the accepted keys and values are identical.
 */
export const StandardTestItemSchema = z.union([
    NumericItemSchema,
    NullableItemSchema,
    UndefinedItemSchema,
    NullishItemSchema,
    NestedItemSchema,
    TiedItemSchema,
    MultiTiedItemSchema,
    UnicodeItemSchema,
    BooleanItemSchema,
]);

export const numericItems: NumericItem[] = [
    { id: 'a', age: 30, name: 'Charlie', category: 'B', date: '2024-01-03' },
    { id: 'b', age: 10, name: 'Alice', category: 'A', date: '2024-01-01' },
    { id: 'c', age: 20, name: 'Bob', category: 'A', date: '2024-01-02' },
    { id: 'd', age: 40, name: 'Diana', category: 'B', date: '2024-01-04' },
    { id: 'e', age: 25, name: 'Eve', category: 'A', date: '2024-01-05' },
];

export const nullableItems: NullableItem[] = [
    { id: '1', value: 5 },
    { id: '2', value: null },
    { id: '3', value: 3 },
    { id: '4', value: null },
];

export const undefinedItems: UndefinedItem[] = [
    { id: '1', value: 5 },
    { id: '2' },
    { id: '3', value: 3 },
    { id: '4' },
];

export const nullishItems: NullishItem[] = [
    { id: '1', value: 5 },
    { id: '2', value: null },
    { id: '3' },
    { id: '4', value: 3 },
    { id: '5', value: null },
];

export const nestedItems: NestedItem[] = [
    { id: 'x', sender: { name: 'Zara' } },
    { id: 'y', sender: { name: 'Alice' } },
    { id: 'z', sender: { name: 'Mike' } },
];

export const tiedItems: TiedItem[] = [
    { id: 'c', score: 10 },
    { id: 'a', score: 10 },
    { id: 'b', score: 10 },
];

// e/a carry distinct scores; c and d tie on BOTH score and date, so only the pk ASC tiebreaker orders c before d.
export const multiTiedItems: MultiTiedItem[] = [
    { id: 'b', score: 20, date: '2024-01-01' },
    { id: 'd', score: 20, date: '2024-01-02' },
    { id: 'a', score: 10, date: '2024-01-05' },
    { id: 'c', score: 20, date: '2024-01-02' },
    { id: 'e', score: 5, date: '2024-01-09' },
];

// Names span the empty string, ASCII, a private-use BMP character (U+E000) and a
// supplementary-plane character (U+10000, a UTF-16 surrogate pair). Code-point order is
// '' < 'zz' < U+E000 < U+10000, so name ASC yields b,d,a,c — neither direction matches pk
// order, and an implementation comparing by UTF-16 code unit swaps a and c.
// Built with String.fromCodePoint so the source holds no invisible characters.
export const unicodeItems: UnicodeItem[] = [
    { id: 'a', name: String.fromCodePoint(0xE000) },
    { id: 'b', name: '' },
    { id: 'c', name: String.fromCodePoint(0x10000) },
    { id: 'd', name: 'zz' },
];

// a/d false, b/c true: flag ASC yields a,d,b,c and DESC yields b,c,a,d — neither is pk order,
// so an implementation ignoring the flag cannot pass by accident.
export const booleanItems: BooleanItem[] = [
    { id: 'a', flag: false },
    { id: 'b', flag: true },
    { id: 'c', flag: true },
    { id: 'd', flag: false },
];

/** 10 items for limit/offset/cursor tests, using PK ASC as default sort. */
export const tenItems: NumericItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i).padStart(2, '0'),
    age: (i + 1) * 10,
    name: `Name${i}`,
    category: i % 2 === 0 ? 'even' : 'odd',
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
}));

/**
 * Default DDL the standard tests assume when none is passed via `StandardTestConfig.ddl`.
 *
 * `sortable_keys` is omitted, meaning arbitrary — every test sort key is allowed and runs.
 * Implementations that wish to declare a restricted set pass their own DDL with
 * `lists['.'].sortable_keys` populated; the standard tests then gate per-test via `it.skip`.
 *
 * `primary_key: 'id'` is shared across all fixture branches, so it's the only valid PK
 * across the union.
 */
export const STANDARD_TEST_DDL: DDL<StandardTestItem> = {
    version: 1,
    lists: {
        '.': {
            primary_key: 'id',
            default_ordering_key: { key: 'id', direction: 1 },
        },
    },
};
