import type { z } from 'zod';
import type { ZodKind } from '../../dot-prop-paths/schema-tree.ts';
import { convertDotPropPathToPostgresJsonPath } from '../../utils/sql/postgres/convertDotPropPathToPostgresJsonPath.ts';
import { convertDotPropPathToSqliteJsonPath } from '../../utils/sql/sqlite/convertDotPropPathToSqliteJsonPath.ts';
import type { DotPropPathConversionResult } from '../../utils/sql/types.ts';
import type { SqlDialect } from './types.ts';

/**
 * The leaf kinds a sort key may address: everything except `object` and `array`. Structural
 * values have no cross-backend ordering — Postgres would order jsonb by its btree rules,
 * SQLite by raw JSON text, and the runtime comparator by string form — so the sort/cursor
 * path converters refuse them rather than let the three orderings silently diverge.
 *
 * Declared as an exhaustive record over `Exclude<ZodKind, 'object' | 'array'>` so a Zod
 * upgrade that introduces a new kind fails compilation here instead of silently refusing it.
 */
const SORTABLE_LEAF_KIND_MAP: Record<Exclude<ZodKind, 'object' | 'array'>, true> = {
    any: true, bigint: true, boolean: true, catch: true, custom: true, date: true,
    default: true, enum: true, file: true, function: true, int: true, intersection: true,
    lazy: true, literal: true, map: true, nan: true, never: true, nonoptional: true,
    null: true, nullable: true, number: true, optional: true, pipe: true, prefault: true,
    promise: true, readonly: true, record: true, set: true, string: true, success: true,
    symbol: true, template_literal: true, transform: true, tuple: true, undefined: true,
    union: true, unknown: true, void: true,
};
const SORTABLE_LEAF_KINDS = Object.getOwnPropertyNames(SORTABLE_LEAF_KIND_MAP) as ZodKind[];

/**
 * The one dialect-specific SQL expression a JSON sort key resolves to.
 *
 * A sort key is a dot-prop path into the JSON column (`'sender.name'`); reading it in SQL means
 * an extraction expression — `json_extract(body, '$."sender"."name"')` on SQLite, a chain of
 * jsonb accessors plus a type cast on Postgres. This function is where that text is decided.
 *
 * Everything that reads a sort key must use exactly this text: the `ORDER BY` list, the keyset
 * predicates that page through it, and any expression index built to serve them. Postgres matches
 * an index to a query by comparing expressions structurally, cast and collation included, and
 * SQLite matches the JSON-path literal byte for byte — so an index built on any other rendering of
 * the same path is dead weight the emitted queries silently cannot use.
 *
 * The path is resolved against the table's Zod schema, which both proves the field exists (an
 * unresolvable path can never reach the emitted SQL) and classifies its leaf, deciding the Postgres
 * cast and the returned {@link DotPropPathConversionResult.kind}.
 *
 * @param dialect - `'pg'` or `'sqlite'`.
 * @param columnName - The JSON column the path is read out of.
 * @param dotPropPath - The sort key, e.g. `'rank'` or `'sender.name'`.
 * @param schema - The Zod schema describing the stored object.
 * @returns `{ success: true, expression, kind? }` with the expression to embed verbatim, or
 *   `{ success: false, error }` naming the offending key. Never throws.
 *
 * @example
 * buildSortKeyExpression('pg', 'body', 'rank', Schema);
 * // { success: true, expression: `(body->>E'rank')::numeric`, kind: 'numeric' }
 *
 * @example
 * buildSortKeyExpression('sqlite', 'body', 'sender.name', Schema);
 * // { success: true, expression: `json_extract(body, '$."sender"."name"')`, kind: 'text' }
 *
 * @example
 * // The expression an index must be built on to serve queries sorted by that key.
 * const expr = buildSortKeyExpression('pg', 'body', 'rank', Schema);
 * if (expr.success) db.exec(`CREATE INDEX ON emails ((${expr.expression}))`);
 *
 * @remarks
 * A Postgres text leaf carries `COLLATE "C"`, pinning it to code-point order so the database's
 * default locale cannot reorder results away from `compareValues`. The pin is applied by the path
 * converter, which serves where-filters too, so a filter and a sort on the same key compare alike
 * and one index serves both.
 *
 * Two kinds of key are refused rather than rendered. A structural leaf (object or array) has no
 * ordering the JS comparator and both SQL dialects agree on (`unexpected_kind`). A bigint leaf is a
 * contradiction on a JSON table — JSON cannot carry a bigint, so no stored value can order by one
 * (`unsupported_kind`); store a serialisable form, or use a column table. Every error message is
 * prefixed with the key, since a multi-key sort otherwise yields errors a caller cannot attribute.
 *
 * Relational tables are deliberately not served here: `prepareColumnTableQuery` reads declared
 * columns by name with declared kinds, and has no JSON path or schema to resolve, so it keeps its
 * own expression model.
 */
export function buildSortKeyExpression<T extends Record<string, any> = Record<string, any>>(
    dialect: SqlDialect,
    columnName: string,
    dotPropPath: string,
    schema: z.ZodSchema<T>,
): DotPropPathConversionResult {
    const result = dialect === 'pg'
        ? convertDotPropPathToPostgresJsonPath(columnName, dotPropPath, schema, SORTABLE_LEAF_KINDS)
        : convertDotPropPathToSqliteJsonPath(columnName, dotPropPath, schema, SORTABLE_LEAF_KINDS);
    if (!result.success) {
        // Name the offending key: a multi-key sort otherwise yields errors a caller cannot attribute.
        return { success: false, error: { ...result.error, message: `Sort key '${dotPropPath}': ${result.error.message}` } };
    }
    // JSON storage cannot carry a bigint, so a bigint-classified sort key on an object table is
    // a contradiction the caller's serialisation layer must resolve; rejecting loudly beats a
    // plausible-looking wrong walk. See decisions.md dec-object-table-bigint-rejection.
    if (result.kind === 'bigint') {
        return { success: false, error: { type: 'unsupported_kind', dotPropPath, message: `Sort key '${dotPropPath}': schema type bigint cannot be sorted or paged on an object (JSON) table — JSON cannot carry a bigint, so no stored value can order by it. Store the value in a serialisable form, or use a column table with columnKinds['${dotPropPath}'] = 'bigint'.` } };
    }
    return result;
}
