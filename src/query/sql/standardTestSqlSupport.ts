import { z } from 'zod';

import type { DDL } from '../../ddl/types.ts';
import { isEncodedBigInt } from '../sortCompare.ts';
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
 * `amount` is the bigint column exercised only by the opt-in bigint battery
 * (`../standardTests.bigint.ts`); it has no counterpart in `StandardTestRowSchema` because the
 * JSON-document (object-table) suites cannot store a bigint and reject the key instead.
 */
export const COLUMN_TABLE_COLUMNS = ['id', 'age', 'name', 'category', 'date', 'value', 'score', 'flag', 'amount'] as const;

/** Table descriptor for the relational (column-table) suites. */
export const COLUMN_TABLE: ColumnTableInfo = {
    tableName: 'items',
    pkColumnName: 'id',
    allowedColumns: [...COLUMN_TABLE_COLUMNS],
    // Kinds mirror the fixture schemas: string leaves → text, number leaves → numeric,
    // flag → boolean, amount → bigint.
    columnKinds: {
        id: 'text',
        age: 'numeric',
        name: 'text',
        category: 'text',
        date: 'text',
        value: 'numeric',
        score: 'numeric',
        flag: 'boolean',
        amount: 'bigint',
    },
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
 * Serialises a fixture item to the `payload` TEXT column. `JSON.stringify` cannot carry a
 * bigint, so bigint fields are written in the ordering contract's tagged form
 * (`{ $bigint: '<decimal>' }`); {@link parsePayload} reverses it. Items without bigints
 * serialise exactly as plain `JSON.stringify` would.
 */
export function stringifyPayload(item: Record<string, unknown>): string {
    return JSON.stringify(item, (_key, value: unknown) =>
        typeof value === 'bigint' ? { $bigint: value.toString() } : value);
}

/**
 * Parses a `payload` column back to the exact fixture item, reviving tagged bigints.
 *
 * Any value of the reserved `{ $bigint: '<canonical>' }` shape revives to a `BigInt` — the same
 * reservation the ordering contract makes — so a fixture holding such an object as a genuine
 * user value would fail its round-trip equality loudly rather than survive ambiguously.
 */
export function parsePayload(payload: string): Record<string, unknown> {
    return JSON.parse(payload, (_key, value: unknown) =>
        isEncodedBigInt(value) ? BigInt(value.$bigint) : value) as Record<string, unknown>;
}

/**
 * Maps a fixture item to the column-table insert parameters: one value per flat column
 * (absent/undefined becomes SQL NULL), then the whole item as a `payload` string built by
 * {@link stringifyPayload}.
 *
 * Rows are selected back via `payload` and {@link parsePayload}, so the round-trip reproduces
 * the exact item regardless of how each driver types its column values; the typed columns exist
 * purely for the engine to ORDER BY. Bigint values bind as-is — both PGlite and better-sqlite3
 * accept a JS bigint parameter natively.
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
        stringifyPayload(item),
    ];
}
