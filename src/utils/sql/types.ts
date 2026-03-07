export type PreparedStatementArgument = string | number | boolean | null;
export type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;

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

/** Result of converting a dot-prop path to a SQL expression. Replaces throws with errors-as-values. */
export type DotPropPathConversionResult =
    | { success: true; expression: string }
    | { success: false; error: DotPropPathConversionError };

/** Typeguard: value is a primitive that can be used as a parameterised query argument. */
export function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}
