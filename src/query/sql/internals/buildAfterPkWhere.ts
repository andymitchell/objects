import type { PrimaryKeyValue } from '../../../utils/getKeyValue.ts';
import type { DotPropPathConversionResult } from '../../../utils/sql/types.ts';
import type { PreparedStatementArgument } from '../../../utils/sql/types.ts';
import type { QueryError } from '../../types.ts';
import type { SqlDialect, SqlFragment } from '../types.ts';
import { quoteIdentifier } from './quoteIdentifier.ts';

type BuildAfterPkWhereResult =
    | { success: true; statement: SqlFragment }
    | { success: false; errors: QueryError[] };

/**
 * Generates a WHERE clause that excludes rows up to and including the cursor row.
 * Uses subquery strategy: lexicographic tuple comparison via correlated subquery.
 *
 * NULL handling: consistent with NULLS LAST ordering — if cursor value is NULL,
 * nothing comes after it; if row value is NULL, it comes after any non-NULL cursor.
 *
 * Parameter binding matches each dialect's placeholder semantics: Postgres references `$1`
 * from every subquery, so the cursor pk is bound once; SQLite `?` placeholders are positional,
 * so the cursor pk is bound once per placeholder occurrence, in emission order.
 *
 * @example
 * _buildAfterPkWhereClause('abc', [{ key: 'date', direction: -1 }], k => ({ success: true, expression: `data->>'${k}'` }), "data->>'id'", 'emails', 'pg')
 */
export function _buildAfterPkWhereClause(
    afterPk: PrimaryKeyValue,
    sort: Array<{ key: string; direction: 1 | -1 }>,
    pathToSqlExpression: (dotPropPath: string) => DotPropPathConversionResult,
    pkExpression: string,
    tableName: string,
    dialect: SqlDialect
): BuildAfterPkWhereResult {
    if (sort.length === 0) {
        return {
            success: false,
            errors: [{ type: 'cursor', message: 'after_pk requires a non-empty sort to define deterministic ordering' }],
        };
    }

    const quotedTable = quoteIdentifier(tableName);
    const parameters: PreparedStatementArgument[] = dialect === 'pg' ? [afterPk] : [];

    const eqOp = dialect === 'pg' ? 'IS NOT DISTINCT FROM' : 'IS';
    const pkParam = dialect === 'pg' ? '$1' : '?';

    // Subquery fetching a sort column value for the cursor row. Call once per textual
    // embedding: each SQLite `?` is positional and consumes its own bound parameter.
    const subqueryFor = (expr: string) => {
        if (dialect === 'sqlite') parameters.push(afterPk);
        return `(SELECT ${expr} FROM ${quotedTable} WHERE ${pkExpression} = ${pkParam})`;
    };

    const orBranches: string[] = [];
    const errors: QueryError[] = [];

    for (let i = 0; i < sort.length; i++) {
        const parts: string[] = [];

        // Equality prefix: all sort keys before index i
        for (let j = 0; j < i; j++) {
            const result = pathToSqlExpression(sort[j]!.key);
            if (!result.success) {
                errors.push({ type: result.error.type, message: result.error.message });
                continue;
            }
            const expr = result.expression;
            parts.push(`${expr} ${eqOp} ${subqueryFor(expr)}`);
        }

        // Direction comparison on the i-th key (NULL-aware for NULLS LAST)
        const entry = sort[i]!;
        const result = pathToSqlExpression(entry.key);
        if (!result.success) {
            errors.push({ type: result.error.type, message: result.error.message });
            continue;
        }
        const expr = result.expression;
        const cmpOp = entry.direction === 1 ? '>' : '<';

        // NULLS LAST: cursor=NULL → nothing after (FALSE). row=NULL → comes after any non-NULL cursor (TRUE).
        // The subquery is embedded twice, so it is generated twice to keep parameters aligned.
        parts.push(`(${subqueryFor(expr)} IS NOT NULL AND (${expr} ${cmpOp} ${subqueryFor(expr)} OR ${expr} IS NULL))`);

        orBranches.push(`(${parts.join(' AND ')})`);
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    return {
        success: true,
        statement: { sql: orBranches.join(' OR '), parameters },
    };
}
