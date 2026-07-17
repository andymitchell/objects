import type { EncodedSortValue } from '../../sortCompare.ts';
import type { DotPropPathConversionResult, PreparedStatementArgument, SortValueKind } from '../../../utils/sql/types.ts';
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
    const errors: QueryError[] = [];

    // Resolve each entry's SQL expression (and kind) once, in sort-priority order.
    const resolved: Array<{ entry: BoundaryEntry; expression: string; kind?: SortValueKind }> = [];
    for (const entry of entries) {
        const result = pathToSqlExpression(entry.key);
        if (!result.success) {
            errors.push({ type: result.error.type, message: result.error.message });
            continue;
        }
        resolved.push(result.kind === undefined
            ? { entry, expression: result.expression }
            : { entry, expression: result.expression, kind: result.kind });
    }
    if (errors.length > 0) return { success: false, errors };

    // Validate/translate each non-null boundary value against its key's kind. A null value binds
    // via `IS NULL` (never a parameter), so its slot stays null and is skipped when emitting.
    const boundValue: Array<PreparedStatementArgument | null> = [];
    for (const { entry, kind } of resolved) {
        if (entry.value === null) { boundValue.push(null); continue; }
        const bound = bindBoundaryValue(entry.key, kind, entry.value, dialect);
        if (!bound.success) { errors.push(bound.error); boundValue.push(null); continue; }
        boundValue.push(bound.value);
    }
    if (errors.length > 0) return { success: false, errors };

    // Emit a fresh placeholder per value occurrence: Postgres `$n` (n = 1-based push order),
    // SQLite positional `?`. Numbering is local; the caller rebases when composing fragments.
    const parameters: PreparedStatementArgument[] = [];
    const placeholder = (v: PreparedStatementArgument): string => {
        parameters.push(v);
        return dialect === 'pg' ? `$${parameters.length}` : '?';
    };

    const orBranches: string[] = [];
    for (let i = 0; i < resolved.length; i++) {
        // A trailing-null boundary on key i has no row ordered strictly after it there — drop the arm.
        if (resolved[i]!.entry.value === null) continue;

        const parts: string[] = [];
        // Equality prefix: every earlier key must match the boundary exactly (IS NULL for a null value).
        for (let j = 0; j < i; j++) {
            const prior = resolved[j]!;
            parts.push(prior.entry.value === null
                ? `${prior.expression} IS NULL`
                : `${prior.expression} = ${placeholder(boundValue[j]!)}`);
        }
        // Strictly-after on key i, admitting rows whose own value is null (nulls sort after the boundary).
        const current = resolved[i]!;
        const cmpOp = current.entry.direction === 1 ? '>' : '<';
        parts.push(`(${current.expression} ${cmpOp} ${placeholder(boundValue[i]!)} OR ${current.expression} IS NULL)`);

        orBranches.push(`(${parts.join(' AND ')})`);
    }

    return { success: true, statement: { sql: orBranches.join(' OR '), parameters } };
}

type BindBoundaryValueResult =
    | { success: true; value: PreparedStatementArgument }
    | { success: false; error: QueryError };

/**
 * Validates and translates one non-null boundary value into the parameter its column orders by,
 * per the key's {@link SortValueKind}.
 *
 * - `'text'` / `'numeric'` reject a mismatched encoding (a numeric key must not receive a string
 *   such as `'-Infinity'`, which orders differently under `::numeric` than in the string bracket).
 * - `'boolean'` translates `'true'`/`'false'` to the dialect's stored form (a real boolean for
 *   Postgres, `1`/`0` for SQLite, which has no boolean type).
 * - `'bigint'` is rejected: its encoded decimal string orders lexically in memory but numerically
 *   in SQL, so a boundary walk cannot stay consistent across the two.
 * - No kind → bind the encoded value as-is.
 */
function bindBoundaryValue(
    key: string,
    kind: SortValueKind | undefined,
    value: string | number,
    dialect: SqlDialect
): BindBoundaryValueResult {
    switch (kind) {
        case 'bigint':
            return { success: false, error: { type: 'cursor', message: `Sort key '${key}' is a bigint; after_boundary cannot page bigint keys (their ordering is not stable across in-memory and SQL).` } };
        case 'text':
            if (typeof value !== 'string') return { success: false, error: { type: 'cursor', message: `Sort key '${key}' is text but the boundary value ${JSON.stringify(value)} is not a string.` } };
            return { success: true, value };
        case 'numeric':
            if (typeof value !== 'number') return { success: false, error: { type: 'cursor', message: `Sort key '${key}' is numeric but the boundary value ${JSON.stringify(value)} is not a number.` } };
            return { success: true, value };
        case 'boolean':
            if (value === 'true') return { success: true, value: dialect === 'pg' ? true : 1 };
            if (value === 'false') return { success: true, value: dialect === 'pg' ? false : 0 };
            return { success: false, error: { type: 'cursor', message: `Sort key '${key}' is boolean but the boundary value ${JSON.stringify(value)} is not 'true' or 'false'.` } };
        default:
            return { success: true, value };
    }
}
