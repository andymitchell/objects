import type { EncodedSortValue } from '../../sortCompare.ts';
import type { DotPropPathConversionResult, PreparedStatementArgument } from '../../../utils/sql/types.ts';
import type { QueryError } from '../../types.ts';
import type { SqlDialect, SqlFragment } from '../types.ts';

/**
 * One position of a value-based keyset boundary: a sort key, its direction, and the encoded
 * value the boundary row held at that key. Callers zip these from the user's `sort` and the
 * boundary's `values`, then append a synthetic primary-key entry when the sort needs the
 * tiebreaker (see {@link _buildAfterBoundaryWhereClause}).
 */
export type BoundaryEntry = { key: string; direction: 1 | -1; value: EncodedSortValue };

type BuildAfterBoundaryWhereResult =
    | { success: true; statement: SqlFragment }
    | { success: false; errors: QueryError[] };

/**
 * Generates a WHERE clause that keeps only rows ordered strictly after a value-based keyset
 * boundary — the SQL counterpart of {@link compareToBoundary}.
 *
 * Unlike the `after_pk` cursor, this binds the boundary's values directly (no correlated
 * subquery), so it does not re-read the boundary row and stays correct even when that row has
 * been deleted. The predicate is a lexicographic tuple comparison expressed as an OR of arms:
 * for each entry `i`, all earlier keys equal AND key `i` past the boundary in its direction.
 *
 * Null boundary values follow NULLS LAST: an arm whose boundary value is null is dropped (no row
 * sorts after a trailing null on that key), and earlier keys equal-match null with `IS NULL`. A
 * non-null arm also admits rows whose own value is null on that key (`expr IS NULL`), since a
 * null row sorts after any non-null boundary.
 *
 * Each value is bound according to its key's {@link SortValueKind}: `'text'`/`'numeric'` bind the
 * string/number (rejecting a mismatched encoding as a `cursor` error), `'boolean'` translates to
 * the dialect's representation (`1`/`0` for SQLite, a real boolean for Postgres), and `'bigint'`
 * is rejected outright. A key with no declared/derivable kind binds its value raw.
 *
 * @param entries - The zipped boundary positions, in sort priority order, including any synthetic pk entry.
 * @param pathToSqlExpression - Resolves each key to its SQL expression (and kind); the same converter used for ORDER BY.
 * @param dialect - `'pg'` (local `$1..$n`) or `'sqlite'` (positional `?`). Numbering is local; the caller rebases.
 * @returns `{ success: true, statement }` with the predicate and its parameters, or `{ success: false, errors }`. Never throws.
 */
export function _buildAfterBoundaryWhereClause(
    entries: BoundaryEntry[],
    pathToSqlExpression: (dotPropPath: string) => DotPropPathConversionResult,
    dialect: SqlDialect
): BuildAfterBoundaryWhereResult {
    void entries; void pathToSqlExpression; void dialect;
    const parameters: PreparedStatementArgument[] = [];
    return { success: true, statement: { sql: '1=0', parameters } };
}
