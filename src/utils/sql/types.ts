export type PreparedStatementArgument = string | number | boolean | bigint | null;
export type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;

/** SQL dialect for query generation. */
export type SqlDialect = 'pg' | 'sqlite';

/**
 * The comparison family a sort-key value belongs to, once its schema type has been mapped
 * onto the physical column shape a database orders by.
 *
 * The four families each order differently across backends, so pagination code that binds a
 * boundary value or pins a collation must know which one applies:
 * - `'text'` — string/enum columns; ordered by Postgres `C` / SQLite `BINARY` (code point).
 * - `'numeric'` — numbers; ordered arithmetically.
 * - `'boolean'` — true/false; stored as a real boolean (Postgres) or `1`/`0` (SQLite).
 * - `'bigint'` — arbitrary-precision integers; ordered arithmetically, distinct from `'numeric'`.
 *
 * @see DotPropPathConversionResult — carries the resolved kind of a converted sort key.
 */
export type SortValueKind = 'text' | 'numeric' | 'boolean' | 'bigint';

/** Discriminant for structured path conversion errors. */
export type DotPropPathConversionErrorType =
    | 'unknown_path'
    | 'invalid_path'
    | 'missing_schema'
    | 'unsupported_kind'
    | 'unexpected_kind';

/** Structured error from dot-prop path to SQL expression conversion. */
export type DotPropPathConversionError = {
    type: DotPropPathConversionErrorType;
    dotPropPath: string;
    message: string;
};

/**
 * Result of converting a dot-prop path to a SQL expression. Replaces throws with errors-as-values.
 *
 * On success, `kind` reports the comparison family of the resolved leaf (see {@link SortValueKind})
 * when the converter can determine it — used to pin text collation and to bind boundary values
 * correctly. It is absent when the leaf has no clean scalar family (e.g. structural or exotic kinds).
 */
export type DotPropPathConversionResult =
    | { success: true; expression: string; kind?: SortValueKind }
    | { success: false; error: DotPropPathConversionError };

/** Typeguard: value is a primitive that can be used as a parameterised query argument. */
export function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean', 'bigint'].includes(typeof x);
}
