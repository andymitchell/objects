import type { z } from "zod";
import type { DotPropPathsUnion } from "../dot-prop-paths/types.ts";
import type { PrimaryKeyValue } from '../utils/getKeyValue.ts';
import type { PreparedStatementArgument } from '../utils/sql/types.ts';
import type { PreparedWhereClauseStatement } from '../where-filter/sql/types.ts';
import type { SortAndSliceSchema, SortDefinitionSchema, SortEntrySchema } from './schemas.ts';
import { isTypeEqual } from "@andyrmitchell/utils";

// Re-export for consumer convenience
export type { PrimaryKeyValue } from '../utils/getKeyValue.ts';

/**
 * A single sort entry: key + direction. Mongo-style: 1 = ascending, -1 = descending.
 */
export type SortEntry<T> = { key: DotPropPathsUnion<T>; direction: 1 | -1 };

/**
 * Ordered list of sort keys with direction. Mongo-style: 1 = ascending, -1 = descending.
 * Keys are dot-prop paths into T (same as WhereFilterDefinition property paths).
 *
 * @example
 * const sort: SortDefinition<Email> = [
 *   { key: 'date', direction: -1 },
 *   { key: 'sender.name', direction: 1 }
 * ];
 *
 * @note dot-prop keys can still be used with a regular relational DB table, they just have no depth
 */
export type SortDefinition<T> = Array<SortEntry<T>>;

/**
 * Optional sorting and slicing of a collection.
 *
 * `offset` and `after_pk` are mutually exclusive (enforced at type level).
 *
 * @example
 * // First page, 20 items, newest first
 * const page1: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20 };
 *
 * @example
 * // Next page using cursor
 * const page2: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, after_pk: 'email_abc' };
 *
 * @example
 * // Offset-based pagination
 * const page3: SortAndSlice<Email> = { sort: [{ key: 'date', direction: -1 }], limit: 20, offset: 40 };
 *
 * @note When using `after_pk` cursor pagination in SQL, the generated subquery count
 * grows O(N²) with the number of sort keys. Recommend ≤3 sort keys with `after_pk`.
 */
export type SortAndSlice<T> = {
    sort?: SortDefinition<T>;
    limit?: number;
} & ({ offset?: number; after_pk?: never } | { offset?: never; after_pk?: PrimaryKeyValue });

/** Error from query validation or building. */
export type QueryError = { type: string; message: string };

/**
 * Result of sortAndSliceObjects — success with items, or failure with errors.
 */
export type SortAndSliceObjectsResult<T> =
    | { success: true; items: T[] }
    | { success: false; errors: QueryError[] };

/**
 * Full prepared SQL output — each clause is independent so the caller can compose freely.
 * No SQL keywords included (no 'WHERE', 'ORDER BY', etc.) — the caller or flattenQueryClausesToSql adds them.
 * Uses PreparedWhereClauseStatement from where-filter/sql for parameterised clause fragments.
 * Shared by both prepareObjectTableQuery and prepareColumnTableQuery.
 */
export type PreparedQueryClauses = {
    where_statement: PreparedWhereClauseStatement | null;
    order_by_statement: string | null;
    limit_statement: PreparedWhereClauseStatement | null;
    offset_statement: PreparedWhereClauseStatement | null;
};

export type PreparedQueryClausesResult =
    | ({ success: true } & PreparedQueryClauses)
    | { success: false; errors: QueryError[] };

export type TableInfo = { tableName: string };

/**
 * JSON-column table: objects stored as JSON in a single column.
 * Schema provides path validation (prevents SQL injection) and type-aware casting for ORDER BY.
 */
export type ObjectTableInfo<T extends Record<string, any>> = TableInfo & {
    objectColumnName: string;
    ddl: { primary_key: string };
    schema: z.ZodSchema<T>;
};

/**
 * Traditional relational table: columns map directly to fields.
 * allowedColumns prevents SQL injection — sort keys are validated against this whitelist.
 */
export type ColumnTableInfo = TableInfo & {
    pkColumnName: string;
    allowedColumns: string[];
};

/**
 * Single SQL fragment + parameters, ready to append to `SELECT * FROM table`.
 */
export type FlattenedQuerySql = {
    sql: string;
    parameters: PreparedStatementArgument[];
};


// --- Type alignment checks ---
// SortEntry: manual type uses DotPropPathsUnion<T> for key, schema uses plain string.
// The schema is intentionally looser at runtime. Verify the non-generic structural shape matches.
isTypeEqual<z.infer<typeof SortEntrySchema>, { key: string; direction: 1 | -1 }>(true);

// SortDefinition: schema infers Array<{key: string, direction: 1 | -1}>, manual type uses DotPropPaths<T>.
// Verify the non-generic structural shape matches.
isTypeEqual<z.infer<typeof SortDefinitionSchema>, Array<{ key: string; direction: 1 | -1 }>>(true);

// SortAndSlice: the manual type has a discriminated union for offset/after_pk that z.infer cannot express.
// We verify the schema's flat inferred shape matches the base fields.
type SortAndSliceSchemaInferred = z.infer<typeof SortAndSliceSchema>;
isTypeEqual<SortAndSliceSchemaInferred, {
    sort?: Array<{ key: string; direction: 1 | -1 }> | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    after_pk?: string | number | undefined;
}>(true);
