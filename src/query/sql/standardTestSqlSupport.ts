import { z } from 'zod';

import type { DDL } from '../../ddl/types.ts';
import { STANDARD_TEST_DDL, type StandardTestItem } from '../standardTestFixtures.ts';
import type { ColumnTableInfo, ObjectTableInfo } from '../types.ts';

/**
 * Internal support for the per-dialect standard-test suites
 * (`prepareObjectTableQuery.pg.test.ts`, `prepareObjectTableQuery.sqlite.test.ts`,
 * `prepareColumnTableQuery.pg.test.ts`, `prepareColumnTableQuery.sqlite.test.ts`).
 *
 * Those suites run `standardTests` against real engines (PGlite / better-sqlite3), so every
 * fixture shape has to fit one physical table per suite. This module defines that table's
 * contract once: a superset row schema for the JSON-column variant, and the flat column set
 * for the relational variant.
 *
 * Not exported from any barrel — test support only.
 */

/**
 * Superset row schema covering every standard-test fixture shape (`StandardTestItem` union
 * flattened into one object). The object-table suites hand it to `prepareObjectTableQuery`,
 * which uses it to resolve sort-key paths and pick dialect casts.
 */
export const StandardTestRowSchema = z.object({
    id: z.string(),
    age: z.number().optional(),
    name: z.string().optional(),
    category: z.string().optional(),
    date: z.string().optional(),
    value: z.number().nullish(),
    score: z.number().optional(),
    sender: z.object({ name: z.string() }).optional(),
    flag: z.boolean().optional(),
});
export type StandardTestRow = z.infer<typeof StandardTestRowSchema>;

/** Table descriptor for the JSON-column (object-table) suites. */
export const OBJECT_TABLE: ObjectTableInfo<StandardTestRow> = {
    tableName: 'items',
    objectColumnName: 'data',
    ddl: { primary_key: 'id' },
    schema: StandardTestRowSchema,
};

/**
 * The flat columns of the relational (column-table) variant. `sender` is absent: a nested
 * object has no relational column, so the dot-prop test is gated off via `COLUMN_TABLE_DDL`.
 */
export const COLUMN_TABLE_COLUMNS = ['id', 'age', 'name', 'category', 'date', 'value', 'score', 'flag'] as const;

/** Table descriptor for the relational (column-table) suites. */
export const COLUMN_TABLE: ColumnTableInfo = {
    tableName: 'items',
    pkColumnName: 'id',
    allowedColumns: [...COLUMN_TABLE_COLUMNS],
};

/**
 * DDL for the column-table suites: declares exactly the flat columns sortable, so
 * `standardTests` statically skips the nested `sender.name` test (unaddressable in a
 * relational table) and runs everything else.
 */
export const COLUMN_TABLE_DDL: DDL<StandardTestItem> = {
    ...STANDARD_TEST_DDL,
    lists: {
        '.': {
            primary_key: 'id',
            default_ordering_key: { key: 'id', direction: 1 },
            sortable_keys: COLUMN_TABLE_COLUMNS.map(key => ({ key })),
        },
    },
};

/**
 * Maps a fixture item to the column-table insert parameters: one value per flat column
 * (absent/undefined becomes SQL NULL), then the whole item as a JSON `payload` string.
 *
 * Rows are selected back via `payload` and `JSON.parse`d, so the round-trip reproduces the
 * exact item regardless of how each driver types its column values; the typed columns exist
 * purely for the engine to ORDER BY.
 *
 * @param dialect Booleans bind as-is for Postgres (a real `BOOLEAN` column), but
 *   better-sqlite3 cannot bind a JS boolean, so for SQLite they become `1`/`0` into the
 *   `INTEGER` flag column — SQLite's own boolean representation.
 */
export function toColumnRowParams(item: Record<string, unknown>, dialect: 'pg' | 'sqlite'): unknown[] {
    return [
        ...COLUMN_TABLE_COLUMNS.map(column => {
            const value = item[column] ?? null;
            if (dialect === 'sqlite' && typeof value === 'boolean') return value ? 1 : 0;
            return value;
        }),
        JSON.stringify(item),
    ];
}
