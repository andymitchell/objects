export type PreparedStatementArgument = string | number | boolean | null;
export type PreparedStatementArgumentOrObject = PreparedStatementArgument | object;

/** Typeguard: value is a primitive that can be used as a parameterised query argument. */
export function isPreparedStatementArgument(x: any): x is PreparedStatementArgument {
    return ['string', 'number', 'boolean'].includes(typeof x);
}
