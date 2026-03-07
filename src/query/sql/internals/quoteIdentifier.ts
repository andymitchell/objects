/**
 * Wraps a SQL identifier in double quotes, escaping any embedded double quotes.
 * Prevents syntax errors from reserved words or special characters in table/column names.
 *
 * @example quoteIdentifier('user-data') // '"user-data"'
 * @example quoteIdentifier('order') // '"order"'
 * @example quoteIdentifier('col"name') // '"col""name"'
 */
export function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}
