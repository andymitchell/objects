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
 *  - `NestedItem` — nested object for dot-prop sort key
 *  - `TiedItem` — duplicate sort values for PK tiebreaker
 */

export type NumericItem = { id: string; age: number; name: string; category: string; date: string };
export type NullableItem = { id: string; value: number | null };
export type UndefinedItem = { id: string; value?: number };
export type NestedItem = { id: string; sender: { name: string } };
export type TiedItem = { id: string; score: number };

export const NumericItemSchema = z.object({
    id: z.string(),
    age: z.number(),
    name: z.string(),
    category: z.string(),
    date: z.string(),
});

export const NullableItemSchema = z.object({
    id: z.string(),
    value: z.number().nullable(),
});

export const UndefinedItemSchema = z.object({
    id: z.string(),
    value: z.number().optional(),
});

export const NestedItemSchema = z.object({
    id: z.string(),
    sender: z.object({ name: z.string() }),
});

export const TiedItemSchema = z.object({
    id: z.string(),
    score: z.number(),
});

/** Union covering every shape used in the standard sort/slice tests. All branches share `id: string`. */
export type StandardTestItem = NumericItem | NullableItem | UndefinedItem | NestedItem | TiedItem;

/** Zod union mirroring `StandardTestItem`. First-match wins; branches with overlapping shapes (NullableItem/UndefinedItem) accept either. */
export const StandardTestItemSchema = z.union([
    NumericItemSchema,
    NullableItemSchema,
    UndefinedItemSchema,
    NestedItemSchema,
    TiedItemSchema,
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
    ownership: { type: 'none' },
    lists: {
        '.': {
            primary_key: 'id',
        },
    },
};
