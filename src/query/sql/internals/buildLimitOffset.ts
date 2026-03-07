import type { SqlDialect, SqlFragment } from '../types.ts';

/**
 * Generates a parameterised LIMIT fragment.
 * Returns internal SqlFragment — caller handles parameter rebasing.
 *
 * @example _buildLimitClause(20, 'pg') // { sql: '$1', parameters: [20] }
 */
export function _buildLimitClause(limit: number, dialect: SqlDialect): SqlFragment {
    return {
        sql: dialect === 'pg' ? '$1' : '?',
        parameters: [limit],
    };
}

/**
 * Generates a parameterised OFFSET fragment.
 * Returns internal SqlFragment — caller handles parameter rebasing.
 *
 * @example _buildOffsetClause(40, 'pg') // { sql: '$1', parameters: [40] }
 */
export function _buildOffsetClause(offset: number, dialect: SqlDialect): SqlFragment {
    return {
        sql: dialect === 'pg' ? '$1' : '?',
        parameters: [offset],
    };
}
